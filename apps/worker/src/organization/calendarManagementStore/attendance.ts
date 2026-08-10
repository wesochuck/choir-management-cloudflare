import { organizationEventRsvpHistoryResponseSchema } from "@choir/contracts";
import { z } from "zod";

import { type AttendanceRow, type EventRsvpHistoryRow, type ManagementRequest } from "./contracts";
import { insertAudit, identityMatches, recordExists } from "./shared";
import { recalculateProfileStatuses, reconcilePresentAttendance } from "../statusAutomationStore";

export function listEventAttendanceFromStore(
  storage: DurableObjectStorage,
  input: { readonly eventId: string | null; readonly organizationId: string | null },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success) {
    return Response.json({ code: "attendance_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "events", eventId.data)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const rows = storage.sql
    .exec<AttendanceRow>(
      `SELECT p.id AS profileId, p.display_name AS displayName,
         COALESCE(p.voice_part, '') AS voicePart,
         CASE
           WHEN e.type = 'Rehearsal'
             AND COALESCE(r.rsvp, 'Pending') = 'Pending'
             AND parent.rsvp IN ('Yes', 'No')
           THEN parent.rsvp
           ELSE COALESCE(r.rsvp, 'Pending')
         END AS rsvp,
         COALESCE(r.attendance, 'Pending') AS attendance,
         r.updated_at AS updatedAt
       FROM profiles p
       JOIN events e ON e.id = ?
       LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
       LEFT JOIN event_rosters parent
         ON parent.profile_id = p.id AND parent.event_id = e.parent_performance_id
       ORDER BY p.display_name COLLATE NOCASE ASC, p.id ASC LIMIT 500`,
      eventId.data,
      eventId.data,
    )
    .toArray();
  return Response.json({ eventId: eventId.data, rows });
}

export function listEventRsvpHistoryFromStore(
  storage: DurableObjectStorage,
  input: { readonly eventId: string | null; readonly organizationId: string | null },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success) {
    return Response.json({ code: "event_rsvp_history_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "events", eventId.data)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const entries = storage.sql
    .exec<EventRsvpHistoryRow>(
      `SELECT h.event_id AS eventId, h.profile_id AS profileId,
         COALESCE(p.display_name, 'Removed Profile') AS displayName,
         h.previous_rsvp AS previousRsvp, h.new_rsvp AS newRsvp,
         h.reason, h.automatic, h.actor_type AS actorType, h.occurred_at AS occurredAt
       FROM event_rsvp_history h
       LEFT JOIN profiles p ON p.id = h.profile_id
       WHERE h.event_id = ?
       ORDER BY h.occurred_at DESC, h.id DESC LIMIT 500`,
      eventId.data,
    )
    .toArray()
    .map((entry) => ({ ...entry, automatic: entry.automatic === 1 }));
  return Response.json(
    organizationEventRsvpHistoryResponseSchema.parse({ entries, eventId: eventId.data }),
  );
}

export function updateAttendance(
  storage: DurableObjectStorage,
  operation: Extract<ManagementRequest, { readonly action: "bulk_attendance" }>,
  occurredAt: string,
): Response {
  if (!recordExists(storage, "events", operation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const profileIds = new Set(operation.attendance.updates.map(({ profileId }) => profileId));
  if (profileIds.size !== operation.attendance.updates.length) {
    return Response.json({ code: "duplicate_profile" }, { status: 400 });
  }
  if ([...profileIds].some((profileId) => !recordExists(storage, "profiles", profileId))) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  storage.transactionSync(() => {
    for (const update of operation.attendance.updates) {
      storage.sql.exec(
        `INSERT INTO event_rosters
          (event_id, profile_id, rsvp, attendance, created_at, updated_at)
         VALUES (?, ?, 'Pending', ?, ?, ?)
         ON CONFLICT(event_id, profile_id) DO UPDATE SET
           attendance = excluded.attendance,
           updated_at = excluded.updated_at`,
        operation.eventId,
        update.profileId,
        update.attendance,
        occurredAt,
        occurredAt,
      );
      if (update.attendance === "Present") {
        reconcilePresentAttendance(storage, {
          actor: {
            actorId: "",
            actorType: "system",
            requestId: operation.requestId,
          },
          eventId: operation.eventId,
          occurredAt,
          profileId: update.profileId,
        });
      }
    }
    insertAudit(
      storage,
      operation,
      "event.attendance.updated",
      "event",
      operation.eventId,
      {
        profileCount: operation.attendance.updates.length,
      },
      occurredAt,
    );
  });
  recalculateProfileStatuses(
    storage,
    operation.organizationId,
    new Date(occurredAt),
    operation.requestId,
  );
  return listEventAttendanceFromStore(storage, {
    eventId: operation.eventId,
    organizationId: operation.organizationId,
  });
}
