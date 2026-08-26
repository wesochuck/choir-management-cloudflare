import {
  organizationProfileStatusHistoryResponseSchema,
  organizationRosterAutomationPreviewRequestSchema,
  organizationRosterAutomationPreviewResponseSchema,
  type OrganizationRosterAutomationPreviewResponse,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import {
  calculateOnBreakInactiveAt,
  evaluateProfileStatus,
  isRsvpDeadlinePassed,
  rsvpDeadlineFromDate,
} from "@choir/domain";

import { identityMatches, readProfiles, readTimezone } from "./store";
import { performancesByProfile, readPerformances } from "./attendance";
import type { StoredPendingRsvpRow, StoredProfileRow, StoredPerformanceRow } from "./types";

export function previewProfile(
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

export function countRsvpExpirations(
  storage: DurableObjectStorage,
  configuration: OrganizationRosterConfiguration,
  now: Date,
  timezone: string,
): { readonly count: number; readonly profileIds: ReadonlySet<string> } {
  if (!configuration.rsvpExpiryEnabled) return { count: 0, profileIds: new Set() };
  const pending = storage.sql
    .exec<StoredPendingRsvpRow>(
      `SELECT e.id AS eventId, p.id AS profileId, e.starts_at AS startsAt, e.type,
         e.rsvp_deadline_date AS rsvpDeadlineDate
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
    const deadline = rsvpDeadlineFromDate(row.rsvpDeadlineDate ?? "", timezone);
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
