import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ReactNode } from "react";

interface CollapsibleProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function Collapsible({ children, label, onOpenChange, open }: CollapsibleProps) {
  return (
    <CollapsiblePrimitive.Root onOpenChange={onOpenChange} open={open}>
      <CollapsiblePrimitive.Trigger className="collapsible__trigger">
        <span>{label}</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content>{children}</CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
