import type { PlatformEmailFeedbackView } from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  acknowledgePlatformEmailFeedbackDeadLetter,
  acknowledgePlatformEmailProviderEvent,
  AuthApiError,
  listPlatformEmailFeedbackDeadLetters,
  listPlatformEmailProviderEvents,
  retryPlatformEmailFeedbackDeadLetter,
  retryPlatformEmailProviderEvent,
} from "../../../auth/api";
import { EmailFeedbackActionDialog } from "./EmailFeedbackActionDialog";
import { EmailProviderFeedbackContent } from "./EmailProviderFeedbackContent";
import { type EmailFeedbackActionTarget, type EmailFeedbackState } from "./shared";

async function performEmailFeedbackAction(target: EmailFeedbackActionTarget, reason: string) {
  switch (target.action) {
    case "retry-event":
      return retryPlatformEmailProviderEvent(target.event.eventId, reason);
    case "acknowledge-event":
      return acknowledgePlatformEmailProviderEvent(target.event.eventId, reason);
    case "retry-dead-letter":
      return retryPlatformEmailFeedbackDeadLetter(target.deadLetter.id, reason);
    case "acknowledge-dead-letter":
      return acknowledgePlatformEmailFeedbackDeadLetter(target.deadLetter.id, reason);
    default: {
      const exhaustiveTarget: never = target;
      throw new Error(`Unsupported email feedback action: ${String(exhaustiveTarget)}`);
    }
  }
}

export function EmailProviderFeedbackDirectory() {
  const [feedback, setFeedback] = useState<EmailFeedbackState>({ status: "loading" });
  const [view, setView] = useState<PlatformEmailFeedbackView>("open");
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionTarget, setActionTarget] = useState<EmailFeedbackActionTarget | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    Promise.all([
      listPlatformEmailProviderEvents(null, abortController.signal, view),
      listPlatformEmailFeedbackDeadLetters(null, abortController.signal, view),
    ])
      .then(([events, deadLetters]) => {
        setFeedback({
          deadLetters: deadLetters.deadLetters,
          events: events.events,
          hasMoreDeadLetters: deadLetters.nextCursor !== null,
          hasMoreEvents: events.nextCursor !== null,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setFeedback({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, [refreshKey, view]);

  function openAction(target: EmailFeedbackActionTarget): void {
    setActionTarget(target);
    setActionError(null);
    setActionReason("");
  }

  function closeAction(): void {
    if (actionBusy) return;
    setActionTarget(null);
    setActionError(null);
    setActionReason("");
  }

  async function submitAction(): Promise<void> {
    if (!actionTarget) return;
    const reason = actionReason.trim();
    if (reason.length < 3 || reason.length > 500) {
      setActionError("Enter a reason between 3 and 500 characters.");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await performEmailFeedbackAction(actionTarget, reason);
      setSuccess(
        result.actionStatus === "retry_requested"
          ? "The normalized provider event was queued for another correlation attempt."
          : result.actionStatus === "retry_unavailable"
            ? "This record cannot be retried. Malformed queue messages are acknowledge-only."
            : "The provider feedback record was acknowledged. Its audit history was retained.",
      );
      setFeedback({ status: "loading" });
      setActionTarget(null);
      setActionReason("");
      setRefreshKey((current) => current + 1);
    } catch (failure: unknown) {
      setActionError(
        failure instanceof AuthApiError
          ? failure.message
          : "The provider feedback action could not be completed. Refresh and try again.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  function refresh(): void {
    setSuccess(null);
    setRefreshKey((current) => current + 1);
  }

  function changeView(nextView: PlatformEmailFeedbackView): void {
    setSuccess(null);
    setFeedback({ status: "loading" });
    setView(nextView);
  }

  return (
    <div className="platform-directory" aria-live="polite">
      <h4>Email provider feedback</h4>
      <p>
        Cloudflare Email Sending events are normalized and correlated to the originating
        notification. Retry acts on the stored normalized event only; raw provider payloads and
        email bodies are not retained. Queue dead letters below are acknowledge-only when the
        original message was malformed.
      </p>
      <div className="platform-dead-letter-toolbar">
        <label className="field" htmlFor="platform-email-feedback-view">
          <span>Show</span>
          <select
            id="platform-email-feedback-view"
            onChange={(event) => {
              changeView(event.target.value === "all" ? "all" : "open");
            }}
            value={view}
          >
            <option value="open">Needs review</option>
            <option value="all">All records</option>
          </select>
        </label>
        <button
          className="button button--secondary"
          disabled={feedback.status === "loading"}
          onClick={refresh}
          type="button"
        >
          {feedback.status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {feedback.status === "loading" ? <p>Loading email feedback…</p> : null}
      {feedback.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Email provider feedback could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {feedback.status === "ready" ? (
        <EmailProviderFeedbackContent feedback={feedback} openAction={openAction} />
      ) : null}
      <EmailFeedbackActionDialog
        actionBusy={actionBusy}
        actionError={actionError}
        actionReason={actionReason}
        actionTarget={actionTarget}
        closeAction={closeAction}
        setActionReason={setActionReason}
        submitAction={submitAction}
      />
    </div>
  );
}
