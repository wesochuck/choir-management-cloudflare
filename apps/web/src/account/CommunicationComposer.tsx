import type { CommunicationAudienceRequest, CommunicationChannel } from "@choir/contracts";
import { useRef, useState } from "react";

import {
  visibleCommunicationPlaceholders,
  type CommunicationPlaceholder,
} from "./communicationPlaceholders";
import { renderCommunicationMarkdownPreview } from "./communicationMarkdown";

interface CommunicationComposerProps {
  readonly audience: CommunicationAudienceRequest;
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly onContentChange: (value: string) => void;
}

function insertAtSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  replacement: string,
  onChange: (next: string) => void,
): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  const next = `${value.slice(0, start)}${replacement.replace("$SELECTION", selected || "text")}${value.slice(end)}`;
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const cursor = start + replacement.replace("$SELECTION", selected || "text").length;
    textarea.setSelectionRange(cursor, cursor);
  });
}

function PlaceholderButton({
  onInsert,
  placeholder,
}: {
  readonly onInsert: (placeholder: CommunicationPlaceholder) => void;
  readonly placeholder: CommunicationPlaceholder;
}) {
  return (
    <button
      className="communication-placeholder"
      onClick={() => {
        onInsert(placeholder);
      }}
      title={placeholder.description}
      type="button"
    >
      <code>{placeholder.tag}</code>
      <span>{placeholder.label}</span>
    </button>
  );
}

export function CommunicationComposer({
  audience,
  channel,
  contentMarkdown,
  onContentChange,
}: CommunicationComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [preview, setPreview] = useState(false);
  const placeholders = visibleCommunicationPlaceholders(audience, channel);

  function insert(replacement: string) {
    if (!textareaRef.current) return;
    insertAtSelection(textareaRef.current, contentMarkdown, replacement, onContentChange);
  }

  return (
    <div className="communication-composer">
      <div className="communication-composer__tabs" role="tablist" aria-label="Message editor">
        <button
          aria-selected={!preview}
          className={!preview ? "is-active" : ""}
          onClick={() => {
            setPreview(false);
          }}
          role="tab"
          type="button"
        >
          Write
        </button>
        <button
          aria-selected={preview}
          className={preview ? "is-active" : ""}
          onClick={() => {
            setPreview(true);
          }}
          role="tab"
          type="button"
        >
          Preview
        </button>
      </div>
      {!preview ? (
        <>
          <div className="communication-composer__toolbar" aria-label="Formatting tools">
            <button
              onClick={() => {
                insert("**$SELECTION**");
              }}
              title="Bold"
              type="button"
            >
              <strong>B</strong>
            </button>
            <button
              onClick={() => {
                insert("*$SELECTION*");
              }}
              title="Italic"
              type="button"
            >
              <em>I</em>
            </button>
            <button
              onClick={() => {
                insert("[$SELECTION](https://)");
              }}
              title="Link"
              type="button"
            >
              Link
            </button>
            <button
              onClick={() => {
                insert("- $SELECTION");
              }}
              title="Bulleted list"
              type="button"
            >
              List
            </button>
            <button
              onClick={() => {
                insert("## $SELECTION");
              }}
              title="Heading"
              type="button"
            >
              H
            </button>
          </div>
          <textarea
            aria-label="Message body"
            className="communication-composer__textarea"
            maxLength={100_000}
            onChange={(event) => {
              onContentChange(event.target.value);
            }}
            placeholder="Write your message here… Markdown formatting is supported."
            ref={textareaRef}
            required
            rows={12}
            value={contentMarkdown}
          />
          <p className="field-help">
            Markdown is supported. Use Preview to check the formatted message.
          </p>
          {/\{\{POLL_LINK:[0-9a-f-]{36}\}\}/i.test(contentMarkdown) ? (
            <p className="field-help">
              The poll response placeholder will become a private, one-time link for each member
              when this email is sent.
            </p>
          ) : null}
        </>
      ) : (
        <div
          aria-label="Formatted message preview"
          className="communication-composer__preview"
          dangerouslySetInnerHTML={{ __html: renderCommunicationMarkdownPreview(contentMarkdown) }}
        />
      )}
      <aside className="communication-placeholders" aria-label="Available placeholders">
        <div>
          <strong>Insert placeholders</strong>
          <p className="field-help">Click a placeholder to insert it at the cursor.</p>
        </div>
        <div className="communication-placeholders__list">
          {placeholders.map((placeholder) => (
            <PlaceholderButton
              key={placeholder.tag}
              onInsert={() => {
                insert(placeholder.tag);
              }}
              placeholder={placeholder}
            />
          ))}
        </div>
        {placeholders.some(({ requiresEvent }) => requiresEvent) ? null : (
          <p className="field-help">Select an event to unlock event placeholders.</p>
        )}
      </aside>
    </div>
  );
}
