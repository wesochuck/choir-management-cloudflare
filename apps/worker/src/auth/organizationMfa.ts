import { failure, success, type DomainResult } from "@choir/domain";

export type OrganizationMfaMethod = "recovery_code" | "totp";

const ORGANIZATION_MFA_ASSERTION_SECONDS = 12 * 60 * 60;

interface OrganizationMfaEligibilityRow {
  readonly mfaRequired: number;
  readonly twoFactorEnabled: number | null;
  readonly twoFactorVerified: number | null;
}

interface OrganizationMfaStatusRow extends OrganizationMfaEligibilityRow {
  readonly assertionExpiresAt: number | null;
}

export interface OrganizationMfaStatus {
  readonly mfaRequired: boolean;
  readonly mfaVerifiedUntil: number | null;
  readonly twoFactorEnabled: boolean;
  readonly twoFactorVerified: boolean;
}

export async function getOrganizationMfaStatus(
  database: D1Database,
  input: {
    readonly organizationId: string;
    readonly sessionId: string;
    readonly userId: string;
  },
  now = new Date(),
): Promise<DomainResult<OrganizationMfaStatus>> {
  const row = await database
    .prepare(
      `SELECT o.mfa_required AS mfaRequired,
        u.twoFactorEnabled AS twoFactorEnabled,
        tf.verified AS twoFactorVerified,
        oma.expires_at AS assertionExpiresAt
       FROM member m
       JOIN organizations o ON o.id = m.organizationId
       JOIN user u ON u.id = m.userId
       LEFT JOIN twoFactor tf ON tf.userId = m.userId
       LEFT JOIN organization_mfa_assertions oma
         ON oma.organization_id = m.organizationId
         AND oma.user_id = m.userId
         AND oma.session_id = ?
       WHERE m.organizationId = ? AND m.userId = ?
       LIMIT 1`,
    )
    .bind(input.sessionId, input.organizationId, input.userId)
    .first<OrganizationMfaStatusRow>();
  if (!row) {
    return failure("forbidden", "An active Organization Membership is required.");
  }
  return success({
    mfaRequired: row.mfaRequired === 1,
    mfaVerifiedUntil:
      row.assertionExpiresAt && row.assertionExpiresAt > now.getTime()
        ? row.assertionExpiresAt
        : null,
    twoFactorEnabled: row.twoFactorEnabled === 1,
    twoFactorVerified: row.twoFactorVerified === 1,
  });
}

export async function recordOrganizationMfaAssertion(
  database: D1Database,
  input: {
    readonly method: OrganizationMfaMethod;
    readonly organizationId: string;
    readonly sessionId: string;
    readonly userId: string;
  },
  now = new Date(),
): Promise<DomainResult<{ readonly expiresAt: number }>> {
  const eligibility = await database
    .prepare(
      `SELECT o.mfa_required AS mfaRequired,
        u.twoFactorEnabled AS twoFactorEnabled,
        tf.verified AS twoFactorVerified
       FROM member m
       JOIN organizations o ON o.id = m.organizationId
       JOIN user u ON u.id = m.userId
       LEFT JOIN twoFactor tf ON tf.userId = m.userId
       WHERE m.organizationId = ? AND m.userId = ?
       LIMIT 1`,
    )
    .bind(input.organizationId, input.userId)
    .first<OrganizationMfaEligibilityRow>();
  if (!eligibility) {
    return failure("forbidden", "An active Organization Membership is required.");
  }
  if (eligibility.mfaRequired !== 1) {
    return failure("conflict", "This Organization does not currently require MFA.");
  }
  if (eligibility.twoFactorEnabled !== 1 || eligibility.twoFactorVerified !== 1) {
    return failure(
      "forbidden",
      "Complete two-factor enrollment before verifying Organization MFA.",
    );
  }

  const verifiedAt = now.getTime();
  const expiresAt = verifiedAt + ORGANIZATION_MFA_ASSERTION_SECONDS * 1000;
  await database
    .prepare(
      `INSERT INTO organization_mfa_assertions
        (session_id, organization_id, user_id, method, verified_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, organization_id) DO UPDATE SET
         user_id = excluded.user_id,
         method = excluded.method,
         verified_at = excluded.verified_at,
         expires_at = excluded.expires_at`,
    )
    .bind(input.sessionId, input.organizationId, input.userId, input.method, verifiedAt, expiresAt)
    .run();
  return success({ expiresAt });
}

export async function setOrganizationMfaPolicy(
  database: D1Database,
  input: {
    readonly actorUserId: string;
    readonly mfaRequired: boolean;
    readonly organizationId: string;
    readonly requestId: string;
  },
  now = new Date(),
): Promise<DomainResult<{ readonly mfaRequired: boolean }>> {
  const row = await database
    .prepare("SELECT mfa_required AS mfaRequired FROM organizations WHERE id = ? LIMIT 1")
    .bind(input.organizationId)
    .first<{ mfaRequired: number }>();
  if (!row) {
    return failure("not_found", "The Organization was not found.");
  }
  if ((row.mfaRequired === 1) === input.mfaRequired) {
    return success({ mfaRequired: input.mfaRequired });
  }

  const occurredAt = now.toISOString();
  await database.batch([
    database
      .prepare("UPDATE organizations SET mfa_required = ?, updated_at = ? WHERE id = ?")
      .bind(input.mfaRequired ? 1 : 0, occurredAt, input.organizationId),
    database
      .prepare("DELETE FROM organization_mfa_assertions WHERE organization_id = ?")
      .bind(input.organizationId),
    database
      .prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'organization.auth_policy.updated', 'organization', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.actorUserId,
        input.organizationId,
        input.organizationId,
        input.requestId,
        JSON.stringify({
          after: { mfaRequired: input.mfaRequired },
          before: { mfaRequired: row.mfaRequired === 1 },
        }),
        occurredAt,
      ),
  ]);
  return success({ mfaRequired: input.mfaRequired });
}
