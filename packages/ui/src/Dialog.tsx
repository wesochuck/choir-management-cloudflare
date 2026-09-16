import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useState, type ReactNode } from "react";

import { useConfirmation } from "./useConfirmation";

export interface DialogProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly description?: string;
  readonly dirty?: boolean;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly title: string;
  readonly variant?: "default" | "confirmation";
}

export function DialogClose({
  asChild,
  children,
}: {
  readonly asChild?: boolean;
  readonly children: ReactNode;
}) {
  return asChild ? (
    <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>
  ) : (
    <DialogPrimitive.Close>{children}</DialogPrimitive.Close>
  );
}

export function DialogFooter({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={`dialog__actions ${className ?? ""}`.trim()}>{children}</div>;
}

export function Dialog({
  children,
  className,
  description,
  dirty,
  footer,
  onClose,
  open,
  title,
  variant = "default",
}: DialogProps) {
  const [inputDirty, setInputDirty] = useState(false);
  const { confirm, confirmationDialog } = useConfirmation();

  useEffect(() => {
    if (open) {
      // Reset the per-open-session guard whenever a fresh dialog is shown.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this synchronizes the guard with the controlled open prop.
      setInputDirty(false);
    }
  }, [open]);

  async function requestClose(): Promise<void> {
    const hasUnsavedChanges = dirty ?? inputDirty;
    if (hasUnsavedChanges) {
      const shouldDiscard = await confirm({
        confirmLabel: "Discard changes",
        description: "Your unsaved changes will be lost if you close this dialog.",
        destructive: true,
        title: "Discard unsaved changes?",
      });
      if (!shouldDiscard) return;
    }
    setInputDirty(false);
    onClose();
  }

  return (
    <>
      <DialogPrimitive.Root
        onOpenChange={(nextOpen) => {
          if (!nextOpen) void requestClose();
        }}
        open={open}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="dialog__overlay" />
          <DialogPrimitive.Content
            className={`dialog dialog--responsive ${variant === "confirmation" ? "dialog--confirmation" : ""} ${className ?? ""}`.trim()}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              void requestClose();
            }}
            onInput={() => {
              setInputDirty(true);
            }}
          >
            <div className="dialog__header">
              <div>
                <DialogPrimitive.Title className="dialog__title">{title}</DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="dialog__description">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <DialogPrimitive.Close asChild>
                <button className="dialog__close" type="button" aria-label="Close">
                  &times;
                </button>
              </DialogPrimitive.Close>
            </div>
            <div className="dialog__body">{children}</div>
            {footer ? <div className="dialog__actions dialog__footer">{footer}</div> : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {confirmationDialog}
    </>
  );
}
