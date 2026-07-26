import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

interface SheetProps {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly title: string;
}

export function Sheet({ children, onClose, open, title }: SheetProps) {
  return (
    <DialogPrimitive.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog__overlay" />
        <DialogPrimitive.Content className="sheet">
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <button className="sheet__close" type="button" aria-label="Close navigation">
              &times;
            </button>
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
