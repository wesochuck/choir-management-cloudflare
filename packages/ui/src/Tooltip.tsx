import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useState, type ReactElement } from "react";
import { usePortalContainer } from "./usePortalContainer";

export function Tooltip({
  children,
  content,
  disabled = false,
}: {
  readonly children: ReactElement;
  readonly content: string | undefined;
  readonly disabled?: boolean;
}) {
  const { container, isScoped } = usePortalContainer();
  const [open, setOpen] = useState(false);

  const [prevDisabled, setPrevDisabled] = useState(disabled);
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled);
    if (disabled) {
      setOpen(false);
    }
  }

  if (!content) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root
        open={disabled ? false : open}
        onOpenChange={(nextOpen) => {
          if (!disabled) {
            setOpen(nextOpen);
          }
        }}
      >
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        {(!isScoped || container) && (
          <TooltipPrimitive.Portal container={container ?? undefined}>
            <TooltipPrimitive.Content
              className="tooltip no-print"
              sideOffset={6}
              collisionPadding={8}
              onEscapeKeyDown={(event) => {
                event.stopPropagation();
              }}
            >
              {content}
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        )}
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
