import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

interface DialogProps {
  readonly children: ReactNode;
  readonly description?: string;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly title: string;
}

export function Dialog({ children, description, onClose, open, title }: DialogProps) {
  return (
    <DialogPrimitive.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog__overlay" />
        <DialogPrimitive.Content className="dialog dialog--responsive">
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
