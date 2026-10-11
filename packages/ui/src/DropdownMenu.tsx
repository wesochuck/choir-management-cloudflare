import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

interface DropdownMenuItem {
  readonly disabled?: boolean;
  readonly href?: string;
  readonly label: string;
  readonly onSelect?: () => void;
}

interface DropdownMenuProps {
  readonly accessibleLabel: string;
  /**
   * Render menu content inline instead of portalling to `document.body`.
   * Required when the trigger lives inside a modal Dialog: a body-level
   * portal falls outside the dialog focus trap and never opens.
   */
  readonly disablePortal?: boolean | undefined;
  readonly items: readonly DropdownMenuItem[];
  readonly trigger: ReactNode;
}

export function DropdownMenu({
  accessibleLabel,
  disablePortal = false,
  items,
  trigger,
}: DropdownMenuProps) {
  const content = (
    <DropdownMenuPrimitive.Content align="end" className="dropdown-menu" sideOffset={8}>
      {items.map((item) => (
        <DropdownMenuPrimitive.Item
          asChild
          key={item.label}
          {...(item.disabled === undefined ? {} : { disabled: item.disabled })}
        >
          {item.href ? (
            <a className="dropdown-menu__item" href={item.href}>
              {item.label}
            </a>
          ) : (
            <button
              className="dropdown-menu__item"
              disabled={item.disabled}
              onClick={item.onSelect}
              type="button"
            >
              {item.label}
            </button>
          )}
        </DropdownMenuPrimitive.Item>
      ))}
    </DropdownMenuPrimitive.Content>
  );
  return (
    <DropdownMenuPrimitive.Root modal={false}>
      <DropdownMenuPrimitive.Trigger aria-label={accessibleLabel} asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      {disablePortal ? (
        content
      ) : (
        <DropdownMenuPrimitive.Portal>{content}</DropdownMenuPrimitive.Portal>
      )}
    </DropdownMenuPrimitive.Root>
  );
}
