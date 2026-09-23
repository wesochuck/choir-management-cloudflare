import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationTemplate,
  ContactList,
  OrganizationEvent,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import {
  hasEventDependentCommunicationPlaceholders,
  templateMatchesCommunicationContext,
  visibleCommunicationPlaceholders,
  type CommunicationContextIssue,
  type CommunicationPlaceholderDefinition,
} from "@choir/domain";
import { useConfirmation } from "@choir/ui";
import { useRef, useState } from "react";
import {
  communicationPreviewValues,
  renderCommunicationMarkdownPreview,
} from "../../communicationMarkdown";
import { RecipientContextPanel } from "./RecipientContextPanel";
import type { CommunicationAudienceTarget, CommunicationReachState } from "./types";
import { eventLabel } from "./utils";

interface MessageComposerProps {
  readonly audience: CommunicationAudienceRequest;
  readonly audienceOptions: readonly CommunicationAudienceTarget[];
  readonly busy: boolean;
  readonly channel: CommunicationChannel;
  readonly contactLists: readonly ContactList[];
  readonly contentMarkdown: string;
  readonly contextIssues: readonly CommunicationContextIssue[];
  readonly events: readonly OrganizationEvent[];
  readonly onChannelChange: (channel: CommunicationChannel) => void;
  readonly onContentChange: (value: string) => void;
  readonly onOpenReview: () => void;
  readonly onOpenSaveTemplate: () => void;
  readonly onOpenTestEmail: () => void;
  readonly onRemoveConflictingPlaceholder: (tag: string) => void;
  readonly onSaveDraft: () => void;
  readonly onSubjectChange: (value: string) => void;
  readonly onToggleRecipientsExpanded: (expanded: boolean) => void;
  readonly onUpdateAudience: (
    updater: (current: CommunicationAudienceRequest) => CommunicationAudienceRequest,
  ) => void;
  readonly reachState: CommunicationReachState;
  readonly recipientsExpanded: boolean;
  readonly rosterConfiguration: OrganizationRosterConfiguration | null;
  readonly selectedEvent: OrganizationEvent | null;
  readonly subject: string;
  readonly templates: readonly CommunicationTemplate[];
}

function replaceSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  start: number,
  end: number,
  replacement: string,
  onChange: (next: string) => void,
): void {
  const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const cursor = start + replacement.length;
    textarea.setSelectionRange(cursor, cursor);
  });
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
  replaceSelection(
    textarea,
    value,
    start,
    end,
    replacement.replace("$SELECTION", selected || "text"),
    onChange,
  );
}

function insertListItemAtSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (next: string) => void,
): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  const currentLineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const currentLinePrefix = value.slice(currentLineStart, start);
  const lineBreak = currentLinePrefix.trim().length > 0 ? "\n" : "";
  replaceSelection(textarea, value, start, end, `${lineBreak}- ${selected || "text"}`, onChange);
}

function communicationSendDisabled({
  busy,
  channel,
  contentMarkdown,
  contextIssues,
  reachState,
  subject,
}: {
  readonly busy: boolean;
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly contextIssues: readonly CommunicationContextIssue[];
  readonly reachState: CommunicationReachState;
  readonly subject: string;
}): boolean {
  const hasSubjectError = channel !== "SMS" && subject.trim().length === 0;
  const hasBodyError = contentMarkdown.trim().length === 0;
  const hasReachError = reachState.loading || !reachState.data || reachState.data.total === 0;
  const hasTicketServiceOverflow = (reachState.data?.ticketBuyerPurchasesOverLimit ?? 0) > 0;
  return (
    busy ||
    hasSubjectError ||
    hasBodyError ||
    hasReachError ||
    hasTicketServiceOverflow ||
    contextIssues.length > 0
  );
}

function PlaceholderButton({
  onInsert,
  placeholder,
}: {
  readonly onInsert: (placeholder: CommunicationPlaceholderDefinition) => void;
  readonly placeholder: CommunicationPlaceholderDefinition;
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

function ConflictBanner({
  contextIssues,
  onRemoveConflictingPlaceholder,
  onToggleRecipientsExpanded,
}: {
  readonly contextIssues: readonly CommunicationContextIssue[];
  readonly onRemoveConflictingPlaceholder: (tag: string) => void;
  readonly onToggleRecipientsExpanded: (expanded: boolean) => void;
}) {
  if (contextIssues.length === 0) return null;

  return (
    <aside
      aria-label="Message personalization conflict"
      className="notice notice--error communication-conflict-banner"
      role="alert"
    >
      <div className="communication-conflict-banner__header">
        <strong>This message needs an update</strong>
      </div>
      <ul className="communication-conflict-banner__list">
        {contextIssues.map((issue) => (
          <li key={`${issue.code}:${issue.placeholder ?? "audience"}`}>
            <span>{issue.message}</span>
            <div className="conflict-actions">
              {issue.placeholder ? (
                <button
                  className="button button--secondary button--sm"
                  onClick={() => {
                    onRemoveConflictingPlaceholder(issue.placeholder ?? "");
                  }}
                  type="button"
                >
                  Remove {issue.placeholder}
                </button>
              ) : null}
              <button
                className="button button--secondary button--sm"
                onClick={() => {
                  onToggleRecipientsExpanded(true);
                }}
                type="button"
              >
                Edit recipients
              </button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function PersonalizeSection({
  audience,
  events,
  needsEvent,
  onInsert,
  onUpdateAudience,
  placeholderGroups,
  selectedEvent,
}: {
  readonly audience: CommunicationAudienceRequest;
  readonly events: readonly OrganizationEvent[];
  readonly needsEvent: boolean;
  readonly onInsert: (tag: string) => void;
  readonly onUpdateAudience: (
    updater: (current: CommunicationAudienceRequest) => CommunicationAudienceRequest,
  ) => void;
  readonly placeholderGroups: readonly (readonly [
    CommunicationPlaceholderDefinition["category"],
    CommunicationPlaceholderDefinition[],
  ])[];
  readonly selectedEvent: OrganizationEvent | null;
}) {
  return (
    <section aria-label="Personalize message" className="communication-personalize-section">
      <div className="communication-personalize-section__header">
        <h4>Personalize</h4>
        <p className="field-help">Click a placeholder to insert it at your cursor.</p>
      </div>
      <div className="communication-personalize-section__grid">
        {placeholderGroups.map(([category, group]) => (
          <div className="personalize-group" key={category}>
            <span className="personalize-group__title">{category}</span>
            <div className="personalize-group__buttons">
              {group.map((placeholder) => (
                <PlaceholderButton
                  key={placeholder.tag}
                  onInsert={() => {
                    onInsert(`${placeholder.tag} `);
                  }}
                  placeholder={placeholder}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {needsEvent ? (
        <div className="communication-placeholders__event-help">
          <p className="field-help">
            Choose an event to use event-specific personalization such as RSVP links, event dates,
            and practice links.
          </p>
          {events.length > 0 ? (
            <div className="communication-event-picker-row">
              <label className="sr-only" htmlFor="communication-personalize-event-select">
                Choose event
              </label>
              <select
                id="communication-personalize-event-select"
                onChange={(event) => {
                  const eventId = event.target.value || null;
                  onUpdateAudience((current) => ({
                    ...current,
                    eventId,
                    rsvp: eventId ? current.rsvp : "All",
                  }));
                }}
                value={audience.eventId ?? ""}
              >
                <option value="">Choose an event…</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {eventLabel(event)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="field-help">
              No events scheduled yet. Create an event in Events first to enable event placeholders.
            </p>
          )}
        </div>
      ) : selectedEvent ? (
        <div className="communication-placeholders__event-active">
          <span className="field-help">
            Personalizing for: <strong>{selectedEvent.title}</strong>
          </span>
          <button
            className="text-button"
            onClick={() => {
              onUpdateAudience((current) => ({
                ...current,
                eventId: null,
                rsvp: "All",
              }));
            }}
            type="button"
          >
            Clear event
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ComposerActionBar({
  busy,
  channel,
  contentMarkdown,
  isSendDisabled,
  onOpenReview,
  onOpenSaveTemplate,
  onOpenTestEmail,
  onSaveDraft,
}: {
  readonly busy: boolean;
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly isSendDisabled: boolean;
  readonly onOpenReview: () => void;
  readonly onOpenSaveTemplate: () => void;
  readonly onOpenTestEmail: () => void;
  readonly onSaveDraft: () => void;
}) {
  const isTemplateDisabled = busy || contentMarkdown.trim().length === 0;
  const isTestDisabled = busy || contentMarkdown.trim().length === 0;

  return (
    <div className="communication-composer-action-bar">
      <div className="action-bar-secondary">
        <button
          className="button button--secondary"
          disabled={busy}
          onClick={onSaveDraft}
          type="button"
        >
          {busy ? "Saving…" : "Save draft"}
        </button>
        <button
          className="button button--secondary"
          disabled={isTemplateDisabled}
          onClick={onOpenSaveTemplate}
          title={
            contentMarkdown.trim().length === 0
              ? "Enter message body to save as template"
              : undefined
          }
          type="button"
        >
          Save as template
        </button>
        {channel !== "SMS" ? (
          <button
            className="button button--secondary"
            disabled={isTestDisabled}
            onClick={onOpenTestEmail}
            title={
              contentMarkdown.trim().length === 0 ? "Enter message body to send a test" : undefined
            }
            type="button"
          >
            Send test
          </button>
        ) : null}
      </div>
      <div className="action-bar-primary">
        <button
          className="button button--primary"
          disabled={isSendDisabled}
          onClick={onOpenReview}
          type="button"
        >
          Review &amp; send
        </button>
      </div>
    </div>
  );
}

export function MessageComposer({
  audience,
  audienceOptions,
  busy,
  channel,
  contactLists,
  contentMarkdown,
  contextIssues,
  events,
  onChannelChange,
  onContentChange,
  onOpenReview,
  onOpenSaveTemplate,
  onOpenTestEmail,
  onRemoveConflictingPlaceholder,
  onSaveDraft,
  onSubjectChange,
  onToggleRecipientsExpanded,
  onUpdateAudience,
  reachState,
  recipientsExpanded,
  rosterConfiguration,
  selectedEvent,
  subject,
  templates,
}: MessageComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const { confirm, confirmationDialog } = useConfirmation();

  // Filter templates compatible with current recipients and channel
  const availableTemplates = templates.filter(
    (template) =>
      !template.isSystem && templateMatchesCommunicationContext(template, audience, channel),
  );

  const previewValues = communicationPreviewValues(selectedEvent);
  const placeholders = visibleCommunicationPlaceholders(
    audience,
    channel,
    "standard",
    contentMarkdown,
  );

  const placeholderGroups = Array.from(
    placeholders.reduce((groups, placeholder) => {
      const group = groups.get(placeholder.category) ?? [];
      group.push(placeholder);
      groups.set(placeholder.category, group);
      return groups;
    }, new Map<CommunicationPlaceholderDefinition["category"], CommunicationPlaceholderDefinition[]>()),
  );

  const needsEvent =
    !audience.eventId && hasEventDependentCommunicationPlaceholders(audience, channel, "standard");

  function insert(replacement: string) {
    if (!textareaRef.current) return;
    insertAtSelection(textareaRef.current, contentMarkdown, replacement, onContentChange);
  }

  function insertListItem() {
    if (!textareaRef.current) return;
    insertListItemAtSelection(textareaRef.current, contentMarkdown, onContentChange);
  }

  async function handleTemplateSelect(templateId: string) {
    if (!templateId) {
      setSelectedTemplateId("");
      return;
    }
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;

    if (contentMarkdown.trim().length > 0 || subject.trim().length > 0) {
      const ok = await confirm({
        confirmLabel: "Apply template",
        description: "Applying this template will replace the current subject and message content.",
        title: "Replace message content?",
      });
      if (!ok) return;
    }

    setSelectedTemplateId(templateId);
    onSubjectChange(template.subject);
    onContentChange(template.contentMarkdown);
    onChannelChange(template.channel);
  }

  // Can the user send or open review?
  const isSendDisabled = communicationSendDisabled({
    busy,
    channel,
    contentMarkdown,
    contextIssues,
    reachState,
    subject,
  });

  return (
    <div className="communication-workspace">
      {/* 1. Recipients Context Card */}
      <RecipientContextPanel
        audience={audience}
        audienceOptions={audienceOptions}
        channel={channel}
        contactLists={contactLists}
        events={events}
        expanded={recipientsExpanded}
        onChannelChange={onChannelChange}
        onToggleExpanded={onToggleRecipientsExpanded}
        onUpdateAudience={onUpdateAudience}
        reachState={reachState}
        rosterConfiguration={rosterConfiguration}
        selectedEvent={selectedEvent}
      />

      {/* 2. Context Conflict Banner */}
      <ConflictBanner
        contextIssues={contextIssues}
        onRemoveConflictingPlaceholder={onRemoveConflictingPlaceholder}
        onToggleRecipientsExpanded={onToggleRecipientsExpanded}
      />

      {/* 3. Optional Template Selector */}
      <div className="communication-composer-template-bar">
        <div className="field">
          <label htmlFor="communication-template-select">Template</label>
          <select
            id="communication-template-select"
            onChange={(e) => void handleTemplateSelect(e.target.value)}
            value={selectedTemplateId}
          >
            <option value="">No template</option>
            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title} ({template.channel})
              </option>
            ))}
          </select>
          {availableTemplates.length === 0 ? (
            <p className="field-help">
              No custom templates match these recipients and delivery channel.
            </p>
          ) : null}
        </div>
      </div>

      {/* 4. Subject Field (for Email and Both) */}
      {channel !== "SMS" ? (
        <div className="field">
          <label htmlFor="communication-subject">Subject</label>
          <input
            id="communication-subject"
            maxLength={300}
            onChange={(e) => {
              onSubjectChange(e.target.value);
            }}
            placeholder="Subject line…"
            required
            value={subject}
          />
        </div>
      ) : null}

      {/* 5. 2-Column Composer (Editor on Left, Live Preview on Right) */}
      <div className="communication-composer-two-column">
        {/* Left Column: Editor & Personalization */}
        <div className="communication-composer-editor-col">
          <div className="field">
            <label htmlFor="communication-body-textarea">Message</label>
            <div aria-label="Formatting tools" className="communication-composer__toolbar">
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
                  insertListItem();
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
              id="communication-body-textarea"
              maxLength={100_000}
              onChange={(e) => {
                onContentChange(e.target.value);
              }}
              placeholder="Write your message here… Markdown formatting is supported."
              ref={textareaRef}
              required
              rows={12}
              value={contentMarkdown}
            />
            <p className="field-help">
              Markdown formatting is supported. Use the live preview to verify how it will look.
            </p>
          </div>

          <PersonalizeSection
            audience={audience}
            events={events}
            needsEvent={needsEvent}
            onInsert={insert}
            onUpdateAudience={onUpdateAudience}
            placeholderGroups={placeholderGroups}
            selectedEvent={selectedEvent}
          />
        </div>

        {/* Right Column: Live Formatted Preview */}
        <div className="communication-composer-preview-col">
          <div className="preview-card">
            <div className="preview-card__header">
              <h4>Live preview</h4>
              <span className="field-help">
                {channel === "SMS" ? "SMS preview" : "Email preview"}
              </span>
            </div>
            {subject && channel !== "SMS" ? (
              <div className="preview-subject">
                <strong>Subject:</strong> {subject}
              </div>
            ) : null}
            <div
              aria-label="Live formatted message preview"
              className="communication-composer__preview preview-body"
              dangerouslySetInnerHTML={{
                __html: renderCommunicationMarkdownPreview(contentMarkdown, previewValues),
              }}
            />
            <p className="field-help preview-footer-note">
              Preview uses a sample recipient. Event values come from the selected event.
            </p>
          </div>
        </div>
      </div>

      {/* 6. Persistent Composer Action Bar */}
      <ComposerActionBar
        busy={busy}
        channel={channel}
        contentMarkdown={contentMarkdown}
        isSendDisabled={isSendDisabled}
        onOpenReview={onOpenReview}
        onOpenSaveTemplate={onOpenSaveTemplate}
        onOpenTestEmail={onOpenTestEmail}
        onSaveDraft={onSaveDraft}
      />
      {confirmationDialog}
    </div>
  );
}
