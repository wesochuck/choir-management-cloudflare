import type {
  OrganizationAttendanceRow,
  OrganizationAttendanceStatus,
  OrganizationEvent,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationVenues,
  queryKeys,
  updateOrganizationEventAttendance,
} from "../api";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

type AttendanceFilter = "All" | "Present" | "Absent" | "Pending";
type AttendanceGroup = readonly [string, readonly OrganizationAttendanceRow[]];

const nextAttendance: Record<OrganizationAttendanceStatus, OrganizationAttendanceStatus> = {
  Absent: "Pending",
  Pending: "Present",
  Present: "Absent",
};

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

function closestFutureEvent(
  events: readonly OrganizationEvent[],
  now = Date.now(),
): OrganizationEvent | undefined {
  let closest: OrganizationEvent | undefined;
  let closestStartsAt = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const startsAt = Date.parse(event.startsAt);
    if (!Number.isFinite(startsAt) || startsAt <= now || startsAt >= closestStartsAt) continue;
    closest = event;
    closestStartsAt = startsAt;
  }
  return closest;
}

function formatSyncTime(value: Date | null): string {
  if (!value) return "Waiting for updates";
  return `Updated ${value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function groupRowsByVoicePart(
  rows: readonly OrganizationAttendanceRow[],
): readonly AttendanceGroup[] {
  const groups = new Map<string, OrganizationAttendanceRow[]>();
  [...rows]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .forEach((row) => {
      const label = row.voicePart || "Other";
      const group = groups.get(label) ?? [];
      group.push(row);
      groups.set(label, group);
    });
  return [...groups.entries()];
}

interface AttendanceGroupProps {
  readonly bulkBusy: boolean;
  readonly group: AttendanceGroup;
  readonly onChange: (profileId: string) => void;
  readonly partLabel: string;
  readonly savingIds: ReadonlySet<string>;
}

function AttendanceGroup({
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
  const queryClient = useQueryClient();

  const { data: events = [] } = useQuery({
    enabled,
    queryFn: ({ signal }) => listOrganizationEvents(signal),
    queryKey: queryKeys.organization.events,
  });

  const { data: venues = [] } = useQuery({
    enabled,
    queryFn: ({ signal }) => listOrganizationVenues(signal),
    queryKey: queryKeys.organization.venues,
  });

  const defaultEventId = useMemo(
    () => closestFutureEvent(events)?.id ?? events[0]?.id ?? "",
    [events],
  );
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const eventId = selectedEventId || defaultEventId;

  const { data: rows = [], dataUpdatedAt } = useQuery({
    enabled: enabled && Boolean(eventId),
    queryFn: ({ signal }) => listOrganizationEventAttendance(eventId, signal),
    queryKey: queryKeys.organization.attendance(eventId),
    refetchInterval: 30_000,
  });

  const [filter, setFilter] = useState<AttendanceFilter>("Pending");
  const [query, setQuery] = useState("");
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [rescueCandidate, setRescueCandidate] = useState<OrganizationAttendanceRow | null>(null);
  const [rescueBusy, setRescueBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function markSaving(profileId: string, saving: boolean) {
    setSavingIds((current) => {
      const next = new Set(current);
      if (saving) next.add(profileId);
      else next.delete(profileId);
      return next;
    });
  }

  async function saveRow(
    row: OrganizationAttendanceRow,
    updates: Partial<OrganizationAttendanceRow>,
  ) {
    markSaving(row.profileId, true);
    setMessage(null);
    const nextValue = updates.attendance ?? row.attendance;
    const previous = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(eventId),
    );
    queryClient.setQueryData(
      queryKeys.organization.attendance(eventId),
      (current: readonly OrganizationAttendanceRow[] | undefined) =>
        (current ?? []).map((candidate) =>
          candidate.profileId === row.profileId
            ? { ...candidate, attendance: nextValue }
            : candidate,
        ),
    );
    try {
      const saved = await updateOrganizationEventAttendance(eventId, [
        {
          attendance: nextValue,
          profileId: row.profileId,
        },
      ]);
      const savedRow = saved.find((candidate) => candidate.profileId === row.profileId);
      if (savedRow) {
        queryClient.setQueryData(
          queryKeys.organization.attendance(eventId),
          (current: readonly OrganizationAttendanceRow[] | undefined) =>
            (current ?? []).map((candidate) =>
              candidate.profileId === row.profileId ? savedRow : candidate,
            ),
        );
      }
    } catch {
      queryClient.setQueryData(queryKeys.organization.attendance(eventId), previous);
      setMessage("That attendance update could not be saved. Try again.");
      throw new Error("attendance_update_failed");
    } finally {
      markSaving(row.profileId, false);
    }
  }

  async function applyAttendanceChange(
    row: OrganizationAttendanceRow,
    next: OrganizationAttendanceStatus,
  ): Promise<boolean> {
    try {
      await saveRow(row, { attendance: next });
      return true;
    } catch {
      return false;
    }
  }

  function changeAttendance(profileId: string) {
    const row = rows.find((candidate) => candidate.profileId === profileId);
    if (!row || savingIds.has(profileId) || bulkBusy || rescueBusy) return;
    const next = nextAttendance[row.attendance];
    if (next === "Present" && row.rsvp !== "Yes") {
      setRescueCandidate(row);
      return;
    }
    void applyAttendanceChange(row, next);
  }

  async function confirmUnexpectedAttendance() {
    const candidate = rescueCandidate;
    if (!candidate || rescueBusy) return;
    const row = rows.find((current) => current.profileId === candidate.profileId);
    if (!row) {
      setRescueCandidate(null);
      return;
    }
    if (row.rsvp === "Yes") {
      setRescueCandidate(null);
      void applyAttendanceChange(row, "Present");
      return;
    }
    setRescueBusy(true);
    const saved = await applyAttendanceChange(row, "Present");
    setRescueBusy(false);
    if (saved) setRescueCandidate(null);
  }

  const markableRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.rsvp === "Yes" && row.attendance !== "Present" && !savingIds.has(row.profileId),
      ),
    [rows, savingIds],
  );

  async function markRemainingPresent() {
    const targetRows = markableRows;
    if (!eventId || targetRows.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setMessage(null);
    const previous = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(eventId),
    );
    const targetProfileIds = new Set(targetRows.map((row) => row.profileId));
    queryClient.setQueryData(
      queryKeys.organization.attendance(eventId),
      (current: readonly OrganizationAttendanceRow[] | undefined) =>
        (current ?? []).map((row) =>
          targetProfileIds.has(row.profileId) ? { ...row, attendance: "Present" as const } : row,
        ),
    );
    try {
      const saved = await updateOrganizationEventAttendance(
        eventId,
        targetRows.map((row) => ({
          attendance: "Present" as const,
          profileId: row.profileId,
        })),
      );
      const savedById = new Map(saved.map((row) => [row.profileId, row]));
      queryClient.setQueryData(
        queryKeys.organization.attendance(eventId),
        (current: readonly OrganizationAttendanceRow[] | undefined) =>
          (current ?? []).map((row) => savedById.get(row.profileId) ?? row),
      );
    } catch {
      queryClient.setQueryData(queryKeys.organization.attendance(eventId), previous);
      setMessage("The remaining attendance could not be saved. Try again.");
    } finally {
      setBulkBusy(false);
    }
  }

  const venueNameById = useMemo(
    () => new Map(venues.map((venue) => [venue.id, venue.name])),
    [venues],
  );
  function eventLocationLabel(event: OrganizationEvent): string {
    return venueNameById.get(event.venueId ?? "") ?? event.location.trim();
  }

  const counts = useMemo(() => {
    const expected = rows.filter((row) => row.rsvp === "Yes");
    return {
      absent: expected.filter((row) => row.attendance === "Absent").length,
      expected: expected.length,
      pending: expected.filter((row) => row.attendance === "Pending").length,
      present: expected.filter((row) => row.attendance === "Present").length,
      presentTotal: expected.filter((row) => row.attendance === "Present").length,
      roster: expected.length,
    };
  }, [rows]);

  const groupedRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = rows.filter((row) => {
      const matchesFilter =
        filter === "All" ||
        (filter === "Pending" && row.attendance === "Pending") ||
        (filter === "Present" && row.attendance === "Present") ||
        (filter === "Absent" && row.attendance === "Absent");
      const matchesQuery =
        !normalizedQuery ||
        row.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
        row.voicePart.toLocaleLowerCase().includes(normalizedQuery);
      const isSearchResult = normalizedQuery.length > 0;
      return matchesFilter && matchesQuery && (isSearchResult || row.rsvp === "Yes");
    });
    return {
      notRsvped: groupRowsByVoicePart(filtered.filter((row) => row.rsvp !== "Yes")),
      rsvped: groupRowsByVoicePart(filtered.filter((row) => row.rsvp === "Yes")),
    };
  }, [filter, query, rows]);

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
          <strong>{counts.present}</strong> / {counts.expected}
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
        <div className="attendance-manager__filter-group">
          {(["Pending", "Present", "Absent", "All"] as const).map((candidate) => (
            <button
              className={`attendance-manager__filter-tab ${
                filter === candidate ? "attendance-manager__filter-tab--active" : ""
              }`}
              key={candidate}
              onClick={() => {
                setFilter(candidate);
              }}
              type="button"
            >
              {candidate === "Pending"
                ? `Pending (${String(counts.pending)})`
                : candidate === "Present"
                  ? `Present (${String(counts.present)})`
                  : candidate === "Absent"
                    ? `Absent (${String(counts.absent)})`
                    : `All (${String(rows.length)})`}
            </button>
          ))}
        </div>
        <div className="attendance-manager__bulk-actions">
          <button
            className="button button--secondary"
            disabled={bulkBusy || markableRows.length === 0}
            onClick={() => {
              setBulkConfirmOpen(true);
            }}
            type="button"
          >
            Mark all pending ({markableRows.length}) present
          </button>
        </div>
      </div>

      {message ? (
        <p className="notice notice--warning" role="alert">
          {message}
        </p>
      ) : null}

      <div className="attendance-groups">
        {groupedRows.rsvped.map((group) => (
          <AttendanceGroup
            bulkBusy={bulkBusy}
            group={group}
            key={group[0]}
            onChange={changeAttendance}
            partLabel={partLabel}
            savingIds={savingIds}
          />
        ))}

        {groupedRows.notRsvped.length > 0 ? (
          <div className="attendance-groups__unrsvped">
            <h2>Not currently RSVP&apos;d {performerLabelPlural.toLowerCase()}</h2>
            <p className="field-hint">
              Tap any {performerLabel.toLowerCase()} to mark them Present and update their RSVP.
            </p>
            {groupedRows.notRsvped.map((group) => (
              <AttendanceGroup
                bulkBusy={bulkBusy}
                group={group}
                key={group[0]}
                onChange={changeAttendance}
                partLabel={partLabel}
                savingIds={savingIds}
              />
            ))}
          </div>
        ) : null}

        {groupedRows.rsvped.length === 0 && groupedRows.notRsvped.length === 0 ? (
          <p className="empty-state">
            {rows.length === 0
              ? `No ${performerLabelPlural.toLowerCase()} found for this event.`
              : "No matches for the selected filter and query."}
          </p>
        ) : null}
      </div>

      <Dialog
        description="This will set all expected performers who have not checked in to Present."
        onClose={() => {
          setBulkConfirmOpen(false);
        }}
        open={bulkConfirmOpen}
        title="Mark all remaining present?"
      >
        <div className="form-stack">
          <p>
            Are you sure you want to mark all {markableRows.length} remaining RSVP&apos;d{" "}
            {performerLabelPlural.toLowerCase()} as Present?
          </p>
          <div className="dialog__actions">
            <button
              className="button button--secondary"
              disabled={bulkBusy}
              onClick={() => {
                setBulkConfirmOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              disabled={bulkBusy}
              onClick={() => {
                setBulkConfirmOpen(false);
                void markRemainingPresent();
              }}
              type="button"
            >
              Confirm and check in
            </button>
          </div>
        </div>
      </Dialog>

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
    </section>
  );
}
