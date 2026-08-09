import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useState, type ReactNode } from "react";

import { useConfirmation } from "./useConfirmation";

interface DialogProps {
  readonly children: ReactNode;
  readonly description?: string;
  readonly dirty?: boolean;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly title: string;
}

export function Dialog({ children, description, dirty, onClose, open, title }: DialogProps) {
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
            className="dialog dialog--responsive"
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
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {confirmationDialog}
    </>
  );
}
