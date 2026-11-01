import {
  formatWebsiteContentImage,
  websiteImageSelection,
  type WebsiteContentImage,
} from "@choir/domain";
import { useEffect, useRef, useState, type RefObject } from "react";
import { MarkdownImageEditor } from "./MarkdownImageEditor";

export function MarkdownImageAction({
  value,
  textareaRef,
  onChange,
  disabled,
}: {
  readonly value: string;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const cursor = useRef<number | null>(null);
  const latest = useRef({ value, onChange, disabled });
  const mounted = useRef(true);
  useEffect(() => {
    latest.current = { value, onChange, disabled };
  }, [value, onChange, disabled]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [selection, setSelection] = useState<
    (ReturnType<typeof websiteImageSelection> & { readonly value: string }) | null
  >(null);
  function apply(image: WebsiteContentImage | null): boolean {
    if (
      !selection ||
      !mounted.current ||
      latest.current.disabled ||
      latest.current.value !== selection.value
    )
      return false;
    const before = selection.value.slice(0, selection.start);
    const after = selection.value.slice(selection.end);
    const markup = image ? formatWebsiteContentImage(image) : "";
    const leading =
      before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const trailing =
      after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
    const replacement = image ? `${leading}${markup}${trailing}` : "";
    latest.current.onChange(before + replacement + after);
    cursor.current = before.length + replacement.length;
    setSelection(null);
    return true;
  }
  return (
    <>
      <button
        type="button"
        className="markdown-toolbar__button"
        ref={trigger}
        disabled={disabled}
        onClick={() => {
          const textarea = textareaRef.current;
          if (!textarea) return;
          cursor.current = null;
          setSelection({
            ...websiteImageSelection(value, textarea.selectionStart, textarea.selectionEnd),
            value,
          });
        }}
      >
        Insert image
      </button>
      {selection ? (
        <MarkdownImageEditor
          initial={selection.image}
          selectedText={selection.value.slice(selection.start, selection.end)}
          anchorRef={trigger}
          onApply={apply}
          onRemove={() => apply(null)}
          onClose={() => {
            setSelection(null);
          }}
          onReturnFocus={() => {
            if (cursor.current === null) {
              trigger.current?.focus();
              return;
            }
            const position = cursor.current;
            requestAnimationFrame(() => {
              textareaRef.current?.focus();
              textareaRef.current?.setSelectionRange(position, position);
            });
          }}
        />
      ) : null}
    </>
  );
}
