import {
  organizationRosterConfigurationRequestSchema,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import { defaultRosterConfiguration, isPerformer } from "@choir/domain";

import { MAX_AUTOMATION_PROFILES, type StoredProfileRow } from "./types";

export function identityMatches(
  storage: DurableObjectStorage,
  organizationId: string | null,
): boolean {
  if (!organizationId) return false;
  const row = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return row?.organizationId === organizationId;
}

export function readTimezone(storage: DurableObjectStorage): string {
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

export function readProfiles(storage: DurableObjectStorage): readonly StoredProfileRow[] {
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
