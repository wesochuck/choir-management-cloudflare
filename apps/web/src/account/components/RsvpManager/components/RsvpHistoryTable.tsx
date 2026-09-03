import type { OrganizationEventRsvpHistoryEntry } from "@choir/contracts";
import { DataTable } from "@choir/ui";

import { isHistoryFilter, rsvpHistoryColumns, type HistoryFilter } from "../historyUtils";

export interface RsvpHistoryTableProps {
  readonly filteredHistory: readonly OrganizationEventRsvpHistoryEntry[];
  readonly historyError: string | null;
  readonly historyFilter: HistoryFilter;
  readonly historyLoading: boolean;
  readonly historyQuery: string;
  readonly onRetry: () => void;
  readonly setHistoryFilter: (filter: HistoryFilter) => void;
  readonly setHistoryQuery: (query: string) => void;
  readonly totalHistoryCount: number;
  readonly view: "roster" | "history";
}

export function RsvpHistoryTable({
  filteredHistory,
  historyError,
  historyFilter,
  historyLoading,
  historyQuery,
  onRetry,
  setHistoryFilter,
  setHistoryQuery,
  totalHistoryCount,
  view,
}: RsvpHistoryTableProps) {
  return (
    <section
      className="surface-card rsvp-manager__history"
      aria-labelledby="rsvp-history-title"
      hidden={view !== "history"}
    >
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Audit trail</p>
        <h2 id="rsvp-history-title">Event RSVP History</h2>
        <p className="section-description">
          Actual RSVP changes are shown here separately from Profile Status History.
        </p>
      </div>
      {historyError ? (
        <div className="notice notice--error" role="alert">
          <p>{historyError}</p>
          <button className="button button--secondary button--sm" onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="rsvp-manager__controls rsvp-manager__history-controls">
            <label className="field">
              <span>Search history</span>
              <input
                onChange={(event) => {
                  setHistoryQuery(event.target.value);
                }}
                placeholder="Name, reason, or source"
                type="search"
                value={historyQuery}
              />
            </label>
            <label className="field">
              <span>Filter new RSVP</span>
              <select
                onChange={(event) => {
                  const nextFilter = event.target.value;
                  if (isHistoryFilter(nextFilter)) setHistoryFilter(nextFilter);
                }}
                value={historyFilter}
              >
                <option value="All">All statuses</option>
                <option value="Yes">Attending</option>
                <option value="No">Declined</option>
                <option value="Pending">No response</option>
              </select>
            </label>
          </div>
          <div className="rsvp-manager__table-heading">
            <span aria-live="polite">
              {historyLoading ? "Loading…" : `${String(filteredHistory.length)} shown`}
            </span>
          </div>
          <DataTable
            columns={rsvpHistoryColumns}
            emptyMessage={
              totalHistoryCount === 0
                ? "No RSVP changes recorded for this event yet."
                : "No history entries match these filters."
            }
            initialSort={{ columnId: "occurredAt", direction: "desc" }}
            keySelector={(entry) =>
              `${entry.occurredAt}-${entry.profileId}-${entry.previousRsvp}-${entry.newRsvp}-${entry.reason}`
            }
            rows={filteredHistory}
          />
        </>
      )}
    </section>
  );
}
