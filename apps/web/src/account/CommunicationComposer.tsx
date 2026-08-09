import type { CommunicationAudienceRequest, CommunicationChannel } from "@choir/contracts";
import { useRef, useState } from "react";

import {
  communicationPlaceholderContext,
  hasEventDependentCommunicationPlaceholders,
  visibleCommunicationPlaceholders,
  type CommunicationPlaceholder,
} from "./communicationPlaceholders";
import { renderCommunicationMarkdownPreview } from "./communicationMarkdown";

interface CommunicationComposerProps {
  readonly audience: CommunicationAudienceRequest;
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly onBackToAudience: () => void;
  readonly onContentChange: (value: string) => void;
  readonly subject: string;
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
  onBackToAudience,
  onContentChange,
  subject,
}: CommunicationComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [preview, setPreview] = useState(false);
  const context = communicationPlaceholderContext(`${subject}\n${contentMarkdown}`);
  const placeholders = visibleCommunicationPlaceholders(
    audience,
    channel,
    context,
    contentMarkdown,
  );
  const placeholderGroups = Array.from(
    placeholders.reduce((groups, placeholder) => {
      const group = groups.get(placeholder.category) ?? [];
      group.push(placeholder);
      groups.set(placeholder.category, group);
      return groups;
    }, new Map<CommunicationPlaceholder["category"], CommunicationPlaceholder[]>()),
  );
  const needsEvent =
    !audience.eventId && hasEventDependentCommunicationPlaceholders(audience, channel, context);

  function insert(replacement: string) {
    if (!textareaRef.current) return;
    insertAtSelection(textareaRef.current, contentMarkdown, replacement, onContentChange);
  }

  return (
    <div className="communication-composer">
      <div className="communication-composer__tabs" role="tablist" aria-label="Message editor">
        <button
          aria-controls="communication-composer-write-panel"
          aria-selected={!preview}
          className={!preview ? "is-active" : ""}
          id="communication-composer-write-tab"
          onClick={() => {
            setPreview(false);
          }}
          role="tab"
          type="button"
        >
          Write
        </button>
        <button
          aria-controls="communication-composer-preview-panel"
          aria-selected={preview}
          className={preview ? "is-active" : ""}
          id="communication-composer-preview-tab"
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
        <div
          aria-labelledby="communication-composer-write-tab"
          className="communication-composer__panel"
          id="communication-composer-write-panel"
          role="tabpanel"
        >
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
          {contentMarkdown.includes("{{RSVP_LINKS}}") ? (
            <p className="field-help">
              Each member will receive a personalized RSVP page link. They can respond without
              signing in.
            </p>
          ) : null}
          {contentMarkdown.includes("{{PLAYER_LINK}}") ? (
            <p className="field-help">
              Each member will receive a personalized practice player link for the selected event.
              They can listen without signing in.
            </p>
          ) : null}
        </div>
      ) : (
        <div
          aria-labelledby="communication-composer-preview-tab"
          aria-label="Formatted message preview"
          className="communication-composer__preview"
          dangerouslySetInnerHTML={{ __html: renderCommunicationMarkdownPreview(contentMarkdown) }}
          id="communication-composer-preview-panel"
          role="tabpanel"
        />
      )}
      <aside className="communication-placeholders" aria-label="Available placeholders">
        <div>
          <strong>Insert placeholders</strong>
          <p className="field-help">Click a placeholder to insert it at the cursor.</p>
        </div>
        <div className="communication-placeholders__list">
          {placeholderGroups.map(([category, group]) => (
            <section className="communication-placeholders__group" key={category}>
              <h4>{category}</h4>
              <div className="communication-placeholders__group-list">
                {group.map((placeholder) => (
                  <PlaceholderButton
                    key={placeholder.tag}
                    onInsert={() => {
                      insert(placeholder.tag);
                    }}
                    placeholder={placeholder}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        {needsEvent ? (
          <div className="communication-placeholders__event-help">
            <p className="field-help">
              Event-specific placeholders become available after you choose an event in step 1,
              Audience.
            </p>
            <button className="text-button" onClick={onBackToAudience} type="button">
              Choose an event in Audience
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
