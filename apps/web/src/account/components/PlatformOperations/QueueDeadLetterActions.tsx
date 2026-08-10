import type { PlatformJobDeadLetterSummary } from "@choir/contracts";

import type { DeadLetterActionTarget } from "./shared";

function canRetry(deadLetter: PlatformJobDeadLetterSummary): boolean {
  return (
    (deadLetter.actionStatus === "open" || deadLetter.actionStatus === "retry_failed") &&
    deadLetter.messageValid &&
    Boolean(deadLetter.organizationId) &&
    Boolean(deadLetter.jobId) &&
    Boolean(deadLetter.jobKind) &&
    Boolean(deadLetter.idempotencyKey) &&
    deadLetter.observedAttempt < 10
  );
}

export function QueueDeadLetterActions({
  deadLetter,
  openAction,
}: {
  readonly deadLetter: PlatformJobDeadLetterSummary;
  readonly openAction: (
    action: DeadLetterActionTarget["action"],
    deadLetter: PlatformJobDeadLetterSummary,
  ) => void;
}) {
  if (deadLetter.actionStatus === "dismissed") return null;
  const retryAllowed = canRetry(deadLetter);

  return (
    <div className="platform-dead-letter-list__actions">
      {retryAllowed ? (
        <button
          className="button button--primary"
          onClick={() => {
            openAction("retry", deadLetter);
          }}
          type="button"
        >
          {deadLetter.actionStatus === "retry_failed" ? "Try retry again" : "Retry job"}
        </button>
      ) : null}
      <button
        className="button button--secondary"
        onClick={() => {
          openAction("dismiss", deadLetter);
        }}
        type="button"
      >
        Dismiss record
      </button>
    </div>
  );
}
