import { useState, type ComponentProps } from "react";

type NumberInputProps = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue"> & {
  readonly value: number | string;
};

/** Keeps incomplete input editable; string consumers can also commit an empty value. */
export function NumberInput({ value, onChange, onBlur, ...props }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      {...props}
      type="number"
      value={draft ?? value}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        if (
          typeof value === "string" ||
          (event.currentTarget.value !== "" && Number.isFinite(event.currentTarget.valueAsNumber))
        ) {
          onChange?.(event);
        }
      }}
      onBlur={(event) => {
        // Restore the accepted value (including any consumer clamping) when editing ends.
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}
