import type {
  OrganizationAttendanceRow,
  OrganizationAttendanceStatus,
  OrganizationEvent,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useMemo, useState } from "react";

import {
  type AttendanceFilter,
  type AttendanceGroup,
  useAttendanceFiltering,
  useAttendanceMutations,
  useAttendanceQueries,
} from "./components/AttendanceManager/hooks";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

function attendanceLabel(status: OrganizationAttendanceStatus): string {
  if (status === "Present") return "Present";
  if (status === "Absent") return "Absent";
  return "Tap to check in";
}

function displayEventDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatSyncTime(value: Date | null): string {
  if (!value) return "Waiting for updates";
  return `Updated ${value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

interface AttendanceGroupProps {
  readonly bulkBusy: boolean;
  readonly group: AttendanceGroup;
  readonly onChange: (profileId: string) => void;
  readonly partLabel: string;
  readonly savingIds: ReadonlySet<string>;
}

function AttendanceGroupComponent({
  bulkBusy,
  group,
  onChange,
  partLabel,
  savingIds,
}: AttendanceGroupProps) {
  const [voicePart, rows] = group;
  return (
    <div className="attendance-group" key={voicePart}>
      <h3>{voicePart}</h3>
      {rows.map((row) => {
        const isSaving = savingIds.has(row.profileId) || bulkBusy;
        return (
          <div
            className={`attendance-row attendance-row--${row.attendance.toLowerCase()}`}
            key={row.profileId}
          >
            <button
              aria-label={`${row.displayName}: ${attendanceLabel(row.attendance)}. Tap to change.`}
              className="attendance-row__toggle"
              disabled={isSaving}
              onClick={() => {
                onChange(row.profileId);
              }}
              type="button"
            >
              <span className="attendance-row__indicator" aria-hidden="true">
                {row.attendance === "Present" ? "✓" : row.attendance === "Absent" ? "×" : ""}
              </span>
              <span className="attendance-row__identity">
                <strong>{row.displayName}</strong>
                <span>
                  {row.voicePart || `${partLabel} not set`} · {attendanceLabel(row.attendance)}
                </span>
              </span>
              {row.rsvp !== "Yes" ? (
                <span
                  className={`attendance-row__rsvp attendance-row__rsvp--${row.rsvp.toLowerCase()}`}
                >
                  {row.rsvp === "No" ? "Declined" : "Not currently RSVP'd"}
                </span>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface UnexpectedAttendanceDialogProps {
  readonly busy: boolean;
  readonly candidate: OrganizationAttendanceRow | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

function UnexpectedAttendanceDialog({
  busy,
  candidate,
  onClose,
  onConfirm,
}: UnexpectedAttendanceDialogProps) {
  return (
    <Dialog
      description="Confirm the attendance and RSVP update before continuing."
      onClose={onClose}
      open={candidate !== null}
      title="Mark unexpected attendee present?"
    >
      <div className="form-stack">
        <p className="notice notice--warning" role="alert">
          {candidate?.displayName ?? "This attendee"} is not currently RSVP&apos;d. Marking them
          Present will RSVP them Yes for this event and, for a linked Rehearsal, its linked
          Performance.
        </p>
        <div className="dialog__actions">
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Saving…" : "Mark present and RSVP"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function AttendanceManager({ enabled }: { readonly enabled: boolean }) {
  const { partLabel, performerLabel, performerLabelPlural } = useOrganizationTerminology();
  const [filter, setFilter] = useState<AttendanceFilter>("Pending");
  const [query, setQuery] = useState("");

  const { dataUpdatedAt, eventId, events, rows, setSelectedEventId, venues } =
    useAttendanceQueries(enabled);

  const {
    bulkBusy,
    bulkConfirmOpen,
    changeAttendance,
    confirmUnexpectedAttendance,
    markRemainingPresent,
    message,
    rescueBusy,
    rescueCandidate,
    savingIds,
    setBulkConfirmOpen,
    setRescueCandidate,
  } = useAttendanceMutations({ eventId, rows });

  const { counts, groupedRows, markableRows } = useAttendanceFiltering({
    filter,
    query,
    rows,
    savingIds,
  });

  const venueNameById = useMemo(
    () => new Map(venues.map((venue) => [venue.id, venue.name])),
    [venues],
  );
  function eventLocationLabel(event: OrganizationEvent): string {
    return venueNameById.get(event.venueId ?? "") ?? event.location.trim();
  }

  if (!enabled) return null;
  return (
    <section className="account-section attendance-manager" aria-label="Attendance management">
      <div className="attendance-manager__intro">
        <div>
          <p className="attendance-manager__sync" role="status">
            <span aria-hidden="true">●</span> Live updates every 30 seconds ·{" "}
            {formatSyncTime(dataUpdatedAt ? new Date(dataUpdatedAt) : null)}
          </p>
        </div>
        <div className="attendance-manager__count" aria-label="Attendance progress">
          <strong>{String(counts.present)}</strong> / {String(counts.expected)}
          <span>present</span>
        </div>
      </div>

      <div className="attendance-manager__controls">
        <label className="field">
          <span>Event</span>
          <select
            value={eventId}
            onChange={(event) => {
              setSelectedEventId(event.target.value);
            }}
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} · {displayEventDate(event.startsAt)}
                {eventLocationLabel(event) ? ` · ${eventLocationLabel(event)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field attendance-manager__search">
          <span>Find a {performerLabel.toLowerCase()}</span>
          <input
            inputMode="search"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder={`Search name or ${partLabel.toLowerCase()}`}
            type="search"
            value={query}
          />
        </label>
      </div>

      <div className="attendance-manager__toolbar">
        <div className="attendance-filters" aria-label="Attendance filter" role="group">
          {(
            [
              ["Pending", `Unmarked ${String(counts.pending)}`],
              ["All", `All ${String(counts.roster)}`],
              ["Present", `Present ${String(counts.presentTotal)}`],
              ["Absent", `Absent ${String(counts.absent)}`],
            ] as const
          ).map(([value, label]) => (
            <button
              className={
                filter === value
                  ? "attendance-filter attendance-filter--active"
                  : "attendance-filter"
              }
              key={value}
              onClick={() => {
                setFilter(value);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="button button--primary attendance-manager__bulk"
          disabled={bulkBusy || markableRows.length === 0}
          onClick={() => {
            setBulkConfirmOpen(true);
          }}
          type="button"
        >
          {bulkBusy ? "Saving…" : "Mark remaining present"}
        </button>
      </div>

      <div
        className="attendance-progress"
        aria-label={`${String(counts.present)} of ${String(counts.expected)} present`}
      >
        <span
          style={{
            width: `${String(counts.expected ? (counts.present / counts.expected) * 100 : 0)}%`,
          }}
        />
      </div>

      {message ? (
        <p className="attendance-manager__message" role="alert">
          {message}
        </p>
      ) : null}

      {rows.length === 0 ? <p>No Profiles are available for this event.</p> : null}
      {rows.length > 0 && groupedRows.rsvped.length + groupedRows.notRsvped.length === 0 ? (
        <p className="attendance-manager__empty">
          No {performerLabelPlural.toLowerCase()} match this filter.
        </p>
      ) : null}
      <div className="attendance-list">
        {groupedRows.rsvped.map((group) => (
          <AttendanceGroupComponent
            bulkBusy={bulkBusy}
            group={group}
            key={group[0]}
            onChange={changeAttendance}
            partLabel={partLabel}
            savingIds={savingIds}
          />
        ))}
        {groupedRows.notRsvped.length > 0 ? (
          <div
            aria-label="Not currently RSVP'd"
            className="attendance-list__divider"
            role="separator"
          >
            <span>Not currently RSVP&apos;d</span>
          </div>
        ) : null}
        {groupedRows.notRsvped.map((group) => (
          <AttendanceGroupComponent
            bulkBusy={bulkBusy}
            group={group}
            key={`not-rsvped-${group[0]}`}
            onChange={changeAttendance}
            partLabel={partLabel}
            savingIds={savingIds}
          />
        ))}
      </div>
      <UnexpectedAttendanceDialog
        busy={rescueBusy}
        candidate={rescueCandidate}
        onClose={() => {
          if (!rescueBusy) setRescueCandidate(null);
        }}
        onConfirm={() => {
          void confirmUnexpectedAttendance();
        }}
      />
      <Dialog
        description="This action may be difficult to undo."
        onClose={() => {
          if (!bulkBusy) setBulkConfirmOpen(false);
        }}
        open={bulkConfirmOpen}
        title="Mark remaining present?"
      >
        <div className="form-stack">
          <p className="notice notice--warning" role="alert">
            This will mark {String(markableRows.length)}{" "}
            {markableRows.length === 1
              ? performerLabel.toLowerCase()
              : performerLabelPlural.toLowerCase()}{" "}
            who RSVP&apos;d Yes and are not currently Present as Present.
          </p>
          <div className="dialog__actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setBulkConfirmOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--danger"
              onClick={() => {
                setBulkConfirmOpen(false);
                void markRemainingPresent(markableRows);
              }}
              type="button"
            >
              Mark remaining present
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
