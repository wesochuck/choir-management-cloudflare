/** A draft marker, independent of tab selection and validation state. */
export function EditorUnsavedIndicator({ id }: { readonly id: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold"
      id={id}
      style={{ color: "color-mix(in srgb, var(--color-accent) 75%, var(--color-text))" }}
    >
      <span className="size-1.5 rounded-full bg-accent" />
      Unsaved
    </span>
  );
}
