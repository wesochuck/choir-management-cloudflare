import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useId } from "react";

import { usePortalContainer } from "./usePortalContainer";

export interface ConfirmationOptions {
  readonly confirmLabel?: string;
  readonly description: string;
  readonly destructive?: boolean;
  readonly title: string;
}

export function ConfirmDialog({
  confirmLabel = "Continue",
  container: explicitContainer,
  description,
  destructive = false,
  onCancel,
  onCloseAutoFocus,
  onConfirm,
  open,
  title,
}: ConfirmationOptions & {
  readonly container?: HTMLElement | null;
  readonly onCancel: () => void;
  readonly onCloseAutoFocus?: (event: Event) => void;
  readonly onConfirm: () => void;
  readonly open: boolean;
}) {
  const descriptionId = useId();
  const portalContext = usePortalContainer();

  const isScoped = explicitContainer !== undefined || portalContext.isScoped;
  const resolvedContainer =
    explicitContainer !== undefined ? explicitContainer : portalContext.container;

  return (
    <DialogPrimitive.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      open={open}
    >
      {!isScoped || resolvedContainer ? (
        <DialogPrimitive.Portal container={resolvedContainer ?? undefined}>
          <DialogPrimitive.Overlay className="dialog__overlay" />
          <DialogPrimitive.Content
            aria-describedby={descriptionId}
            className="dialog dialog--responsive dialog--confirmation"
            onCloseAutoFocus={onCloseAutoFocus}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              onCancel();
            }}
          >
            <div className="dialog__header">
              <div>
                <DialogPrimitive.Title className="dialog__title">{title}</DialogPrimitive.Title>
              </div>
            </div>
            <div className="dialog__body">
              <DialogPrimitive.Description className="dialog__description" id={descriptionId}>
                {description}
              </DialogPrimitive.Description>
              <div className="dialog__actions">
                <button className="button button--secondary" onClick={onCancel} type="button">
                  Cancel
                </button>
                <button
                  className={`button ${destructive ? "button--danger" : "button--primary"}`}
                  onClick={onConfirm}
                  type="button"
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}
