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
  readonly items: readonly DropdownMenuItem[];
  readonly trigger: ReactNode;
}

export function DropdownMenu({ accessibleLabel, items, trigger }: DropdownMenuProps) {
  return (
    <DropdownMenuPrimitive.Root modal={false}>
      <DropdownMenuPrimitive.Trigger aria-label={accessibleLabel} asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
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
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
