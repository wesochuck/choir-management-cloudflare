import {
  organizationRosterAutomationPreviewRequestSchema,
  organizationRosterAutomationPreviewResponseSchema,
  organizationProfileStatusHistoryResponseSchema,
  type OrganizationRosterAutomationPreviewResponse,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import {
  calculateOnBreakInactiveAt,
  calculateRsvpDeadline,
  defaultRosterConfiguration,
  evaluateProfileStatus,
  isRsvpDeadlinePassed,
  isPerformer,
  type PerformanceAutomationRecord,
} from "@choir/domain";

import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";

interface StoredProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly displayName: string;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly id: string;
  readonly statusChangedAt: string;
  readonly statusChangeReason: string;
  readonly statusIsManual: number;
  readonly voicePart: string;
}

interface RawPerformanceRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: "Absent" | "Pending" | "Present";
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly isArchived: number;
  readonly isCanceled: number;
  readonly profileId: string;
  readonly rsvp: "No" | "Pending" | "Yes";
  readonly startsAt: string;
  readonly title: string;
}

interface StoredPerformanceRow extends PerformanceAutomationRecord {
  readonly attendance: "Absent" | "Pending" | "Present";
  readonly profileId: string;
  readonly title: string;
}

interface StoredPendingRsvpRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly profileId: string;
  readonly startsAt: string;
  readonly type: "Performance" | "Rehearsal";
}

interface StoredEventRow {
  readonly durationMinutes: number | null;
  readonly isCanceled?: boolean | number;
  readonly startsAt: string;
  readonly type: "Performance" | "Rehearsal";
}

type RawEventRow = StoredEventRow & Record<string, SqlStorageValue>;

interface StatusAutomationActor {
  readonly actorId: string;
  readonly actorType: "organization_member" | "system";
  readonly requestId: string;
}

const MAX_AUTOMATION_PROFILES = 5_000;

export interface EventRsvpChange {
  readonly actor: StatusAutomationActor;
  readonly automatic: boolean;
  readonly eventId: string;
  readonly newRsvp: "No" | "Pending" | "Yes";
  readonly profileId: string;
  readonly reason: string;
  readonly rsvpNote: string;
  readonly occurredAt: string;
}

const defaultStatusAutomationActor = (
  organizationId: string,
  occurredAt: string,
): StatusAutomationActor => ({
  actorId: "",
  actorType: "system",
  requestId: `automation:${organizationId}:${occurredAt}`,
});

function identityMatches(storage: DurableObjectStorage, organizationId: string | null): boolean {
  if (!organizationId) return false;
  const row = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return row?.organizationId === organizationId;
}

function readTimezone(storage: DurableObjectStorage): string {
  return storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
}

export function readRosterAutomationConfiguration(
  storage: DurableObjectStorage,
): OrganizationRosterConfiguration {
  const raw = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly configuration: string }>(
      "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
    )
    .one().configuration;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = organizationRosterConfigurationRequestSchema.safeParse(parsed);
    return result.success
      ? result.data
      : organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration);
  } catch {
    return organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration);
  }
}

function readProfiles(storage: DurableObjectStorage): readonly StoredProfileRow[] {
  return storage.sql
    .exec<StoredProfileRow>(
      `SELECT id, display_name AS displayName, created_at AS createdAt, voice_part AS voicePart,
         global_status AS globalStatus, status_is_manual AS statusIsManual,
         status_changed_at AS statusChangedAt, status_change_reason AS statusChangeReason
       FROM profiles ORDER BY display_name COLLATE NOCASE ASC, id ASC LIMIT ${String(MAX_AUTOMATION_PROFILES)}`,
    )
    .toArray();
}

export function profileHasVoicePart(storage: DurableObjectStorage, profileId: string): boolean {
  const profile = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly voicePart: string;
    }>("SELECT COALESCE(voice_part, '') AS voicePart FROM profiles WHERE id = ? LIMIT 1", profileId)
    .toArray()
    .at(0);
  return profile !== undefined && isPerformer(profile);
}

function readPerformances(storage: DurableObjectStorage): readonly StoredPerformanceRow[] {
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

function performancesByProfile(
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

function previewProfile(
  profile: StoredProfileRow,
  configuration: OrganizationRosterConfiguration,
  performances: readonly StoredPerformanceRow[],
  now: Date,
  timezone: string,
): {
  readonly currentStatus: StoredProfileRow["globalStatus"];
  readonly displayName: string;
  readonly id: string;
  readonly nextStatus: StoredProfileRow["globalStatus"];
  readonly nextStatusReason: string;
  readonly onBreakInactiveDate: string | null;
  readonly recentPerformances: {
    readonly attendance: "Absent" | "Pending" | "Present";
    readonly id: string;
    readonly rsvp: "No" | "Pending" | "Yes";
    readonly startsAt: string;
    readonly title: string;
  }[];
} {
  const evaluation = evaluateProfileStatus({
    configuration,
    now,
    performances,
    profile: {
      currentStatus: profile.globalStatus,
      isManual: profile.statusIsManual === 1,
      isPerformer: profile.voicePart.trim().length > 0,
    },
    timezone,
  });
  const timeoutAt = calculateOnBreakInactiveAt({
    enabled: configuration.onBreakTimeoutEnabled,
    isManual: profile.statusIsManual === 1,
    now,
    status: profile.globalStatus,
    statusChangedAt: profile.statusChangedAt || profile.createdAt,
    timeoutDays: configuration.onBreakTimeoutDays,
    timezone,
  });
  const timeoutDue =
    timeoutAt !== null &&
    new Date(timeoutAt).getTime() <= now.getTime() &&
    evaluation.nextStatus === "Idle";
  const nextStatus = timeoutDue ? "Inactive" : evaluation.nextStatus;
  return {
    currentStatus: profile.globalStatus,
    displayName: profile.displayName,
    id: profile.id,
    nextStatus,
    nextStatusReason: timeoutDue
      ? `On Break has reached its ${String(configuration.onBreakTimeoutDays)}-day timeout.`
      : evaluation.reason,
    onBreakInactiveDate: timeoutAt,
    recentPerformances: [...performances]
      .sort(
        (left, right) =>
          right.startsAt.localeCompare(left.startsAt) || right.id.localeCompare(left.id),
      )
      .slice(0, 10)
      .map(({ attendance, id, rsvp, startsAt, title }) => ({
        attendance,
        id,
        rsvp,
        startsAt,
        title,
      })),
  };
}

function countRsvpExpirations(
  storage: DurableObjectStorage,
  configuration: OrganizationRosterConfiguration,
  now: Date,
  timezone: string,
): { readonly count: number; readonly profileIds: ReadonlySet<string> } {
  if (!configuration.rsvpExpiryEnabled) return { count: 0, profileIds: new Set() };
  const pending = storage.sql
    .exec<StoredPendingRsvpRow>(
      `SELECT e.id AS eventId, p.id AS profileId, e.starts_at AS startsAt, e.type
       FROM events e
       CROSS JOIN profiles p
       LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = p.id
       WHERE COALESCE(r.rsvp, 'Pending') = 'Pending'
         AND e.type = 'Performance' AND e.is_archived = 0 AND e.is_canceled = 0
       ORDER BY e.starts_at, e.id, p.id LIMIT 100000`,
    )
    .toArray();
  const profileIds = new Set<string>();
  let count = 0;
  for (const row of pending) {
    const deadline = calculateRsvpDeadline(row, configuration.rsvpExpiryLeadDays, timezone);
    const startsAt = new Date(row.startsAt);
    if (
      Number.isFinite(startsAt.getTime()) &&
      startsAt.getTime() > now.getTime() &&
      isRsvpDeadlinePassed(deadline, now)
    ) {
      count += 1;
      profileIds.add(row.profileId);
    }
  }
  return { count, profileIds };
}

export function previewRosterAutomation(
  storage: DurableObjectStorage,
  organizationId: string | null,
  input: unknown,
  now = new Date(),
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const parsed = organizationRosterAutomationPreviewRequestSchema.safeParse(input);
  if (!parsed.success)
    return Response.json({ code: "invalid_roster_automation_preview" }, { status: 400 });
  const timezone = readTimezone(storage);
  const profiles = readProfiles(storage);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const performances = performancesByProfile(readPerformances(storage));
  const selected = parsed.data.profileId ? profileById.get(parsed.data.profileId) : undefined;
  const selectedPreview = selected
    ? previewProfile(
        selected,
        parsed.data.configuration,
        performances.get(selected.id) ?? [],
        now,
        timezone,
      )
    : null;
  const changedProfiles = new Set<string>();
  let statusChangeCount = 0;
  let onBreakTimeoutCount = 0;
  for (const profile of profiles) {
    const result = previewProfile(
      profile,
      parsed.data.configuration,
      performances.get(profile.id) ?? [],
      now,
      timezone,
    );
    if (result.nextStatus !== result.currentStatus) {
      statusChangeCount += 1;
      changedProfiles.add(profile.id);
    }
    if (
      profile.globalStatus === "Idle" &&
      result.nextStatus === "Inactive" &&
      result.nextStatusReason.startsWith("On Break")
    ) {
      onBreakTimeoutCount += 1;
      changedProfiles.add(profile.id);
    }
  }
  const rsvpExpirations = countRsvpExpirations(storage, parsed.data.configuration, now, timezone);
  for (const profileId of rsvpExpirations.profileIds) changedProfiles.add(profileId);
  const result: OrganizationRosterAutomationPreviewResponse = {
    affectedProfileCount: changedProfiles.size,
    onBreakTimeoutCount,
    rsvpExpiryCount: rsvpExpirations.count,
    selectedProfile: selectedPreview,
    statusChangeCount,
  };
  return Response.json(organizationRosterAutomationPreviewResponseSchema.parse(result));
}

function insertAudit(
  storage: DurableObjectStorage,
  actor: StatusAutomationActor,
  action: string,
  targetType: string,
  targetId: string,
  changeSummary: Readonly<Record<string, unknown>>,
  occurredAt: string,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    actor.actorType,
    actor.actorId,
    action,
    targetType,
    targetId,
    actor.requestId,
    JSON.stringify(changeSummary),
    occurredAt,
  );
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

function recalculateProfileStatusesInTransaction(
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
             e.starts_at AS startsAt, e.type
           FROM events e
           CROSS JOIN profiles p
           LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = p.id
           WHERE COALESCE(r.rsvp, 'Pending') = 'Pending'
             AND e.type = 'Performance' AND e.is_archived = 0 AND e.is_canceled = 0
           ORDER BY e.starts_at, e.id, p.id LIMIT 100000`,
        )
        .toArray();
      for (const row of pending) {
        const deadline = calculateRsvpDeadline(row, configuration.rsvpExpiryLeadDays, timezone);
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
  configuration: OrganizationRosterConfiguration,
  timezone: string,
  now = new Date(),
): {
  readonly rsvpDeadlineAt: string | null;
  readonly rsvpDeadlineDate: string | null;
  readonly rsvpDeadlinePassed: boolean;
  readonly rsvpSelfServiceOpen: boolean;
} {
  const deadline = configuration.rsvpExpiryEnabled
    ? event.isCanceled === true || event.isCanceled === 1
      ? null
      : calculateRsvpDeadline(event, configuration.rsvpExpiryLeadDays, timezone)
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

export function readRosterAutomationPreviewFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  input: unknown,
): Response {
  return previewRosterAutomation(storage, organizationId, input);
}

export function listProfileStatusHistoryFromStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string | null; readonly profileId: string | null },
): Response {
  if (!identityMatches(storage, input.organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const profileId = input.profileId;
  if (
    !profileId ||
    storage.sql.exec("SELECT 1 FROM profiles WHERE id = ? LIMIT 1", profileId).toArray().length ===
      0
  ) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const entries = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly actorType: string;
      readonly newStatus: "Active" | "Idle" | "Inactive";
      readonly occurredAt: string;
      readonly previousStatus: "Active" | "Idle" | "Inactive";
      readonly reason: string;
      readonly triggerType: string;
    }>(
      `SELECT previous_status AS previousStatus, new_status AS newStatus,
         trigger_type AS triggerType, reason, actor_type AS actorType, occurred_at AS occurredAt
       FROM profile_status_history WHERE profile_id = ?
       ORDER BY occurred_at DESC, id DESC LIMIT 500`,
      profileId,
    )
    .toArray();
  return Response.json(
    organizationProfileStatusHistoryResponseSchema.parse({ entries, profileId }),
  );
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
