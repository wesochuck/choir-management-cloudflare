import type { PlatformEmailFeedbackDeadLetter, PlatformEmailProviderEvent } from "@choir/contracts";

import { displayDate, providerEventStatusLabel, type EmailFeedbackActionTarget } from "./shared";

type OpenEmailAction = (target: EmailFeedbackActionTarget) => void;

export function EmailProviderEventRow({
  event,
  openAction,
}: {
  readonly event: PlatformEmailProviderEvent;
  readonly openAction: OpenEmailAction;
}) {
  return (
    <li>
      <div className="platform-dead-letter-list__copy">
        <h5>{event.recipient}</h5>
        <p>{providerEventStatusLabel(event)}</p>
        <p className="platform-dead-letter-list__meta">
          {event.organizationId ?? "Unmatched Organization"} · message {event.messageId}
        </p>
        <p className="platform-dead-letter-list__meta">
          {event.sourceKind ?? "Unmatched route"} · updated {displayDate(event.updatedAt)}
        </p>
        {event.lastError ? <p className="notice notice--warning">{event.lastError}</p> : null}
        {event.operatorStatus === "acknowledged" && event.operatorReason ? (
          <p className="platform-dead-letter-list__meta">Acknowledged: {event.operatorReason}</p>
        ) : null}
      </div>
      {event.state !== "processed" ? (
        <div className="platform-dead-letter-list__actions">
          <button
            className="button button--primary"
            onClick={() => {
              openAction({ action: "retry-event", event });
            }}
            type="button"
          >
            Retry correlation
          </button>
          <button
            className="button button--secondary"
            onClick={() => {
              openAction({ action: "acknowledge-event", event });
            }}
            type="button"
          >
            Acknowledge
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function EmailFeedbackDeadLetterRow({
  deadLetter,
  openAction,
}: {
  readonly deadLetter: PlatformEmailFeedbackDeadLetter;
  readonly openAction: OpenEmailAction;
}) {
  return (
    <li>
      <div className="platform-dead-letter-list__copy">
        <h5>{deadLetter.queueName}</h5>
        <p>
          {deadLetter.eventId ? `Event ${deadLetter.eventId}` : "Malformed message"} · observed{" "}
          {displayDate(deadLetter.lastSeenAt)}
        </p>
        <p className="platform-dead-letter-list__meta">
          {deadLetter.reason} · message {deadLetter.messageId} · attempt{" "}
          {String(deadLetter.observedAttempt)}
        </p>
        <span className="status-pill">
          {deadLetter.actionStatus === "acknowledged" ? "Acknowledged" : "Needs review"}
        </span>
        {!deadLetter.retryable ? (
          <p className="platform-dead-letter-list__hint">
            This message was malformed and cannot be replayed. Acknowledge it after recording the
            operator decision.
          </p>
        ) : null}
      </div>
      {deadLetter.actionStatus === "open" ? (
        <div className="platform-dead-letter-list__actions">
          {deadLetter.retryable ? (
            <button
              className="button button--primary"
              onClick={() => {
                openAction({ action: "retry-dead-letter", deadLetter });
              }}
              type="button"
            >
              Retry event
            </button>
          ) : null}
          <button
            className="button button--secondary"
            onClick={() => {
              openAction({ action: "acknowledge-dead-letter", deadLetter });
            }}
            type="button"
          >
            Acknowledge
          </button>
        </div>
      ) : null}
    </li>
  );
}
