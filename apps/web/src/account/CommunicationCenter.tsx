import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationDeliverySummary,
  CommunicationMessage,
  CommunicationScheduledMessage,
  CommunicationTemplate,
  OrganizationEvent,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  deleteOrganizationCommunicationDraft,
  deleteOrganizationCommunicationTemplate,
  getOrganizationCommunicationDeliverySummary,
  listOrganizationCommunications,
  getOrganizationRosterConfiguration,
  listOrganizationScheduledMessages,
  listOrganizationCommunicationTemplates,
  listOrganizationEvents,
  previewOrganizationCommunicationReach,
  retryOrganizationCommunicationDeliveries,
  saveOrganizationCommunicationDraft,
  saveOrganizationCommunicationTemplate,
  sendOrganizationCommunication,
  sendOrganizationCommunicationTestEmail,
} from "../auth/api";
import { CommunicationComposer } from "./CommunicationComposer";
import { renderCommunicationMarkdownPreview } from "./communicationMarkdown";
import { templateMatchesCommunicationContext } from "./communicationPlaceholders";
import { OrganizationProviderStatus } from "./OrganizationProviderStatus";

const defaultAudience: CommunicationAudienceRequest = {
  eventId: null,
  globalStatuses: ["Active"],
  profileIds: [],
  rsvp: "All",
  targetAudiences: ["Members"],
  voiceParts: [],
};

function failureMessage(error: unknown): string {
  return error instanceof AuthApiError
    ? error.message
    : "Organization communications are temporarily unavailable.";
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function eventLabel(event: OrganizationEvent): string {
  return `${event.title} · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(event.startsAt))}`;
}

function channelFromValue(value: string): CommunicationChannel {
  if (value === "SMS" || value === "Both") return value;
  return "Email";
}

function CommunicationSectionPicker({
  configuration,
  onChange,
  value,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onChange: (sections: readonly string[]) => void;
  readonly value: string;
}) {
  const sections = configuration.sections.filter(({ trackOnly }) => !trackOnly);
  const selected = value
    .split(",")
    .map((section) => section.trim())
    .filter((section) => sections.some(({ code }) => code === section));

  function toggle(sectionCode: string, checked: boolean): void {
    const next = checked
      ? [...new Set([...selected, sectionCode])]
      : selected.filter((code) => code !== sectionCode);
    onChange(next);
  }

  const selectedLabel =
    selected.length === 0
      ? "All sections"
      : selected.length === 1
        ? (sections.find(({ code }) => code === selected[0])?.name ?? selected[0])
        : `${String(selected.length)} sections selected`;

  return (
    <div className="field communication-section-picker-field">
      <span className="field-label">Sections (optional)</span>
      <details className="communication-section-picker">
        <summary>
          <span>Member sections</span>
          <span className="communication-section-picker__summary-value">{selectedLabel}</span>
        </summary>
        <div className="communication-section-picker__panel">
          <p className="field-help">Choose one or more sections. Track-only sections are hidden.</p>
          <div className="checkbox-grid">
            {sections.map((section) => (
              <label className="checkbox-row" key={section.code}>
                <input
                  checked={selected.includes(section.code)}
                  type="checkbox"
                  onChange={(event) => {
                    toggle(section.code, event.target.checked);
                  }}
                />
                {section.name}
              </label>
            ))}
          </div>
          {selected.length > 0 ? (
            <button
              className="button button--secondary"
              onClick={() => {
                onChange([]);
              }}
              type="button"
            >
              Clear sections
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}

const audienceOptions = ["Members", "Ticket Buyers", "Donors"] as const;
type CommunicationStage = "audience" | "compose";
type CommunicationTab = "compose" | "drafts" | "history" | "templates" | "upcoming" | "settings";

const defaultTestEmailSubject = "Choir Management connection test";
const defaultTestEmailContent =
  "This is a test email from Choir Management. Your organization email delivery is configured.";

function TemplateLibrary({
  audience,
  channel,
  contentMarkdown,
  onApply,
  subject,
  showAll = false,
}: {
  readonly audience: CommunicationAudienceRequest;
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly onApply: (template: CommunicationTemplate) => void;
  readonly showAll?: boolean;
  readonly subject: string;
}) {
  const [templates, setTemplates] = useState<readonly CommunicationTemplate[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listOrganizationCommunicationTemplates(controller.signal)
      .then(setTemplates)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      });
    return () => {
      controller.abort();
    };
  }, []);

  const visibleTemplates = showAll
    ? templates
    : templates.filter((template) =>
        templateMatchesCommunicationContext(template, audience, channel),
      );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrganizationCommunicationTemplate({
        channel,
        contentMarkdown,
        subject,
        title,
      });
      setTemplates((current) => [...current, saved].sort((a, b) => a.title.localeCompare(b.title)));
      setTitle("");
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(template: CommunicationTemplate) {
    if (!window.confirm(`Delete template “${template.title}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationCommunicationTemplate(template.id);
      setTemplates((current) => current.filter(({ id }) => id !== template.id));
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-stack" aria-labelledby="communication-templates-heading">
      <h3 id="communication-templates-heading">Templates</h3>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {visibleTemplates.length > 0 ? (
        <ul className="account-list">
          {visibleTemplates.map((template) => (
            <li key={template.id}>
              <div>
                <strong>{template.title}</strong>
                <p>
                  {template.channel}
                  {template.isSystem ? " · System template" : ""}
                </p>
              </div>
              <span className="button-row">
                <button
                  disabled={busy}
                  onClick={() => {
                    onApply(template);
                  }}
                  type="button"
                >
                  Use template
                </button>
                {!template.isSystem ? (
                  <button disabled={busy} onClick={() => void remove(template)} type="button">
                    Delete
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No templates match this channel and audience yet.</p>
      )}
      <div className="field">
        <label htmlFor="communication-template-title">Save current message as a template</label>
        <input
          id="communication-template-title"
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          value={title}
        />
      </div>
      <button
        disabled={busy || !title.trim() || !contentMarkdown.trim()}
        onClick={() => void save()}
        type="button"
      >
        Save template
      </button>
    </div>
  );
}

// eslint-disable-next-line complexity -- this coordinator owns compose, audience, scheduled-message, and delivery workflows.
export function CommunicationCenter({ enabled }: { readonly enabled: boolean }) {
  const draftId = new URLSearchParams(window.location.search).get("draftId");
  const [audience, setAudience] = useState<CommunicationAudienceRequest>(defaultAudience);
  const [channel, setChannel] = useState<CommunicationChannel>("Email");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [subject, setSubject] = useState("");
  const [voiceParts, setVoiceParts] = useState("");
  const [messages, setMessages] = useState<readonly CommunicationMessage[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<
    readonly CommunicationScheduledMessage[]
  >([]);
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [rosterConfiguration, setRosterConfiguration] =
    useState<OrganizationRosterConfiguration | null>(null);
  const [summary, setSummary] = useState<CommunicationDeliverySummary | null>(null);
  const [reach, setReach] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [activeTab, setActiveTab] = useState<CommunicationTab>(draftId ? "compose" : "compose");
  const [stage, setStage] = useState<CommunicationStage>("audience");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function resumeDraft(draft: CommunicationMessage) {
    setAudience(draft.audience);
    setChannel(draft.channel);
    setContentMarkdown(draft.contentMarkdown);
    setSubject(draft.subject);
    setVoiceParts(draft.audience.voiceParts.join(", "));
    setStage("compose");
    setActiveTab("compose");
    setSuccess("Draft loaded. Review the message and queue it when it is ready.");
  }

  function startNewMessage() {
    setAudience(defaultAudience);
    setChannel("Email");
    setContentMarkdown("");
    setSubject("");
    setVoiceParts("");
    setReach(null);
    setSummary(null);
    setError(null);
    setSuccess(null);
    setStage("audience");
    setActiveTab("compose");
  }

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationCommunications(controller.signal),
      listOrganizationScheduledMessages(controller.signal),
      listOrganizationEvents(controller.signal),
    ])
      .then(([loadedMessages, loadedScheduledMessages, loadedEvents]) => {
        setMessages(loadedMessages);
        setScheduledMessages(loadedScheduledMessages);
        setEvents(loadedEvents);
        const draft = draftId
          ? loadedMessages.find((message) => message.id === draftId && message.status === "Draft")
          : null;
        if (draft) {
          resumeDraft(draft);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      });
    return () => {
      controller.abort();
    };
  }, [draftId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganizationRosterConfiguration(controller.signal)
      .then((configuration) => {
        if (!controller.signal.aborted) setRosterConfiguration(configuration);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  function composeRequest() {
    return {
      audience: {
        ...audience,
        voiceParts: voiceParts
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      },
      channel,
      contentMarkdown,
      subject,
    };
  }

  async function previewReach() {
    setBusy(true);
    setError(null);
    try {
      const result = await previewOrganizationCommunicationReach(composeRequest());
      setReach(
        `${String(result.total)} reachable · ${String(result.email)} by email · ${String(result.sms)} by SMS · ${String(result.unreachable)} unreachable`,
      );
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function openFinalPreview() {
    setBusy(true);
    setError(null);
    try {
      const result = await previewOrganizationCommunicationReach(composeRequest());
      setReach(
        `${String(result.total)} reachable · ${String(result.email)} by email · ${String(result.sms)} by SMS · ${String(result.unreachable)} unreachable`,
      );
      setPreviewOpen(true);
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function sendTestEmail() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const recipient = testEmail.trim();
    const testSubject = subject.trim() || defaultTestEmailSubject;
    const testContent = contentMarkdown.trim() || defaultTestEmailContent;
    try {
      await sendOrganizationCommunicationTestEmail({
        contentMarkdown: testContent,
        email: recipient,
        subject: testSubject,
      });
      setSuccess(`Test email accepted for delivery to ${recipient}.`);
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const message = await saveOrganizationCommunicationDraft(composeRequest());
      setMessages((current) => [message, ...current]);
      setSuccess("Draft saved.");
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const message = await sendOrganizationCommunication(composeRequest());
      setMessages((current) => [message, ...current]);
      setContentMarkdown("");
      setSubject("");
      setReach(null);
      setPreviewOpen(false);
      setSuccess("Communication queued for delivery.");
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function showDelivery(message: CommunicationMessage) {
    setBusy(true);
    setError(null);
    try {
      setSummary(await getOrganizationCommunicationDeliverySummary(message.id));
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function retryFailed() {
    if (!summary) return;
    setBusy(true);
    setError(null);
    try {
      const retried = await retryOrganizationCommunicationDeliveries(summary.messageId);
      setSummary(null);
      setSuccess(
        `${String(retried)} failed ${retried === 1 ? "delivery" : "deliveries"} queued again.`,
      );
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft(message: CommunicationMessage) {
    if (!window.confirm("Delete this communication draft?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationCommunicationDraft(message.id);
      setMessages((current) => current.filter(({ id }) => id !== message.id));
      setSuccess("Draft deleted.");
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function toggleStatus(status: "Active" | "Idle" | "Inactive", checked: boolean) {
    setAudience((current) => ({
      ...current,
      globalStatuses: checked
        ? [...new Set([...current.globalStatuses, status])]
        : current.globalStatuses.filter((candidate) => candidate !== status),
    }));
  }

  function toggleAudience(target: (typeof audienceOptions)[number], checked: boolean) {
    setAudience((current) => ({
      ...current,
      targetAudiences: checked
        ? [...new Set([...current.targetAudiences, target])]
        : current.targetAudiences.filter((candidate) => candidate !== target),
    }));
    setReach(null);
  }

  function scheduledKindLabel(kind: CommunicationScheduledMessage["kind"]): string {
    switch (kind) {
      case "attendance_report":
        return "Attendance report";
      case "event_reminder":
        return "Event reminder";
      case "ticket_confirmation":
        return "Ticket confirmation";
      case "ticket_reminder":
        return "Ticket buyer reminder";
    }
  }

  if (!enabled) return null;
  return (
    <section className="panel" aria-label="Communication center">
      <p className="section-description">
        Build a message in three steps: choose the audience, write with Markdown and placeholders,
        then review it before queueing delivery.
      </p>
      <nav className="communication-tabs" aria-label="Communication sections">
        {(
          [
            ["compose", "Compose"],
            ["drafts", "Drafts"],
            ["history", "History"],
            ["templates", "Templates"],
            ["upcoming", "Upcoming sends"],
            ["settings", "Settings"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={activeTab === value}
            className={activeTab === value ? "is-active" : ""}
            onClick={() => {
              setActiveTab(value);
            }}
            role="tab"
            type="button"
          >
            {label}
            {value === "drafts" &&
            messages.filter((message) => message.status === "Draft").length > 0 ? (
              <span className="communication-tabs__count">
                {String(messages.filter((message) => message.status === "Draft").length)}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      {activeTab === "compose" ? (
        <>
          <ol className="communication-stepper" aria-label="Message workflow">
            <li className={stage === "audience" ? "is-active" : "is-complete"}>
              <span>1</span> Audience
            </li>
            <li className={stage === "compose" ? "is-active" : ""}>
              <span>2</span> Compose
            </li>
            <li>
              <span>3</span> Review &amp; send
            </li>
          </ol>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="notice notice--success" role="status">
              {success}
            </p>
          ) : null}

          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (stage === "audience") {
                setStage("compose");
              } else {
                void openFinalPreview();
              }
            }}
          >
            {stage === "audience" ? (
              <>
                <div className="field">
                  <label htmlFor="communication-channel">Channel</label>
                  <select
                    id="communication-channel"
                    onChange={(event) => {
                      setChannel(channelFromValue(event.target.value));
                      setReach(null);
                    }}
                    value={channel}
                  >
                    <option>Email</option>
                    <option>SMS</option>
                    <option>Both</option>
                  </select>
                </div>
                <fieldset>
                  <legend>Audience</legend>
                  <p className="field-help">
                    Donors and ticket buyers include paid contacts who opted into updates. An
                    event-specific ticket audience includes all paid buyers for that event.
                  </p>
                  <div className="checkbox-grid">
                    {audienceOptions.map((target) => (
                      <label key={target} className="checkbox-row">
                        <input
                          checked={audience.targetAudiences.includes(target)}
                          disabled={
                            audience.targetAudiences.length === 1 &&
                            audience.targetAudiences.includes(target)
                          }
                          onChange={(event) => {
                            toggleAudience(target, event.target.checked);
                          }}
                          type="checkbox"
                        />
                        {target}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {audience.targetAudiences.includes("Members") ? (
                  <>
                    <fieldset>
                      <legend>Profile status</legend>
                      <div className="communication-status-options">
                        {(["Active", "Idle", "Inactive"] as const).map((status) => (
                          <label key={status} className="checkbox-row">
                            <input
                              checked={audience.globalStatuses.includes(status)}
                              onChange={(event) => {
                                toggleStatus(status, event.target.checked);
                                setReach(null);
                              }}
                              type="checkbox"
                            />
                            {status === "Idle" ? "On Break" : status}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {rosterConfiguration ? (
                      <CommunicationSectionPicker
                        configuration={rosterConfiguration}
                        onChange={(sections) => {
                          setVoiceParts(sections.join(", "));
                          setReach(null);
                        }}
                        value={voiceParts}
                      />
                    ) : null}
                  </>
                ) : null}
                {audience.targetAudiences.includes("Members") ||
                audience.targetAudiences.includes("Ticket Buyers") ? (
                  <div className="field">
                    <label htmlFor="communication-event">Event audience (optional)</label>
                    <select
                      id="communication-event"
                      onChange={(event) => {
                        const eventId = event.target.value || null;
                        setAudience((current) => ({
                          ...current,
                          eventId,
                          rsvp: eventId ? current.rsvp : "All",
                        }));
                        setReach(null);
                      }}
                      value={audience.eventId ?? ""}
                    >
                      <option value="">All matching contacts</option>
                      {events.map((event) => (
                        <option key={event.id} value={event.id}>
                          {eventLabel(event)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {audience.eventId && audience.targetAudiences.includes("Members") ? (
                  <div className="field">
                    <label htmlFor="communication-rsvp">Member RSVP response</label>
                    <select
                      id="communication-rsvp"
                      onChange={(event) => {
                        const value = event.target.value;
                        setAudience((current) => ({
                          ...current,
                          rsvp:
                            value === "Yes" || value === "No" || value === "Pending"
                              ? value
                              : "All",
                        }));
                        setReach(null);
                      }}
                      value={audience.rsvp}
                    >
                      <option value="All">Any response</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                      <option value="Pending">Pending</option>
                    </select>
                  </div>
                ) : null}
                <div className="form-actions form-actions--end">
                  <button className="button button--primary" type="submit">
                    Continue to compose
                  </button>
                </div>
              </>
            ) : (
              <>
                <TemplateLibrary
                  audience={audience}
                  channel={channel}
                  contentMarkdown={contentMarkdown}
                  onApply={(template) => {
                    setChannel(template.channel);
                    setContentMarkdown(template.contentMarkdown);
                    setSubject(template.subject);
                    setReach(null);
                  }}
                  subject={subject}
                />
                {channel !== "SMS" ? (
                  <div className="field">
                    <label htmlFor="communication-subject">Subject</label>
                    <input
                      id="communication-subject"
                      maxLength={300}
                      onChange={(event) => {
                        setSubject(event.target.value);
                      }}
                      required
                      value={subject}
                    />
                  </div>
                ) : null}
                <div className="field">
                  <label htmlFor="communication-content">Message</label>
                  <CommunicationComposer
                    audience={audience}
                    channel={channel}
                    contentMarkdown={contentMarkdown}
                    onContentChange={(value) => {
                      setContentMarkdown(value);
                    }}
                  />
                </div>
                {reach ? (
                  <p className="notice notice--info" role="status">
                    {reach}
                  </p>
                ) : null}
                <div className="form-actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setStage("audience");
                    }}
                    type="button"
                  >
                    Back to audience
                  </button>
                  <button disabled={busy} onClick={() => void previewReach()} type="button">
                    Preview reach
                  </button>
                  <button disabled={busy} onClick={() => void saveDraft()} type="button">
                    Save draft
                  </button>
                  <button className="button button--primary" disabled={busy} type="submit">
                    {busy ? "Working…" : "Preview before queueing"}
                  </button>
                </div>
              </>
            )}
          </form>

          <Dialog
            description="Review the exact message and audience reach before queueing it for delivery."
            onClose={() => {
              if (!busy) setPreviewOpen(false);
            }}
            open={previewOpen}
            title="Final message preview"
          >
            <div className="communication-preview">
              <dl>
                <div>
                  <dt>Channel</dt>
                  <dd>{channel}</dd>
                </div>
                {channel !== "SMS" ? (
                  <div>
                    <dt>Subject</dt>
                    <dd>{subject}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Audience reach</dt>
                  <dd>{reach ?? "Reach not calculated"}</dd>
                </div>
              </dl>
              <div
                className="communication-preview__message communication-composer__preview"
                dangerouslySetInnerHTML={{
                  __html: renderCommunicationMarkdownPreview(contentMarkdown),
                }}
              />
              <p className="field-help">
                Queueing will create delivery records for the selected audience. You can review
                delivery status afterward.
              </p>
            </div>
            <div className="dialog__actions">
              <button
                className="button button--secondary"
                disabled={busy}
                onClick={() => {
                  setPreviewOpen(false);
                }}
                type="button"
              >
                Back to edit
              </button>
              <button
                className="button button--primary"
                disabled={busy}
                onClick={() => void send()}
                type="button"
              >
                {busy ? "Queueing…" : "Queue communication"}
              </button>
            </div>
          </Dialog>
        </>
      ) : null}

      {activeTab === "drafts" ? (
        <div className="communication-tab-panel" role="tabpanel">
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Drafts</h2>
              <p>Resume a saved message or remove drafts you no longer need.</p>
            </div>
            <button className="button button--primary" onClick={startNewMessage} type="button">
              New message
            </button>
          </div>
          {messages.filter((message) => message.status === "Draft").length === 0 ? (
            <p>No communication drafts yet.</p>
          ) : (
            <ul className="account-list">
              {messages
                .filter((message) => message.status === "Draft")
                .map((message) => (
                  <li key={message.id}>
                    <div>
                      <strong>{message.subject || `${message.channel} message`}</strong>
                      <p>
                        {message.channel} · {displayDate(message.createdAt)}
                      </p>
                    </div>
                    <div className="button-row">
                      <button
                        disabled={busy}
                        onClick={() => {
                          resumeDraft(message);
                        }}
                        type="button"
                      >
                        Open draft
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void deleteDraft(message)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : null}

      {activeTab === "history" ? (
        <div className="communication-tab-panel" role="tabpanel">
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Message history</h2>
              <p>Review queued and completed messages, then inspect delivery details.</p>
            </div>
          </div>
          {messages.filter((message) => message.status !== "Draft").length === 0 ? (
            <p>No communications have been sent yet.</p>
          ) : (
            <ul className="account-list">
              {messages
                .filter((message) => message.status !== "Draft")
                .map((message) => (
                  <li key={message.id}>
                    <div>
                      <strong>{message.subject || `${message.channel} message`}</strong>
                      <p>
                        {message.status} · {message.channel} · {displayDate(message.createdAt)} ·
                        reach {String(message.reach.total)}
                      </p>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => void showDelivery(message)}
                      type="button"
                    >
                      Delivery status
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {summary ? (
            <div className="notice notice--info" aria-live="polite">
              <p>
                Delivery: {summary.state} · {summary.total.sent} sent · {summary.total.failed}{" "}
                failed · {summary.total.queued + summary.total.processing} remaining
              </p>
              {summary.failures.length > 0 ? (
                <ul>
                  {summary.failures.map((failure, index) => (
                    <li key={`${failure.maskedDestination}:${String(index)}`}>
                      {failure.maskedDestination}: {failure.category}
                    </li>
                  ))}
                </ul>
              ) : null}
              {summary.total.failed > 0 ? (
                <button disabled={busy} onClick={() => void retryFailed()} type="button">
                  Retry failed deliveries
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "templates" ? (
        <div className="communication-tab-panel" role="tabpanel">
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Message templates</h2>
              <p>Keep reusable messages in one place, then apply them while composing.</p>
            </div>
          </div>
          <TemplateLibrary
            audience={audience}
            channel={channel}
            contentMarkdown={contentMarkdown}
            onApply={(template) => {
              setChannel(template.channel);
              setContentMarkdown(template.contentMarkdown);
              setSubject(template.subject);
              setReach(null);
              setActiveTab("compose");
              setStage("compose");
            }}
            showAll
            subject={subject}
          />
        </div>
      ) : null}

      {activeTab === "upcoming" ? (
        <div className="communication-tab-panel" role="tabpanel">
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Upcoming sends</h2>
              <p>See automated reminders and reports that are scheduled for delivery.</p>
            </div>
          </div>
          {scheduledMessages.length === 0 ? (
            <p>No scheduled messages yet.</p>
          ) : (
            <ul className="account-list">
              {scheduledMessages.map((message) => (
                <li key={message.id}>
                  <div>
                    <strong>{scheduledKindLabel(message.kind)}</strong>
                    <p>
                      {message.eventTitle} · {message.subject}
                    </p>
                  </div>
                  <div>
                    <span className="status-pill">{message.status}</span>
                    <p>{displayDate(message.scheduledAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {activeTab === "settings" ? (
        <div className="communication-tab-panel" role="tabpanel">
          <OrganizationProviderStatus />
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Communication settings</h2>
              <p>Verify delivery before sending a message to a larger audience.</p>
            </div>
          </div>
          <fieldset className="communication-test-send">
            <legend>Connection test</legend>
            <p className="field-help">
              Send a test message to one address to verify the configured delivery service. If a
              message is already composed, its subject and content will be used.
            </p>
            <div className="form-actions form-actions--start">
              <div className="field communication-test-send__address">
                <label htmlFor="communication-settings-test-email">Test recipient</label>
                <input
                  id="communication-settings-test-email"
                  onChange={(event) => {
                    setTestEmail(event.target.value);
                  }}
                  placeholder="you@example.com"
                  type="email"
                  value={testEmail}
                />
              </div>
              <button
                className="button button--secondary communication-test-send__button"
                disabled={busy || !testEmail.trim()}
                onClick={() => void sendTestEmail()}
                type="button"
              >
                Send test email
              </button>
            </div>
            <p className="field-help">
              Sender and domain delivery settings are controlled by the organization’s configured
              email service.
            </p>
          </fieldset>
          <p className="field-help">
            Need to change organization-wide sender or compliance details? Open{" "}
            <a href="/admin/settings">Organization settings</a>.
          </p>
        </div>
      ) : null}
    </section>
  );
}
