import type { OrganizationEvent, OrganizationRosterConfiguration } from "@choir/contracts";
import { type CSSProperties, type ReactNode, useMemo } from "react";

import { AppLink } from "../../AuthenticatedShell/navigation";
import { buildRosterBalanceLayout } from "../../../rosterBalanceLayout";
import { reportableSections, reportableVoiceParts } from "../historyUtils";
import { displayEventDate } from "../rsvpFormat";
import type { RsvpAssignmentFilter, RsvpCounts, RsvpFilter, RsvpView } from "../types";
import { RsvpDeadlineNotice } from "./RsvpDeadlineNotice";

export interface RsvpManagerFiltersProps {
  readonly assignmentFilter: RsvpAssignmentFilter | null;
  readonly canManageEvents?: boolean | undefined;
  readonly counts: RsvpCounts;
  readonly eventId: string;
  readonly events: readonly OrganizationEvent[];
  readonly filter: RsvpFilter;
  readonly navigate?: ((href: string) => void) | undefined;
  readonly onEventChange: (id: string) => void;
  readonly notificationFooter?: ReactNode | undefined;
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
  canManageEvents = true,
  counts,
  eventId,
  events,
  filter,
  navigate,
  onEventChange,
  notificationFooter,
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
  const layout = useMemo(() => {
    const reportableSecs = reportableSections(roster);
    const reportableParts = reportableVoiceParts(roster);
    return buildRosterBalanceLayout(reportableSecs, reportableParts);
  }, [roster]);

  const balanceGridStyle: (CSSProperties & { "--roster-balance-columns"?: number }) | undefined =
    layout.valid && layout.columnCount > 0
      ? {
          "--roster-balance-columns": layout.columnCount,
        }
      : undefined;

  const editRsvpSettingsHref =
    canManageEvents &&
    selectedEvent &&
    (selectedEvent.type === "Performance" || selectedEvent.type === "Other")
      ? `/admin/events?${new URLSearchParams({
          eventId: selectedEvent.id,
          section: "rsvp",
          returnTo: `/admin/rsvp?${new URLSearchParams({ eventId: selectedEvent.id }).toString()}`,
        }).toString()}`
      : null;

  return (
    <fieldset className="surface-card roster-balance rsvp-manager__balance">
      <legend id="rsvp-balance-title">{partLabel} RSVP balance</legend>
      <div className="roster-balance__header">
        <div>
          <p className="field-help">
            Select a section or {partLabel.toLowerCase()} to filter the roster below.
          </p>
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
      <div className="rsvp-manager__performance-row">
        <div className="field rsvp-manager__performance">
          <label htmlFor="rsvp-manager-select-event">Performance</label>
          <div className="rsvp-manager__performance-control-row">
            <select
              id="rsvp-manager-select-event"
              onChange={(event) => {
                onEventChange(event.target.value);
              }}
              value={eventId}
            >
              <option value="">Choose performance or event</option>
              {events
                .filter((event) => event.type === "Performance" || event.type === "Other")
                .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
                .map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                    {event.type === "Other" ? " (Other)" : ""} · {displayEventDate(event.startsAt)}
                  </option>
                ))}
            </select>
            {editRsvpSettingsHref ? (
              <AppLink
                className="button button--secondary button--control-height rsvp-manager__edit-settings-button"
                href={editRsvpSettingsHref}
                onNavigate={
                  navigate ??
                  ((href) => {
                    window.location.assign(href);
                  })
                }
              >
                Edit RSVP settings →
              </AppLink>
            ) : null}
          </div>
        </div>
        <RsvpDeadlineNotice event={selectedEvent} />
      </div>
      <div aria-label="RSVP filters and views" className="rsvp-status-filters" role="group">
        {(
          [
            ["active", `All active (${String(counts.active)})`],
            ["Yes", `Attending (${String(counts.attending)})`],
            ["No", `Declined (${String(counts.declined)})`],
            ["Pending", `No response (${String(counts.pending)})`],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-pressed={view === "roster" && filter === value}
            className={view === "roster" && filter === value ? "is-active" : undefined}
            key={value}
            onClick={() => {
              setFilter(value);
              setView("roster");
            }}
            type="button"
          >
            {label}
          </button>
        ))}
        <button
          aria-pressed={view === "history"}
          className={view === "history" ? "is-active" : undefined}
          onClick={() => {
            setView("history");
          }}
          type="button"
        >
          History
        </button>
      </div>
      <div
        className={`roster-balance__assignment-layout${layout.valid ? "" : " roster-balance__assignment-layout--fallback"}`}
        style={balanceGridStyle}
      >
        <div className="roster-balance__sections">
          {layout.sections.map((sectionGroup) => {
            const section = sectionGroup.section;
            const selected =
              assignmentFilter?.kind === "section" && assignmentFilter.value === section.code;
            const sectionGridStyle:
              (CSSProperties & { "--roster-balance-section-span"?: number }) | undefined =
              layout.valid
                ? {
                    "--roster-balance-section-span": sectionGroup.span,
                  }
                : undefined;
            return (
              <button
                aria-pressed={selected}
                className={`roster-balance__section${selected ? " roster-balance__section--selected" : ""}`}
                key={section.code}
                onClick={() => {
                  toggleAssignmentFilter({ kind: "section", value: section.code });
                }}
                style={sectionGridStyle}
                type="button"
              >
                <span>{section.name}</span>
                <strong>{sectionCounts.get(section.code) ?? 0}</strong>
              </button>
            );
          })}
        </div>
        <div className="roster-balance__parts">
          {layout.orderedParts.map((voicePart) => {
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
      </div>
      {notificationFooter !== null && notificationFooter !== undefined ? (
        <div className="rsvp-manager__notification-footer">{notificationFooter}</div>
      ) : null}
    </fieldset>
  );
}
