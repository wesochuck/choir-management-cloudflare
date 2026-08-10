import type { PlatformJobDeadLetterSummary, PlatformJobDeadLetterView } from "@choir/contracts";

import { QueueDeadLetterRow } from "./QueueDeadLetterRow";
import type { DeadLetterActionTarget, DeadLetterState } from "./shared";

export function QueueDeadLetterContent({
  deadLetters,
  openAction,
  onRefresh,
  onViewChange,
  success,
  setSuccess,
  view,
}: {
  readonly deadLetters: DeadLetterState;
  readonly openAction: (
    action: DeadLetterActionTarget["action"],
    deadLetter: PlatformJobDeadLetterSummary,
  ) => void;
  readonly onRefresh: () => void;
  readonly onViewChange: (view: PlatformJobDeadLetterView) => void;
  readonly success: string | null;
  readonly setSuccess: (message: string | null) => void;
  readonly view: PlatformJobDeadLetterView;
}) {
  return (
    <>
      <div className="platform-dead-letter-toolbar">
        <label className="field" htmlFor="platform-dead-letter-view">
          <span>Show</span>
          <select
            id="platform-dead-letter-view"
            onChange={(event) => {
              setSuccess(null);
              onViewChange(event.target.value === "all" ? "all" : "open");
            }}
            value={view}
          >
            <option value="open">Needs review</option>
            <option value="all">All records</option>
          </select>
        </label>
        <button
          className="button button--secondary"
          disabled={deadLetters.status === "loading"}
          onClick={onRefresh}
          type="button"
        >
          {deadLetters.status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {deadLetters.status === "loading" ? <p>Loading queue failures…</p> : null}
      {deadLetters.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Queue dead-letter visibility could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {deadLetters.status === "ready" && deadLetters.deadLetters.length === 0 ? (
        <p className="empty-state">No jobs have reached the dead-letter queue.</p>
      ) : null}
      {deadLetters.status === "ready" && deadLetters.deadLetters.length > 0 ? (
        <ul className="account-list platform-dead-letter-list">
          {deadLetters.deadLetters.map((deadLetter) => (
            <QueueDeadLetterRow
              deadLetter={deadLetter}
              key={`${deadLetter.queueName}:${deadLetter.messageId}`}
              openAction={openAction}
            />
          ))}
        </ul>
      ) : null}
      {deadLetters.status === "ready" && deadLetters.hasMore ? (
        <p>Showing the 25 most recent queue failures.</p>
      ) : null}
    </>
  );
}
