import type {
  OrganizationAttendanceRow,
  OrganizationAttendanceStatus,
  OrganizationEvent,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  listOrganizationEventAttendance,
  listOrganizationEvents,
  updateOrganizationEventAttendance,
} from "../auth/api";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

type AttendanceFilter = "All" | "Present" | "Absent" | "Pending";

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

export function AttendanceManager({ enabled }: { readonly enabled: boolean }) {
  const { performerLabel, performerLabelPlural } = useOrganizationTerminology();
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [rows, setRows] = useState<readonly OrganizationAttendanceRow[]>([]);
  const [filter, setFilter] = useState<AttendanceFilter>("Pending");
  const [query, setQuery] = useState("");
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pendingIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationEvents(controller.signal)
      .then((loaded) => {
        setEvents(loaded);
        setEventId((current) => {
          if (current) return current;
          return closestFutureEvent(loaded)?.id ?? loaded[0]?.id ?? "";
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Attendance events could not be loaded.");
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const refreshRows = useCallback(
    async (signal: AbortSignal, initial = false) => {
      if (!eventId) return;
      try {
        const loaded = await listOrganizationEventAttendance(eventId, signal);
        if (signal.aborted) return;
        setRows((current) => {
          if (initial) return loaded;
          const currentById = new Map(current.map((row) => [row.profileId, row]));
          return loaded.map((row) =>
            pendingIdsRef.current.has(row.profileId)
              ? (currentById.get(row.profileId) ?? row)
              : row,
          );
        });
        setLastUpdated(new Date());
        if (initial) setMessage(null);
      } catch {
        if (!signal.aborted && initial) setMessage("Attendance could not be loaded.");
      }
    },
    [eventId],
  );

  useEffect(() => {
    if (!enabled || !eventId) return;
    pendingIdsRef.current.clear();
    const controller = new AbortController();
    void refreshRows(controller.signal, true);
    const interval = window.setInterval(() => {
      void refreshRows(controller.signal);
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [enabled, eventId, refreshRows]);

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
    pendingIdsRef.current.add(row.profileId);
    markSaving(row.profileId, true);
    setMessage(null);
    try {
      const saved = await updateOrganizationEventAttendance(eventId, [
        {
          attendance: updates.attendance ?? row.attendance,
          profileId: row.profileId,
        },
      ]);
      const savedRow = saved.find((candidate) => candidate.profileId === row.profileId);
      if (savedRow) {
        setRows((current) =>
          current.map((candidate) =>
            candidate.profileId === row.profileId ? savedRow : candidate,
          ),
        );
      }
      setLastUpdated(new Date());
    } catch {
      setMessage("That attendance update could not be saved. Try again.");
      throw new Error("attendance_update_failed");
    } finally {
      pendingIdsRef.current.delete(row.profileId);
      markSaving(row.profileId, false);
    }
  }

  async function changeAttendance(profileId: string) {
    const row = rows.find((candidate) => candidate.profileId === profileId);
    if (!row || savingIds.has(profileId) || bulkBusy) return;
    const next = nextAttendance[row.attendance];
    setRows((current) =>
      current.map((candidate) =>
        candidate.profileId === profileId ? { ...candidate, attendance: next } : candidate,
      ),
    );
    try {
      await saveRow(row, { attendance: next });
    } catch {
      setRows((current) =>
        current.map((candidate) =>
          candidate.profileId === profileId
            ? { ...candidate, attendance: row.attendance }
            : candidate,
        ),
      );
    }
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
    targetRows.forEach((row) => pendingIdsRef.current.add(row.profileId));
    const targetProfileIds = new Set(targetRows.map((row) => row.profileId));
    setRows((current) =>
      current.map((row) =>
        targetProfileIds.has(row.profileId) ? { ...row, attendance: "Present" } : row,
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
      setRows((current) => current.map((row) => savedById.get(row.profileId) ?? row));
      setLastUpdated(new Date());
    } catch {
      setMessage("The remaining attendance could not be saved. Try again.");
      void refreshRows(new AbortController().signal, true);
    } finally {
      targetRows.forEach((row) => pendingIdsRef.current.delete(row.profileId));
      setBulkBusy(false);
    }
  }

  const selectedEvent = events.find((event) => event.id === eventId);
  const counts = useMemo(() => {
    const expected = rows.filter((row) => row.rsvp === "Yes");
    return {
      absent: expected.filter((row) => row.attendance === "Absent").length,
      expected: expected.length,
      pending: expected.filter((row) => row.attendance === "Pending").length,
      present: expected.filter((row) => row.attendance === "Present").length,
    };
  }, [rows]);

  const groupedRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const searchableRows = normalizedQuery ? rows : rows.filter((row) => row.rsvp === "Yes");
    const filtered = searchableRows.filter((row) => {
      const matchesFilter =
        filter === "All" ||
        (filter === "Pending" && row.attendance === "Pending") ||
        (filter === "Present" && row.attendance === "Present") ||
        (filter === "Absent" && row.attendance === "Absent");
      const matchesQuery =
        !normalizedQuery ||
        row.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
        row.voicePart.toLocaleLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
    const groups = new Map<string, OrganizationAttendanceRow[]>();
    filtered
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .forEach((row) => {
        const label = row.voicePart || "Other";
        const group = groups.get(label) ?? [];
        group.push(row);
        groups.set(label, group);
      });
    return [...groups.entries()];
  }, [filter, query, rows]);

  if (!enabled) return null;
  return (
    <section className="account-section attendance-manager" aria-label="Attendance management">
      <div className="attendance-manager__intro">
        <div>
          <p className="section-description">
            Tap a name to cycle Pending, Present, and Absent. Changes save immediately.
          </p>
          <p className="attendance-manager__sync" role="status">
            <span aria-hidden="true">●</span> Live updates every 30 seconds ·{" "}
            {formatSyncTime(lastUpdated)}
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
              pendingIdsRef.current.clear();
              setRows([]);
              setEventId(event.target.value);
            }}
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} · {displayEventDate(event.startsAt)}
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
            placeholder={`Search name or ${performerLabel.toLowerCase()}`}
            type="search"
            value={query}
          />
        </label>
      </div>

      {selectedEvent ? (
        <div className="attendance-manager__event-summary">
          <strong>{selectedEvent.title}</strong>
          <span>{displayEventDate(selectedEvent.startsAt)}</span>
          <span>{selectedEvent.location || "No location"}</span>
        </div>
      ) : null}

      <div className="attendance-manager__toolbar">
        <div className="attendance-filters" aria-label="Attendance filter" role="group">
          {(
            [
              ["Pending", `Unmarked ${String(counts.pending)}`],
              ["All", `All ${String(counts.expected)}`],
              ["Present", `Present ${String(counts.present)}`],
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
      {rows.length > 0 && groupedRows.length === 0 ? (
        <p className="attendance-manager__empty">
          No {performerLabelPlural.toLowerCase()} match this filter.
        </p>
      ) : null}
      <div className="attendance-list">
        {groupedRows.map(([voicePart, group]) => (
          <div className="attendance-group" key={voicePart}>
            <h3>{voicePart}</h3>
            {group.map((row) => {
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
                      void changeAttendance(row.profileId);
                    }}
                    type="button"
                  >
                    <span className="attendance-row__indicator" aria-hidden="true">
                      {row.attendance === "Present" ? "✓" : row.attendance === "Absent" ? "×" : ""}
                    </span>
                    <span className="attendance-row__identity">
                      <strong>{row.displayName}</strong>
                      <span>
                        {row.voicePart || `${performerLabel} not set`} ·{" "}
                        {attendanceLabel(row.attendance)}
                      </span>
                    </span>
                    {row.rsvp === "No" ? (
                      <span className="attendance-row__rsvp">Declined</span>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
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
                void markRemainingPresent();
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
