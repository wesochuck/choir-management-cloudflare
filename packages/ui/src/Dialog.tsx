import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly title: string;
}

export function Dialog({ children, onClose, open, title }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    function handleClose() {
      onClose();
    }
    el.addEventListener("close", handleClose);
    return () => {
      el.removeEventListener("close", handleClose);
    };
  }, [onClose]);

  return (
    <dialog ref={dialogRef} className="dialog">
      <div className="dialog__content">
        <div className="dialog__header">
          <h2 className="dialog__title">{title}</h2>
          <button className="dialog__close" onClick={onClose} type="button" aria-label="Close">
            &times;
          </button>
        </div>
        <div className="dialog__body">{children}</div>
      </div>
    </dialog>
  );
}
