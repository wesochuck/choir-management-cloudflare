import type { OrganizationEvent, OrganizationRosterConfiguration } from "@choir/contracts";

import { reportableSections, reportableVoiceParts } from "../historyUtils";
import { displayEventDate } from "../rsvpFormat";
import type { RsvpAssignmentFilter, RsvpCounts, RsvpFilter, RsvpView } from "../types";
import { RsvpDeadlineNotice } from "./RsvpDeadlineNotice";

export interface RsvpManagerFiltersProps {
  readonly assignmentFilter: RsvpAssignmentFilter | null;
  readonly counts: RsvpCounts;
  readonly eventId: string;
  readonly events: readonly OrganizationEvent[];
  readonly filter: RsvpFilter;
  readonly onEventChange: (id: string) => void;
  readonly partLabel: string;
  readonly roster: OrganizationRosterConfiguration;
  readonly sectionCounts: ReadonlyMap<string, number>;
  readonly selectedEvent: OrganizationEvent | null;
  readonly setFilter: (filter: RsvpFilter) => void;
  readonly setView: (view: RsvpView) => void;
  readonly toggleAssignmentFilter: (next: RsvpAssignmentFilter) => void;
  readonly view: RsvpView;
  readonly voicePartCounts: ReadonlyMap<string, number>;
}

export function RsvpManagerFilters({
  assignmentFilter,
  counts,
  eventId,
  events,
  filter,
  onEventChange,
  partLabel,
  roster,
  sectionCounts,
  selectedEvent,
  setFilter,
  setView,
  toggleAssignmentFilter,
  view,
  voicePartCounts,
}: RsvpManagerFiltersProps) {
  return (
    <fieldset className="surface-card roster-balance rsvp-manager__balance">
      <legend id="rsvp-balance-title">{partLabel} RSVP balance</legend>
      <div className="roster-balance__header">
        <div>
          <p className="field-help">
            Select a section or {partLabel.toLowerCase()} to filter the roster below.
          </p>
          <div className="rsvp-manager__performance-row">
            <label className="field rsvp-manager__performance">
              <span>Performance</span>
              <select
                onChange={(event) => {
                  onEventChange(event.target.value);
                }}
                value={eventId}
              >
                <option value="">Choose performance</option>
                {events
                  .filter((event) => event.type === "Performance")
                  .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
                  .map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title} · {displayEventDate(event.startsAt)}
                    </option>
                  ))}
              </select>
            </label>
            <RsvpDeadlineNotice event={selectedEvent} />
          </div>
        </div>
        <div className="rsvp-manager__summary-actions">
          <span className="status-pill">Total: {counts.active} active</span>
          {eventId ? (
            <a
              className="button button--secondary button--sm"
              href={`/api/organization/events/${encodeURIComponent(eventId)}/rsvp-export.csv?sort=lastName`}
            >
              Export CSV
            </a>
          ) : null}
        </div>
      </div>
      <div className="rsvp-status-filters" role="tablist" aria-label="RSVP views">
        {(
          [
            ["active", `All active (${String(counts.active)})`],
            ["Yes", `Attending (${String(counts.attending)})`],
            ["No", `Declined (${String(counts.declined)})`],
            ["Pending", `No response (${String(counts.pending)})`],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={view === "roster" && filter === value}
            className={view === "roster" && filter === value ? "is-active" : undefined}
            key={value}
            onClick={() => {
              setFilter(value);
              setView("roster");
            }}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
        <button
          aria-selected={view === "history"}
          className={view === "history" ? "is-active" : undefined}
          onClick={() => {
            setView("history");
          }}
          role="tab"
          type="button"
        >
          History
        </button>
      </div>
      <div className="roster-balance__sections">
        {reportableSections(roster).map((section) => {
          const selected =
            assignmentFilter?.kind === "section" && assignmentFilter.value === section.code;
          return (
            <button
              aria-pressed={selected}
              className={`roster-balance__section${selected ? " roster-balance__section--selected" : ""}`}
              key={section.code}
              onClick={() => {
                toggleAssignmentFilter({ kind: "section", value: section.code });
              }}
              type="button"
            >
              <span>{section.name}</span>
              <strong>{sectionCounts.get(section.code) ?? 0}</strong>
            </button>
          );
        })}
      </div>
      <div className="roster-balance__parts">
        {reportableVoiceParts(roster).map((voicePart) => {
          const selected =
            assignmentFilter?.kind === "voicePart" && assignmentFilter.value === voicePart.label;
          return (
            <button
              aria-pressed={selected}
              className={`roster-balance__part${selected ? " roster-balance__part--selected" : ""}`}
              key={voicePart.label}
              onClick={() => {
                toggleAssignmentFilter({ kind: "voicePart", value: voicePart.label });
              }}
              type="button"
            >
              <span>{voicePart.label}</span>
              <strong>{voicePartCounts.get(voicePart.label) ?? 0}</strong>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
