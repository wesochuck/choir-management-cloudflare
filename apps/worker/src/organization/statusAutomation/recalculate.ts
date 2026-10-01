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
import type { StatusAutomationActor } from "./types";
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
  affectedProfileIds?: readonly string[],
): number {
  const configuration = readRosterAutomationConfiguration(storage);
  const timezone = readTimezone(storage);
  const profiles = readProfiles(storage, affectedProfileIds);
  const eligibleProfiles = profiles.filter(
    (profile) => profile.statusIsManual !== 1 && profile.voicePart.trim() !== "",
  );
  const performances = performancesByProfile(
    configuration.statusAutomationEnabled
      ? readPerformances(
          storage,
          eligibleProfiles.map((profile) => profile.id),
          {
            now,
            timezone,
            endedLimit: configuration.statusAutomationMissThreshold,
            includeRecent: false,
          },
        )
      : [],
  );
  let changed = 0;
  for (const profile of profiles) {
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
  affectedProfileIds?: readonly string[],
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
    const expiredProfileIds = new Set<string>();
    if (configuration.rsvpExpiryEnabled) {
      const candidateEvents = storage.sql
        .exec<{
          readonly id: string;
          readonly startsAt: string;
          readonly rsvpDeadlineDate: string;
        }>(
          `SELECT id, starts_at AS startsAt, rsvp_deadline_date AS rsvpDeadlineDate
           FROM events
           WHERE type = 'Performance' AND is_archived = 0 AND is_canceled = 0
             AND rsvp_deadline_date IS NOT NULL AND rsvp_deadline_date != ''
             AND starts_at > ?
           ORDER BY starts_at, id`,
          now.toISOString(),
        )
        .toArray();
      for (const event of candidateEvents) {
        const deadline = rsvpDeadlineFromDate(event.rsvpDeadlineDate, timezone);
        const startsAt = new Date(event.startsAt);
        if (
          !Number.isFinite(startsAt.getTime()) ||
          startsAt.getTime() <= now.getTime() ||
          !deadline ||
          !isRsvpDeadlinePassed(deadline, now)
        ) {
          continue;
        }
        const pendingProfiles = storage.sql
          .exec<{ readonly profileId: string }>(
            `SELECT p.id AS profileId
             FROM profiles p
             LEFT JOIN event_rosters r ON r.event_id = ? AND r.profile_id = p.id
             WHERE trim(COALESCE(p.voice_part, '')) != ''
               AND COALESCE(r.rsvp, 'Pending') = 'Pending'
             ORDER BY p.id`,
            event.id,
          )
          .toArray();
        for (const row of pendingProfiles) {
          if (
            recordEventRsvpChange(storage, {
              actor,
              automatic: true,
              eventId: event.id,
              newRsvp: "No",
              occurredAt: now.toISOString(),
              profileId: row.profileId,
              reason: `RSVP deadline passed on ${deadline.deadlineDate}.`,
              rsvpNote: "",
            })
          ) {
            rsvpExpirations += 1;
            expiredProfileIds.add(row.profileId);
          }
        }
      }
    }
    let targetProfileIds = affectedProfileIds;
    if (affectedProfileIds && expiredProfileIds.size > 0) {
      targetProfileIds = [...new Set([...affectedProfileIds, ...expiredProfileIds])];
    }
    profileStatusChanges = recalculateProfileStatusesInTransaction(
      storage,
      now,
      actor,
      targetProfileIds,
    );
  });
  return { profileStatusChanges, rsvpExpirations };
}

export function recalculateProfileStatuses(
  storage: DurableObjectStorage,
  organizationId: string,
  now = new Date(),
  requestId?: string,
  affectedProfileIds?: readonly string[],
): number {
  let changed = 0;
  const actor =
    requestId === undefined
      ? defaultStatusAutomationActor(organizationId, now.toISOString())
      : { actorId: "", actorType: "system" as const, requestId };
  storage.transactionSync(() => {
    changed = recalculateProfileStatusesInTransaction(storage, now, actor, affectedProfileIds);
  });
  return changed;
}
