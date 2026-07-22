import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationDeliverySummary,
  CommunicationMessage,
  CommunicationTemplate,
  OrganizationEvent,
} from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  deleteOrganizationCommunicationDraft,
  deleteOrganizationCommunicationTemplate,
  getOrganizationCommunicationDeliverySummary,
  listOrganizationCommunications,
  listOrganizationCommunicationTemplates,
  listOrganizationEvents,
  previewOrganizationCommunicationReach,
  retryOrganizationCommunicationDeliveries,
  saveOrganizationCommunicationDraft,
  saveOrganizationCommunicationTemplate,
  sendOrganizationCommunication,
} from "../auth/api";

const defaultAudience: CommunicationAudienceRequest = {
  eventId: null,
  globalStatuses: ["Active"],
  profileIds: [],
  rsvp: "All",
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

function TemplateLibrary({
  channel,
  contentMarkdown,
  onApply,
  subject,
}: {
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly onApply: (template: CommunicationTemplate) => void;
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
      {templates.length > 0 ? (
        <ul className="account-list">
          {templates.map((template) => (
            <li key={template.id}>
              <div>
                <strong>{template.title}</strong>
                <p>{template.channel}</p>
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
        <p>No templates yet.</p>
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

export function CommunicationCenter({ enabled }: { readonly enabled: boolean }) {
  const [audience, setAudience] = useState<CommunicationAudienceRequest>(defaultAudience);
  const [channel, setChannel] = useState<CommunicationChannel>("Email");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [subject, setSubject] = useState("");
  const [voiceParts, setVoiceParts] = useState("");
  const [messages, setMessages] = useState<readonly CommunicationMessage[]>([]);
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [summary, setSummary] = useState<CommunicationDeliverySummary | null>(null);
  const [reach, setReach] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationCommunications(controller.signal),
      listOrganizationEvents(controller.signal),
    ])
      .then(([loadedMessages, loadedEvents]) => {
        setMessages(loadedMessages);
        setEvents(loadedEvents);
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

  if (!enabled) return null;
  return (
    <section className="panel" aria-labelledby="communications-heading">
      <p className="eyebrow">Manager tools</p>
      <h2 id="communications-heading">Communications</h2>
      <p>Compose Markdown email, SMS, or both. Use {"{singerName}"} for each recipient’s name.</p>
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
          void send();
        }}
      >
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
          <legend>Profile status</legend>
          {(["Active", "Idle", "Inactive"] as const).map((status) => (
            <label key={status}>
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
        </fieldset>
        <div className="field">
          <label htmlFor="communication-voice-parts">Voice parts or sections (optional)</label>
          <input
            id="communication-voice-parts"
            onChange={(event) => {
              setVoiceParts(event.target.value);
              setReach(null);
            }}
            placeholder="S1, S2, A"
            value={voiceParts}
          />
        </div>
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
            <option value="">All matching Profiles</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {eventLabel(event)}
              </option>
            ))}
          </select>
        </div>
        {audience.eventId ? (
          <div className="field">
            <label htmlFor="communication-rsvp">RSVP response</label>
            <select
              id="communication-rsvp"
              onChange={(event) => {
                const value = event.target.value;
                setAudience((current) => ({
                  ...current,
                  rsvp: value === "Yes" || value === "No" || value === "Pending" ? value : "All",
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
          <textarea
            id="communication-content"
            maxLength={100_000}
            onChange={(event) => {
              setContentMarkdown(event.target.value);
            }}
            required
            rows={8}
            value={contentMarkdown}
          />
        </div>
        {reach ? (
          <p className="notice notice--info" role="status">
            {reach}
          </p>
        ) : null}
        <div className="form-actions">
          <button disabled={busy} onClick={() => void previewReach()} type="button">
            Preview reach
          </button>
          <button disabled={busy} onClick={() => void saveDraft()} type="button">
            Save draft
          </button>
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Working…" : "Queue communication"}
          </button>
        </div>
      </form>

      <TemplateLibrary
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

      <h3>History and drafts</h3>
      {messages.length === 0 ? (
        <p>No communications yet.</p>
      ) : (
        <ul className="account-list">
          {messages.map((message) => (
            <li key={message.id}>
              <div>
                <strong>{message.subject || `${message.channel} message`}</strong>
                <p>
                  {message.status} · {message.channel} · {displayDate(message.createdAt)} · reach{" "}
                  {message.reach.total}
                </p>
              </div>
              {message.status !== "Draft" ? (
                <button disabled={busy} onClick={() => void showDelivery(message)} type="button">
                  Delivery status
                </button>
              ) : (
                <button disabled={busy} onClick={() => void deleteDraft(message)} type="button">
                  Delete draft
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {summary ? (
        <div className="notice notice--info" aria-live="polite">
          <p>
            Delivery: {summary.state} · {summary.total.sent} sent · {summary.total.failed} failed ·{" "}
            {summary.total.queued + summary.total.processing} remaining
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
    </section>
  );
}
