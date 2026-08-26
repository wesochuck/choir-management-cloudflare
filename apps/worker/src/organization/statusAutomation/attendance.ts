import { isRsvpDeadlinePassed, rsvpDeadlineFromDate } from "@choir/domain";

import { insertAudit } from "./audit";
import { profileHasVoicePart } from "./store";
import type {
  EventRsvpChange,
  RawEventRow,
  RawPerformanceRow,
  StatusAutomationActor,
  StoredEventRow,
  StoredPerformanceRow,
} from "./types";

export function readPerformances(storage: DurableObjectStorage): readonly StoredPerformanceRow[] {
  return storage.sql
    .exec<RawPerformanceRow>(
      `SELECT p.id AS profileId, e.id, e.title, e.starts_at AS startsAt,
         e.duration_minutes AS durationMinutes, e.is_archived AS isArchived,
         e.is_canceled AS isCanceled, COALESCE(r.rsvp, 'Pending') AS rsvp,
         COALESCE(r.attendance, 'Pending') AS attendance
       FROM profiles p
       CROSS JOIN events e
       LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = p.id
       WHERE e.type = 'Performance' AND e.is_archived = 0 AND e.is_canceled = 0
       ORDER BY r.profile_id, e.starts_at DESC, e.id DESC LIMIT 100000`,
    )
    .toArray()
    .map((row) => ({
      attendance: row.attendance,
      durationMinutes: row.durationMinutes,
      id: row.id,
      isArchived: row.isArchived === 1,
      isCanceled: row.isCanceled === 1,
      profileId: row.profileId,
      rsvp: row.rsvp,
      startsAt: row.startsAt,
      title: row.title,
    }));
}

export function performancesByProfile(
  performances: readonly StoredPerformanceRow[],
): ReadonlyMap<string, readonly StoredPerformanceRow[]> {
  const map = new Map<string, StoredPerformanceRow[]>();
  for (const performance of performances) {
    const records = map.get(performance.profileId);
    if (records) records.push(performance);
    else map.set(performance.profileId, [performance]);
  }
  return map;
}

export function recordEventRsvpChange(
  storage: DurableObjectStorage,
  change: EventRsvpChange,
): boolean {
  if (!profileHasVoicePart(storage, change.profileId)) return false;
  const existing = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly rsvp: "No" | "Pending" | "Yes";
      readonly rsvpNote: string;
    }>(
      "SELECT rsvp, rsvp_note AS rsvpNote FROM event_rosters WHERE event_id = ? AND profile_id = ? LIMIT 1",
      change.eventId,
      change.profileId,
    )
    .toArray()
    .at(0);
  const previous = existing?.rsvp ?? "Pending";
  const requestedNote = change.newRsvp === "No" ? change.rsvpNote : "";
  if (existing && previous === change.newRsvp) {
    if (existing.rsvpNote === requestedNote) return false;
    storage.sql.exec(
      `UPDATE event_rosters SET rsvp_note = ?, updated_at = ?
       WHERE event_id = ? AND profile_id = ?`,
      requestedNote,
      change.occurredAt,
      change.eventId,
      change.profileId,
    );
    insertAudit(
      storage,
      change.actor,
      "event.rsvp.note_updated",
      "event_roster",
      `${change.eventId}:${change.profileId}`,
      {
        automatic: change.automatic,
        rsvp: change.newRsvp,
        reason: change.reason,
      },
      change.occurredAt,
    );
    return true;
  }
  storage.sql.exec(
    `INSERT INTO event_rosters (event_id, profile_id, rsvp, rsvp_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, profile_id) DO UPDATE SET
       rsvp = excluded.rsvp, rsvp_note = excluded.rsvp_note, updated_at = excluded.updated_at`,
    change.eventId,
    change.profileId,
    change.newRsvp,
    requestedNote,
    change.occurredAt,
    change.occurredAt,
  );
  if (!existing && change.newRsvp === "Pending") {
    insertAudit(
      storage,
      change.actor,
      "event.rsvp.updated",
      "event_roster",
      `${change.eventId}:${change.profileId}`,
      {
        automatic: change.automatic,
        newRsvp: change.newRsvp,
        previousRsvp: null,
        reason: change.reason,
      },
      change.occurredAt,
    );
    return false;
  }
  storage.sql.exec(
    `INSERT INTO event_rsvp_history
      (id, event_id, profile_id, previous_rsvp, new_rsvp, reason, automatic,
       actor_type, actor_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    change.eventId,
    change.profileId,
    previous,
    change.newRsvp,
    change.reason,
    change.automatic ? 1 : 0,
    change.actor.actorType,
    change.actor.actorId,
    change.occurredAt,
  );
  insertAudit(
    storage,
    change.actor,
    change.automatic ? "event.rsvp.automated" : "event.rsvp.updated",
    "event_roster",
    `${change.eventId}:${change.profileId}`,
    {
      automatic: change.automatic,
      newRsvp: change.newRsvp,
      previousRsvp: previous,
      reason: change.reason,
    },
    change.occurredAt,
  );
  return true;
}

export function reconcilePresentAttendance(
  storage: DurableObjectStorage,
  input: {
    readonly actor: StatusAutomationActor;
    readonly eventId: string;
    readonly profileId: string;
    readonly occurredAt: string;
  },
): number {
  const event = storage.sql
    .exec<RawEventRow>(
      "SELECT type, starts_at AS startsAt, duration_minutes AS durationMinutes, is_canceled AS isCanceled FROM events WHERE id = ? LIMIT 1",
      input.eventId,
    )
    .toArray()
    .at(0);
  if (!event || event.isCanceled === true || event.isCanceled === 1) return 0;
  const events = [input.eventId];
  if (event.type === "Rehearsal") {
    const parent = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        "SELECT id FROM events WHERE id = (SELECT parent_performance_id FROM events WHERE id = ?) AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0 LIMIT 1",
        input.eventId,
      )
      .toArray()
      .at(0);
    if (parent) events.push(parent.id);
  }
  let changes = 0;
  for (const eventId of events) {
    if (
      recordEventRsvpChange(storage, {
        actor: input.actor,
        automatic: true,
        eventId,
        newRsvp: "Yes",
        occurredAt: input.occurredAt,
        profileId: input.profileId,
        reason:
          eventId === input.eventId
            ? "Present attendance reconciled the RSVP to Yes."
            : "Linked rehearsal attendance reconciled the parent Performance RSVP to Yes.",
        rsvpNote: "",
      })
    ) {
      changes += 1;
    }
  }
  return changes;
}

export function decorateEventWithRsvpDeadline(
  event: StoredEventRow,
  timezone: string,
  now = new Date(),
): {
  readonly rsvpDeadlineAt: string | null;
  readonly rsvpDeadlineDate: string | null;
  readonly rsvpDeadlinePassed: boolean;
  readonly rsvpSelfServiceOpen: boolean;
} {
  const deadline =
    event.type === "Performance" && event.isCanceled !== true && event.isCanceled !== 1
      ? rsvpDeadlineFromDate(event.rsvpDeadlineDate ?? "", timezone)
      : null;
  const startsAt = new Date(event.startsAt);
  const beforeStart = Number.isFinite(startsAt.getTime()) && startsAt.getTime() > now.getTime();
  return {
    rsvpDeadlineAt: deadline?.deadlineAt ?? null,
    rsvpDeadlineDate: deadline?.deadlineDate ?? null,
    rsvpDeadlinePassed: isRsvpDeadlinePassed(deadline, now),
    rsvpSelfServiceOpen:
      event.isCanceled !== true &&
      event.isCanceled !== 1 &&
      beforeStart &&
      (event.type !== "Performance" || !isRsvpDeadlinePassed(deadline, now)),
  };
}
