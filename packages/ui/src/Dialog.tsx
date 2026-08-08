import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useState, type ReactNode } from "react";

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

  useEffect(() => {
    if (open) {
      // Reset the per-open-session guard whenever a fresh dialog is shown.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this synchronizes the guard with the controlled open prop.
      setInputDirty(false);
    }
  }, [open]);

  function requestClose(): void {
    const hasUnsavedChanges = dirty ?? inputDirty;
    if (
      hasUnsavedChanges &&
      !window.confirm("You have unsaved changes. Discard them and close this dialog?")
    ) {
      return;
    }
    setInputDirty(false);
    onClose();
  }

  return (
    <DialogPrimitive.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
      open={open}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog__overlay" />
        <DialogPrimitive.Content
          className="dialog dialog--responsive"
          onEscapeKeyDown={(event) => {
            // Radix normally dismisses the dialog immediately after this event. Defer the
            // controlled close request so the discard confirmation does not run inside Radix's
            // Escape/focus handling, which can leave the modal in a close loop.
            event.preventDefault();
            window.setTimeout(requestClose, 0);
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
  );
}
