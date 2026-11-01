import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { usePortalContainer } from "./usePortalContainer";
import { useConfirmation } from "./useConfirmation";

export interface DialogProps {
  readonly anchorRef?: RefObject<HTMLElement | null> | undefined;
  readonly bodyClassName?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly container?: HTMLElement | null;
  readonly description?: string;
  readonly dirty?: boolean;
  readonly footer?: ReactNode;
  readonly header?: ReactNode;
  readonly onClose: () => void;
  readonly onCloseAutoFocus?: ((event: Event) => void) | undefined;
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
  anchorRef,
  bodyClassName,
  children,
  className,
  container: explicitContainer,
  description,
  dirty,
  footer,
  header,
  onClose,
  onCloseAutoFocus,
  open,
  title,
  variant = "default",
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef) return;
    function position() {
      const content = contentRef.current;
      const anchor = anchorRef?.current;
      if (!content || !anchor) return;
      if (window.innerWidth < 640) {
        for (const property of [
          "position",
          "left",
          "top",
          "width",
          "max-height",
          "transform",
          "margin",
        ])
          content.style.removeProperty(property);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(400, window.innerWidth - 32);
      const availableBelow = window.innerHeight - rect.bottom - 24;
      const height = Math.min(440, Math.max(240, window.innerHeight - 48));
      const top =
        availableBelow >= Math.min(height, content.scrollHeight)
          ? rect.bottom + 8
          : Math.max(16, rect.top - Math.min(height, content.scrollHeight) - 8);
      Object.assign(content.style, {
        position: "fixed",
        left: `${String(Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)))}px`,
        top: `${String(top)}px`,
        width: `${String(width)}px`,
        maxHeight: `${String(Math.min(height, window.innerHeight - top - 16))}px`,
        transform: "none",
        margin: "0",
      });
    }
    const frame = requestAnimationFrame(position);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    if (contentRef.current) observer?.observe(contentRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer?.disconnect();
    };
  }, [anchorRef, open]);
  const [inputDirty, setInputDirty] = useState(false);
  const portalContext = usePortalContainer();
  const { confirm, confirmationDialog } = useConfirmation();

  const isScoped = explicitContainer !== undefined || portalContext.isScoped;
  const resolvedContainer =
    explicitContainer !== undefined ? explicitContainer : portalContext.container;

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
        {!isScoped || resolvedContainer ? (
          <DialogPrimitive.Portal container={resolvedContainer ?? undefined}>
            <DialogPrimitive.Overlay
              className={`dialog__overlay${anchorRef ? " dialog__overlay--anchored" : ""}`}
            />
            <DialogPrimitive.Content
              ref={contentRef}
              className={`dialog dialog--responsive ${variant === "confirmation" ? "dialog--confirmation" : ""} ${className ?? ""}`.trim()}
              onCloseAutoFocus={onCloseAutoFocus}
              onEscapeKeyDown={(event) => {
                event.preventDefault();
                void requestClose();
              }}
              onInput={() => {
                setInputDirty(true);
              }}
              onScroll={(event) => {
                if (event.currentTarget.scrollTop !== 0) {
                  event.currentTarget.scrollTop = 0;
                }
                if (event.currentTarget.scrollLeft !== 0) {
                  event.currentTarget.scrollLeft = 0;
                }
              }}
            >
              {header ? (
                <div className="dialog__header dialog__header--custom">
                  <DialogPrimitive.Title asChild>
                    <span className="sr-only">{title}</span>
                  </DialogPrimitive.Title>
                  {description ? (
                    <DialogPrimitive.Description className="sr-only">
                      {description}
                    </DialogPrimitive.Description>
                  ) : null}
                  {header}
                </div>
              ) : (
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
              )}
              <div className={`dialog__body ${bodyClassName ?? ""}`.trim()}>{children}</div>
              {footer ? <div className="dialog__actions dialog__footer">{footer}</div> : null}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </DialogPrimitive.Root>
      {confirmationDialog}
    </>
  );
}
