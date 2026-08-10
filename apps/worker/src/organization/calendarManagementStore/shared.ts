import {
  organizationRosterConfigurationRequestSchema,
  organizationSetListItemSchema,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import { defaultRosterConfiguration } from "@choir/domain";
import type { IdentityRow } from "./contracts";

export function identityMatches(
  storage: DurableObjectStorage,
  organizationId: string | null,
): boolean {
  if (!organizationId) return false;
  const row = storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return row?.organizationId === organizationId;
}

export function recordExists(
  storage: DurableObjectStorage,
  table: "events" | "profiles" | "venues",
  id: string,
): boolean {
  return storage.sql.exec(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`, id).toArray().length === 1;
}

export function existingRecordIds(
  storage: DurableObjectStorage,
  table: "music_pieces" | "profiles",
  ids: ReadonlySet<string>,
): ReadonlySet<string> {
  const existing = new Set<string>();
  const pending = [...ids];
  for (let offset = 0; offset < pending.length; offset += 100) {
    const chunk = pending.slice(offset, offset + 100);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        `SELECT id FROM ${table} WHERE id IN (${placeholders})`,
        ...chunk,
      )
      .toArray();
    for (const { id } of rows) existing.add(id);
  }
  return existing;
}

export function insertAudit(
  storage: DurableObjectStorage,
  actor: { readonly actorUserId: string; readonly requestId: string },
  action: string,
  targetType: string,
  targetId: string,
  summary: Readonly<Record<string, unknown>>,
  occurredAt: string,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, ?, ?, ?, ?, ?)`,
    `${action}:${actor.requestId}`,
    actor.actorUserId,
    action,
    targetType,
    targetId,
    actor.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

export function parseSetList(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function featuredAssignmentsForProfile(
  value: string,
  profileId: string,
): {
  readonly pieceId: string | null;
  readonly title: string;
}[] {
  return parseSetList(value)
    .map((item) => organizationSetListItemSchema.safeParse(item))
    .filter((result) => result.success && result.data.isFeaturedNumber === true)
    .filter((result) =>
      result.success
        ? result.data.performerCredits?.some(
            (credit) => credit.kind === "profile" && credit.profileId === profileId,
          )
        : false,
    )
    .map((result) =>
      result.success ? { pieceId: result.data.pieceId ?? null, title: result.data.title } : null,
    )
    .filter(
      (item): item is { readonly pieceId: string | null; readonly title: string } => item !== null,
    );
}

export function rosterConfigurationFromStore(
  storage: DurableObjectStorage,
): OrganizationRosterConfiguration {
  const raw = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly configuration: string }>(
      `SELECT roster_configuration_json AS configuration
       FROM organization_metadata LIMIT 1`,
    )
    .one().configuration;
  try {
    const configuration: unknown = JSON.parse(raw);
    const parsed = organizationRosterConfigurationRequestSchema.safeParse(configuration);
    return parsed.success
      ? parsed.data
      : organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration);
  } catch {
    return organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration);
  }
}
