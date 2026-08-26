import { calculateOnBreakInactiveAt } from "@choir/domain";

import { insertAudit } from "./audit";
import { identityMatches, readRosterAutomationConfiguration, readTimezone } from "./store";
import { MILLISECONDS_PER_DAY, STATUS_AUTOMATION_FIXTURE_DISPLAY_PREFIX } from "./types";

export {
  MAX_AUTOMATION_PROFILES,
  MILLISECONDS_PER_DAY,
  STATUS_AUTOMATION_FIXTURE_DISPLAY_PREFIX,
} from "./types";

export function seedStagingStatusAutomationFixture(
  storage: DurableObjectStorage,
  input: {
    readonly actorUserId: string;
    readonly organizationId: string | null;
    readonly profileId: string;
    readonly requestId: string;
  },
  now = new Date(),
): Response {
  if (!identityMatches(storage, input.organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }

  const profile = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly displayName: string;
      readonly globalStatus: "Active" | "Idle" | "Inactive";
      readonly id: string;
      readonly showInDirectory: number;
      readonly statusChangedAt: string;
      readonly statusIsManual: number;
      readonly voicePart: string;
    }>(
      `SELECT id, display_name AS displayName, global_status AS globalStatus,
         show_in_directory AS showInDirectory, status_changed_at AS statusChangedAt,
         status_is_manual AS statusIsManual, voice_part AS voicePart
       FROM profiles WHERE id = ? LIMIT 1`,
      input.profileId,
    )
    .toArray()
    .at(0);
  if (!profile) return Response.json({ code: "profile_not_found" }, { status: 404 });
  if (
    !profile.displayName.startsWith(STATUS_AUTOMATION_FIXTURE_DISPLAY_PREFIX) ||
    profile.showInDirectory !== 0
  ) {
    return Response.json({ code: "invalid_status_automation_fixture" }, { status: 409 });
  }
  if (
    profile.globalStatus !== "Idle" ||
    profile.statusIsManual !== 0 ||
    profile.voicePart.trim() === ""
  ) {
    return Response.json({ code: "status_automation_fixture_not_eligible" }, { status: 409 });
  }

  const configuration = readRosterAutomationConfiguration(storage);
  const timezone = readTimezone(storage);
  const currentTimeoutAt = calculateOnBreakInactiveAt({
    enabled: configuration.onBreakTimeoutEnabled,
    isManual: false,
    now,
    status: "Idle",
    statusChangedAt: profile.statusChangedAt,
    timeoutDays: configuration.onBreakTimeoutDays,
    timezone,
  });
  const currentTimeoutDue =
    currentTimeoutAt !== null && new Date(currentTimeoutAt).getTime() <= now.getTime();
  const statusChangedAt = currentTimeoutDue
    ? profile.statusChangedAt
    : new Date(
        now.getTime() - (configuration.onBreakTimeoutDays + 2) * MILLISECONDS_PER_DAY,
      ).toISOString();
  const timeoutAt = calculateOnBreakInactiveAt({
    enabled: configuration.onBreakTimeoutEnabled,
    isManual: false,
    now,
    status: "Idle",
    statusChangedAt,
    timeoutDays: configuration.onBreakTimeoutDays,
    timezone,
  });
  if (timeoutAt === null || new Date(timeoutAt).getTime() > now.getTime()) {
    return Response.json({ code: "status_automation_fixture_clock_invalid" }, { status: 409 });
  }

  if (!currentTimeoutDue) {
    const occurredAt = now.toISOString();
    storage.transactionSync(() => {
      storage.sql.exec(
        `UPDATE profiles
         SET status_changed_at = ?, status_change_reason = ?, updated_at = ?
         WHERE id = ? AND global_status = 'Idle' AND status_is_manual = 0`,
        statusChangedAt,
        "Staging Status automation qualification fixture.",
        occurredAt,
        input.profileId,
      );
      insertAudit(
        storage,
        {
          actorId: input.actorUserId,
          actorType: "organization_member",
          requestId: input.requestId,
        },
        "profile.status.automation_fixture_seeded",
        "profile",
        input.profileId,
        {
          statusChangedAt,
          timeoutDays: configuration.onBreakTimeoutDays,
        },
        occurredAt,
      );
    });
  }

  return Response.json({
    fixture: true,
    onBreakInactiveAt: timeoutAt,
    profileId: input.profileId,
    statusChangedAt,
    timeoutDays: configuration.onBreakTimeoutDays,
  });
}
