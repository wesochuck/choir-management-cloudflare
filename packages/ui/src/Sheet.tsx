import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

interface SheetProps {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly presentation?: "side" | "mobile-fullscreen";
  readonly restoreFocusRef?: { readonly current: HTMLElement | null };
  readonly title: string;
}

export function Sheet({
  children,
  onClose,
  open,
  presentation = "side",
  restoreFocusRef,
  title,
}: SheetProps) {
  const content = (
    <>
      <DialogPrimitive.Overlay className="dialog__overlay" />
      <DialogPrimitive.Content
        aria-modal="true"
        className={`sheet${presentation === "mobile-fullscreen" ? " sheet--mobile-fullscreen" : ""}`}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef?.current) return;
          event.preventDefault();
          restoreFocusRef.current.focus();
        }}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close asChild>
          <button className="sheet__close" type="button" aria-label={`Close ${title}`}>
            &times;
          </button>
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </>
  );

  return (
    <DialogPrimitive.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
    >
      {typeof document === "undefined" ? (
        open ? (
          content
        ) : null
      ) : (
        <DialogPrimitive.Portal>{content}</DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  );
}
