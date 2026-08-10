import type { PlatformJobDeadLetterSummary } from "@choir/contracts";

import { deadLetterActionLabel, displayDate } from "./shared";

export function QueueDeadLetterCopy({
  deadLetter,
}: {
  readonly deadLetter: PlatformJobDeadLetterSummary;
}) {
  return (
    <div className="platform-dead-letter-list__copy">
      <h5>{deadLetter.jobKind ?? "Invalid queue message"}</h5>
      <p>
        {deadLetter.organizationId ?? "No validated Organization"} · observed{" "}
        {displayDate(deadLetter.lastSeenAt)}
      </p>
      <p className="platform-dead-letter-list__meta">
        Message {deadLetter.messageId} · queue attempt {String(deadLetter.observedAttempt)}
      </p>
      <span className="status-pill">
        {deadLetterActionLabel(deadLetter.actionStatus)} ·{" "}
        {deadLetter.observationCount === 1
          ? "recorded once"
          : `recorded ${String(deadLetter.observationCount)} times`}
      </span>
      {deadLetter.actionError ? (
        <p className="notice notice--warning">{deadLetter.actionError}</p>
      ) : null}
      {deadLetter.actionStatus !== "open" && deadLetter.actionAt ? (
        <p className="platform-dead-letter-list__meta">
          {deadLetterActionLabel(deadLetter.actionStatus)} {displayDate(deadLetter.actionAt)}
          {deadLetter.actionReason ? ` · ${deadLetter.actionReason}` : ""}
        </p>
      ) : null}
      {deadLetter.actionStatus === "retry_queued" ? (
        <p className="platform-dead-letter-list__hint">
          The new attempt is in the normal job queue. Check the originating notification for its
          result.
        </p>
      ) : null}
    </div>
  );
}
