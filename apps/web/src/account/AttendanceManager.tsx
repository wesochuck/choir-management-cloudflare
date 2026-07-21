import type {
  OrganizationAttendanceRow,
  OrganizationAttendanceStatus,
  OrganizationEvent,
} from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  listOrganizationEventAttendance,
  listOrganizationEvents,
  updateOrganizationEventAttendance,
} from "../auth/api";

function attendanceValue(value: string): OrganizationAttendanceStatus {
  if (value === "Present" || value === "Absent") return value;
  return "Pending";
}

export function AttendanceManager({ enabled }: { readonly enabled: boolean }) {
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [rows, setRows] = useState<readonly OrganizationAttendanceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationEvents(controller.signal)
      .then((loaded) => {
        setEvents(loaded);
        setEventId((current) => (current.length > 0 ? current : (loaded[0]?.id ?? "")));
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Attendance events could not be loaded.");
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !eventId) {
      return;
    }
    const controller = new AbortController();
    listOrganizationEventAttendance(eventId, controller.signal)
      .then(setRows)
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Attendance could not be loaded.");
      });
    return () => {
      controller.abort();
    };
  }, [enabled, eventId]);

  function changeAttendance(profileId: string, attendance: OrganizationAttendanceStatus) {
    setRows((current) =>
      current.map((row) => (row.profileId === profileId ? { ...row, attendance } : row)),
    );
    setMessage(null);
  }

  async function saveAttendance() {
    if (!eventId || rows.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      setRows(
        await updateOrganizationEventAttendance(
          eventId,
          rows.map(({ attendance, profileId }) => ({ attendance, profileId })),
        ),
      );
      setMessage("Attendance saved.");
    } catch {
      setMessage("Attendance could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;
  return (
    <section className="account-section" aria-labelledby="attendance-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Administrator tools</p>
        <h2 id="attendance-title">Attendance</h2>
      </div>
      <p className="section-description">
        Mark each Profile Present, Absent, or Pending. Present promotes a Pending RSVP to Yes.
      </p>
      <label>
        Event
        <select
          value={eventId}
          onChange={(event) => {
            setEventId(event.target.value);
          }}
        >
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title}
            </option>
          ))}
        </select>
      </label>
      {rows.length === 0 ? <p>No Profiles are available for this event.</p> : null}
      <div className="attendance-list">
        {rows.map((row) => (
          <label className="attendance-row" key={row.profileId}>
            <span>
              {row.displayName} <small>RSVP: {row.rsvp}</small>
            </span>
            <select
              aria-label={`${row.displayName} attendance`}
              disabled={busy}
              onChange={(event) => {
                changeAttendance(row.profileId, attendanceValue(event.target.value));
              }}
              value={row.attendance}
            >
              <option value="Pending">Pending</option>
              <option value="Present">Present</option>
              <option value="Absent">Absent</option>
            </select>
          </label>
        ))}
      </div>
      <div className="form-actions">
        <button
          className="button button--primary"
          disabled={busy || rows.length === 0}
          onClick={() => {
            void saveAttendance();
          }}
          type="button"
        >
          {busy ? "Saving…" : "Save attendance"}
        </button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
