import { organizationEventRsvpHistoryResponseSchema } from "@choir/contracts";
import { hasAttendanceWarning } from "@choir/domain";
import { z } from "zod";

import { type AttendanceRow, type EventRsvpHistoryRow, type ManagementRequest } from "./contracts";
import { insertAudit, identityMatches, recordExists } from "./shared";
import {
  recalculateProfileStatuses,
  reconcilePresentAttendance,
  readRosterAutomationConfiguration,
} from "../statusAutomationStore";

// Archive uses Inactive + off-roster; either flag alone has a separate meaning (ADR 0065).
// Reuse this predicate for routine reads and write preflight, without changing history reports.
const attendanceProfileEligibilitySql = "(p.hidden = 0 OR p.global_status != 'Inactive')";

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
    .exec<AttendanceRow & { readonly missedRehearsals: number; readonly totalRehearsals: number }>(
      `WITH linked_attendance AS (
         SELECT attendance.profile_id AS profile_id,
           COUNT(*) AS total,
           SUM(CASE WHEN attendance.attendance = 'Absent'
             OR (attendance.attendance = 'Pending' AND attendance.rsvp = 'No')
             THEN 1 ELSE 0 END) AS missed
         FROM events rehearsal
         JOIN event_rosters attendance ON attendance.event_id = rehearsal.id
         WHERE rehearsal.parent_performance_id = ? AND rehearsal.type = 'Rehearsal'
           AND rehearsal.is_archived = 0 AND rehearsal.is_canceled = 0
         GROUP BY attendance.profile_id
       )
       SELECT p.id AS profileId, p.display_name AS displayName,
         COALESCE(p.voice_part, '') AS voicePart,
         CASE
           WHEN e.type = 'Rehearsal'
             AND COALESCE(r.rsvp, 'Pending') = 'Pending'
             AND parent.rsvp IN ('Yes', 'No')
           THEN parent.rsvp
           ELSE COALESCE(r.rsvp, 'Pending')
         END AS rsvp,
         COALESCE(r.attendance, 'Pending') AS attendance,
         r.updated_at AS updatedAt,
         COALESCE(linked.missed, 0) AS missedRehearsals,
         COALESCE(linked.total, 0) AS totalRehearsals
       FROM profiles p
       JOIN events e ON e.id = ?
       LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
       LEFT JOIN event_rosters parent
         ON parent.profile_id = p.id AND parent.event_id = e.parent_performance_id
       LEFT JOIN linked_attendance linked ON linked.profile_id = p.id
       WHERE ${attendanceProfileEligibilitySql}
       ORDER BY p.display_name COLLATE NOCASE ASC, p.id ASC LIMIT 500`,
      eventId.data,
      eventId.data,
      eventId.data,
    )
    .toArray();
  const threshold = readRosterAutomationConfiguration(storage).attendanceReportWarningThreshold;
  return Response.json({
    eventId: eventId.data,
    rows: rows.map(({ missedRehearsals, totalRehearsals, ...row }) => ({
      ...row,
      attendanceWarning:
        totalRehearsals > 0
          ? {
              missedRehearsals,
              totalRehearsals,
              threshold,
              status: hasAttendanceWarning(missedRehearsals, threshold) ? "warning" : "clear",
            }
          : null,
    })),
  });
}

export function readEventAttendanceReportFromStore(
  storage: DurableObjectStorage,
  input: { readonly eventId: string | null; readonly organizationId: string | null },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success) {
    return Response.json({ code: "attendance_report_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "events", eventId.data)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }

  const totalRehearsals = storage.sql
    .exec<{ readonly total: number }>(
      `SELECT COUNT(*) AS total FROM events
       WHERE parent_performance_id = ? AND type = 'Rehearsal'
         AND is_canceled = 0 AND is_archived = 0`,
      eventId.data,
    )
    .one().total;

  if (totalRehearsals === 0) {
    return Response.json({
      eventId: eventId.data,
      rows: [],
      totalRehearsals: 0,
    });
  }

  const rawRows = storage.sql
    .exec<{
      readonly absences: number;
      readonly name: string;
      readonly present: number;
      readonly profileId: string;
      readonly voicePart: string;
    }>(
      `SELECT
         p.id AS profileId,
         p.display_name AS name,
         COALESCE(p.voice_part, '') AS voicePart,
         CAST(COUNT(CASE WHEN r.attendance = 'Absent' THEN 1 END) AS INTEGER) AS absences,
         CAST(COUNT(CASE WHEN r.attendance = 'Present' THEN 1 END) AS INTEGER) AS present
       FROM (
         SELECT profile.id, profile.display_name, profile.voice_part
         FROM event_rosters commitment
         JOIN profiles profile ON profile.id = commitment.profile_id
         WHERE commitment.event_id = ? AND commitment.rsvp = 'Yes'
         ORDER BY profile.display_name COLLATE NOCASE ASC, profile.id ASC
         LIMIT 500
       ) p
       LEFT JOIN event_rosters r
         ON r.profile_id = p.id
         AND r.event_id IN (
           SELECT id FROM events
           WHERE parent_performance_id = ? AND type = 'Rehearsal'
             AND is_canceled = 0 AND is_archived = 0
         )
       GROUP BY p.id
       LIMIT 500`,
      eventId.data,
      eventId.data,
    )
    .toArray();

  const rows = rawRows
    .map((row) => ({
      absences: row.absences,
      name: row.name,
      present: row.present,
      profileId: row.profileId,
      total: totalRehearsals,
      voicePart: row.voicePart,
    }))
    .sort((a, b) => b.absences - a.absences || a.name.localeCompare(b.name));

  return Response.json({
    eventId: eventId.data,
    rows,
    totalRehearsals,
  });
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
  // Fetch only the bounded request's IDs through the profiles primary key. Validate the
  // whole batch before attendance, linked RSVPs, status automation, or audit writes.
  const profiles = storage.sql
    .exec<{ readonly id: string; readonly eligible: number }>(
      `SELECT p.id, CASE WHEN ${attendanceProfileEligibilitySql} THEN 1 ELSE 0 END AS eligible
     FROM profiles p WHERE p.id IN (SELECT value FROM json_each(?))`,
      JSON.stringify([...profileIds]),
    )
    .toArray();
  if (profiles.length !== profileIds.size) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  if (profiles.some(({ eligible }) => eligible === 0)) {
    return Response.json({ code: "attendance_profile_ineligible" }, { status: 409 });
  }
  const conditionalUpdates = operation.attendance.updates.filter(
    (update) => update.expectedUpdatedAt !== undefined,
  );
  if (conditionalUpdates.length > 0) {
    const existingRosters = storage.sql
      .exec<{ readonly profile_id: string; readonly updated_at: string | null }>(
        `SELECT profile_id, updated_at FROM event_rosters
         WHERE event_id = ? AND profile_id IN (SELECT value FROM json_each(?))`,
        operation.eventId,
        JSON.stringify(conditionalUpdates.map((u) => u.profileId)),
      )
      .toArray();
    const existingByProfileId = new Map(existingRosters.map((r) => [r.profile_id, r.updated_at]));
    for (const update of conditionalUpdates) {
      const currentUpdatedAt = existingByProfileId.get(update.profileId) ?? null;
      if (currentUpdatedAt !== update.expectedUpdatedAt) {
        return Response.json({ code: "attendance_conflict" }, { status: 409 });
      }
    }
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
  const affectedProfileIds = [
    ...new Set(operation.attendance.updates.map((update) => update.profileId)),
  ];
  recalculateProfileStatuses(
    storage,
    operation.organizationId,
    new Date(occurredAt),
    operation.requestId,
    affectedProfileIds,
  );
  return listEventAttendanceFromStore(storage, {
    eventId: operation.eventId,
    organizationId: operation.organizationId,
  });
}
