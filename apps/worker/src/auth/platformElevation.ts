import { failure, success, type DomainResult } from "@choir/domain";

export interface PlatformOrganizationContext {
  readonly canEdit: boolean;
  readonly elevationExpiresAt: string | null;
  readonly elevationId: string | null;
  readonly organizationId: string;
  readonly userId: string;
}

interface ActiveElevationRow {
  readonly expiresAt: string;
  readonly id: string;
}

export interface CreatePlatformElevationInput {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly reason: string;
  readonly requestId: string;
  readonly sessionId: string;
}

const ELEVATION_DURATION_MS = 15 * 60 * 1000;

async function findActiveElevation(
  database: D1Database,
  organizationId: string,
  sessionId: string,
  userId: string,
  now: Date,
): Promise<ActiveElevationRow | null> {
  return database
    .prepare(
      `SELECT id, expires_at AS expiresAt
       FROM platform_elevations
       WHERE user_id = ?
         AND session_id = ?
         AND organization_id = ?
         AND revoked_at IS NULL
         AND expires_at > ?
       ORDER BY expires_at DESC
       LIMIT 1`,
    )
    .bind(userId, sessionId, organizationId, now.toISOString())
    .first<ActiveElevationRow>();
}

export async function getPlatformOrganizationContext(
  database: D1Database,
  organizationId: string,
  sessionId: string,
  userId: string,
  now = new Date(),
): Promise<PlatformOrganizationContext> {
  const elevation = await findActiveElevation(database, organizationId, sessionId, userId, now);
  return {
    canEdit: elevation !== null,
    elevationExpiresAt: elevation?.expiresAt ?? null,
    elevationId: elevation?.id ?? null,
    organizationId,
    userId,
  };
}

export async function createPlatformElevation(
  database: D1Database,
  input: CreatePlatformElevationInput,
  now = new Date(),
): Promise<PlatformOrganizationContext> {
  const existing = await findActiveElevation(
    database,
    input.organizationId,
    input.sessionId,
    input.actorUserId,
    now,
  );
  if (existing) {
    return {
      canEdit: true,
      elevationExpiresAt: existing.expiresAt,
      elevationId: existing.id,
      organizationId: input.organizationId,
      userId: input.actorUserId,
    };
  }

  const elevationId = crypto.randomUUID();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ELEVATION_DURATION_MS).toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO platform_elevations
          (id, user_id, organization_id, request_id, expires_at, revoked_at, created_at, session_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(
        elevationId,
        input.actorUserId,
        input.organizationId,
        input.requestId,
        expiresAt,
        createdAt,
        input.sessionId,
      ),
    database
      .prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'platform.elevation.created', 'platform_elevation', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.actorUserId,
        input.organizationId,
        elevationId,
        input.requestId,
        JSON.stringify({ expiresAt, reason: input.reason }),
        createdAt,
      ),
  ]);

  return {
    canEdit: true,
    elevationExpiresAt: expiresAt,
    elevationId,
    organizationId: input.organizationId,
    userId: input.actorUserId,
  };
}

export async function revokePlatformElevation(
  database: D1Database,
  input: {
    readonly actorUserId: string;
    readonly elevationId: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly sessionId: string;
  },
  now = new Date(),
): Promise<DomainResult<{ readonly elevationId: string }>> {
  const revokedAt = now.toISOString();
  const existing = await database
    .prepare(
      `SELECT id FROM platform_elevations
       WHERE id = ? AND user_id = ? AND session_id = ? AND organization_id = ?
         AND revoked_at IS NULL
       LIMIT 1`,
    )
    .bind(input.elevationId, input.actorUserId, input.sessionId, input.organizationId)
    .first<{ id: string }>();
  if (!existing) {
    return failure("not_found", "The active Platform Administrator elevation was not found.");
  }

  const results = await database.batch([
    database
      .prepare(
        `UPDATE platform_elevations
         SET revoked_at = ?
         WHERE id = ? AND user_id = ? AND session_id = ? AND organization_id = ?
           AND revoked_at IS NULL`,
      )
      .bind(revokedAt, input.elevationId, input.actorUserId, input.sessionId, input.organizationId),
    database
      .prepare(
        `INSERT OR IGNORE INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'platform.elevation.revoked', 'platform_elevation', ?, ?, ?, ?)`,
      )
      .bind(
        `platform-elevation-revoked:${input.elevationId}`,
        input.actorUserId,
        input.organizationId,
        input.elevationId,
        input.requestId,
        JSON.stringify({ revokedAt }),
        revokedAt,
      ),
  ]);
  if (results[0]?.meta.changes !== 1) {
    return failure("not_found", "The active Platform Administrator elevation was not found.");
  }
  return success({ elevationId: input.elevationId });
}
