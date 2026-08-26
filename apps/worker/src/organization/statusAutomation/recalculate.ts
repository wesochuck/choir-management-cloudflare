import {
  calculateOnBreakInactiveAt,
  evaluateProfileStatus,
  isRsvpDeadlinePassed,
  rsvpDeadlineFromDate,
} from "@choir/domain";

import { insertAudit } from "./audit";
import { recordEventRsvpChange } from "./attendance";
import { readProfiles, readRosterAutomationConfiguration, readTimezone } from "./store";
import { performancesByProfile, readPerformances } from "./attendance";
import type { StatusAutomationActor, StoredPendingRsvpRow } from "./types";
import { defaultStatusAutomationActor } from "./types";

export function recordProfileStatusChange(
  storage: DurableObjectStorage,
  input: {
    readonly actor: StatusAutomationActor;
    readonly newStatus: "Active" | "Idle" | "Inactive";
    readonly profileId: string;
    readonly reason: string;
    readonly triggerId: string;
    readonly triggerType: string;
    readonly occurredAt: string;
  },
): boolean {
  const previous = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly status: "Active" | "Idle" | "Inactive";
    }>("SELECT global_status AS status FROM profiles WHERE id = ? LIMIT 1", input.profileId)
    .toArray()
    .at(0)?.status;
  if (!previous || previous === input.newStatus) return false;
  storage.sql.exec(
    `UPDATE profiles SET global_status = ?, status_changed_at = ?, status_change_reason = ?, updated_at = ?
     WHERE id = ?`,
    input.newStatus,
    input.occurredAt,
    input.reason,
    input.occurredAt,
    input.profileId,
  );
  storage.sql.exec(
    `INSERT INTO profile_status_history
      (id, profile_id, previous_status, new_status, trigger_type, trigger_id, reason,
       actor_type, actor_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    input.profileId,
    previous,
    input.newStatus,
    input.triggerType,
    input.triggerId,
    input.reason,
    input.actor.actorType,
    input.actor.actorId,
    input.occurredAt,
  );
  insertAudit(
    storage,
    input.actor,
    input.actor.actorType === "system" ? "profile.status.automated" : "profile.status.updated",
    "profile",
    input.profileId,
    { newStatus: input.newStatus, previousStatus: previous, reason: input.reason },
    input.occurredAt,
  );
  return true;
}

export function recalculateProfileStatusesInTransaction(
  storage: DurableObjectStorage,
  now: Date,
  actor: StatusAutomationActor,
): number {
  const configuration = readRosterAutomationConfiguration(storage);
  const timezone = readTimezone(storage);
  const performances = performancesByProfile(readPerformances(storage));
  let changed = 0;
  for (const profile of readProfiles(storage)) {
    if (profile.statusIsManual === 1 || profile.voicePart.trim() === "") continue;
    const profilePerformances = performances.get(profile.id) ?? [];
    const evaluation = evaluateProfileStatus({
      configuration,
      now,
      performances: profilePerformances,
      profile: {
        currentStatus: profile.globalStatus,
        isManual: false,
        isPerformer: true,
      },
      timezone,
    });
    let nextStatus = evaluation.nextStatus;
    let reason = evaluation.reason;
    let triggerType: string = evaluation.triggerType;
    let triggerId = evaluation.triggerId;
    const timeoutAt = calculateOnBreakInactiveAt({
      enabled: configuration.onBreakTimeoutEnabled,
      isManual: false,
      now,
      status: profile.globalStatus,
      statusChangedAt: profile.statusChangedAt || profile.createdAt,
      timeoutDays: configuration.onBreakTimeoutDays,
      timezone,
    });
    if (
      nextStatus === "Idle" &&
      timeoutAt !== null &&
      new Date(timeoutAt).getTime() <= now.getTime()
    ) {
      nextStatus = "Inactive";
      reason = `On Break has reached its ${String(configuration.onBreakTimeoutDays)}-day timeout.`;
      triggerType = "on_break_timeout";
      triggerId = "";
    }
    if (
      recordProfileStatusChange(storage, {
        actor,
        newStatus: nextStatus,
        occurredAt: now.toISOString(),
        profileId: profile.id,
        reason,
        triggerId,
        triggerType,
      })
    ) {
      changed += 1;
    }
  }
  return changed;
}

export function runRosterAutomations(
  storage: DurableObjectStorage,
  organizationId: string,
  now = new Date(),
  requestId?: string,
): { readonly profileStatusChanges: number; readonly rsvpExpirations: number } {
  const actor =
    requestId === undefined
      ? defaultStatusAutomationActor(organizationId, now.toISOString())
      : { actorId: "", actorType: "system" as const, requestId };
  let rsvpExpirations = 0;
  let profileStatusChanges = 0;
  storage.transactionSync(() => {
    const configuration = readRosterAutomationConfiguration(storage);
    const timezone = readTimezone(storage);
    if (configuration.rsvpExpiryEnabled) {
      const pending = storage.sql
        .exec<StoredPendingRsvpRow>(
          `SELECT e.id AS eventId, p.id AS profileId,
             e.starts_at AS startsAt, e.type, e.rsvp_deadline_date AS rsvpDeadlineDate
           FROM events e
           CROSS JOIN profiles p
           LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = p.id
           WHERE COALESCE(r.rsvp, 'Pending') = 'Pending'
             AND e.type = 'Performance' AND e.is_archived = 0 AND e.is_canceled = 0
           ORDER BY e.starts_at, e.id, p.id LIMIT 100000`,
        )
        .toArray();
      for (const row of pending) {
        const deadline = rsvpDeadlineFromDate(row.rsvpDeadlineDate ?? "", timezone);
        const startsAt = new Date(row.startsAt);
        if (
          Number.isFinite(startsAt.getTime()) &&
          startsAt.getTime() > now.getTime() &&
          deadline &&
          isRsvpDeadlinePassed(deadline, now) &&
          recordEventRsvpChange(storage, {
            actor,
            automatic: true,
            eventId: row.eventId,
            newRsvp: "No",
            occurredAt: now.toISOString(),
            profileId: row.profileId,
            reason: `RSVP deadline passed on ${deadline.deadlineDate}.`,
            rsvpNote: "",
          })
        ) {
          rsvpExpirations += 1;
        }
      }
    }
    profileStatusChanges = recalculateProfileStatusesInTransaction(storage, now, actor);
  });
  return { profileStatusChanges, rsvpExpirations };
}

export function recalculateProfileStatuses(
  storage: DurableObjectStorage,
  organizationId: string,
  now = new Date(),
  requestId?: string,
): number {
  let changed = 0;
  const actor =
    requestId === undefined
      ? defaultStatusAutomationActor(organizationId, now.toISOString())
      : { actorId: "", actorType: "system" as const, requestId };
  storage.transactionSync(() => {
    changed = recalculateProfileStatusesInTransaction(storage, now, actor);
  });
  return changed;
}
