import type { RefObject } from "react";

interface MarkdownToolbarProps {
  readonly onChange: (nextValue: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly value: string;
}

export function MarkdownToolbar({ onChange, textareaRef, value }: MarkdownToolbarProps) {
  function applyFormat(prefix: string, suffix = "", defaultText = "") {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.slice(start, end) || defaultText;
    const replacement = `${prefix}${selectedText}${suffix}`;
    const nextValue = value.slice(0, start) + replacement + value.slice(end);

    onChange(nextValue);

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const cursorStart = start + prefix.length;
        const cursorEnd = cursorStart + selectedText.length;
        textareaRef.current.setSelectionRange(cursorStart, cursorEnd);
      }
    });
  }

  function applyHeading(prefix: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const lastNewline = value.lastIndexOf("\n", start - 1);
    const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;

    const currentLine = value.slice(lineStart);
    let nextValue: string;
    let newCursorPos: number;

    if (currentLine.startsWith(prefix)) {
      nextValue = value.slice(0, lineStart) + currentLine.slice(prefix.length);
      newCursorPos = Math.max(lineStart, start - prefix.length);
    } else {
      const strippedLine = currentLine.replace(/^#{1,3}\s+/, "");
      const strippedLength = currentLine.length - strippedLine.length;
      nextValue = value.slice(0, lineStart) + prefix + strippedLine;
      newCursorPos = start - strippedLength + prefix.length;
    }

    onChange(nextValue);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos + (end - start));
      }
    });
  }

  return (
    <div aria-label="Text formatting" className="markdown-toolbar" role="toolbar">
      <button
        aria-label="Heading 2"
        className="markdown-toolbar__button"
        onClick={() => {
          applyHeading("## ");
        }}
        type="button"
      >
        H2
      </button>
      <button
        aria-label="Heading 3"
        className="markdown-toolbar__button"
        onClick={() => {
          applyHeading("### ");
        }}
        type="button"
      >
        H3
      </button>
      <button
        aria-label="Bold text"
        className="markdown-toolbar__button markdown-toolbar__button--bold"
        onClick={() => {
          applyFormat("**", "**", "bold text");
        }}
        type="button"
      >
        B
      </button>
      <button
        aria-label="Italic text"
        className="markdown-toolbar__button markdown-toolbar__button--italic"
        onClick={() => {
          applyFormat("*", "*", "italic text");
        }}
        type="button"
      >
        I
      </button>
      <button
        aria-label="Insert link"
        className="markdown-toolbar__button"
        onClick={() => {
          applyFormat("[", "](https://example.com)", "link text");
        }}
        type="button"
      >
        Link
      </button>
    </div>
  );
}
