import { failure, success, type DomainResult } from "@choir/domain";

export type PlatformMfaMethod = "passkey" | "recovery_code" | "totp";

interface PlatformAdministratorRow {
  readonly assertionExpiresAt: number | null;
  readonly assertionMethod: PlatformMfaMethod | null;
  readonly mfaEnrolledAt: string | null;
  readonly recoveryCodesConfirmedAt: string | null;
  readonly revokedAt: string | null;
  readonly twoFactorEnabled: number | null;
  readonly twoFactorVerified: number | null;
  readonly userId: string;
}

export interface PlatformAdministratorContext {
  readonly mfaMethod: PlatformMfaMethod;
  readonly mfaVerifiedUntil: number;
  readonly userId: string;
}

const PLATFORM_MFA_ASSERTION_SECONDS = 60 * 60;

async function findPlatformAdministrator(
  database: D1Database,
  userId: string,
  sessionId?: string,
): Promise<PlatformAdministratorRow | null> {
  return database
    .prepare(
      `SELECT
        pa.user_id AS userId,
        pa.revoked_at AS revokedAt,
        pa.mfa_enrolled_at AS mfaEnrolledAt,
        pa.recovery_codes_confirmed_at AS recoveryCodesConfirmedAt,
        u.twoFactorEnabled AS twoFactorEnabled,
        tf.verified AS twoFactorVerified,
        pma.method AS assertionMethod,
        pma.expires_at AS assertionExpiresAt
       FROM platform_administrators pa
       JOIN user u ON u.id = pa.user_id
       LEFT JOIN twoFactor tf ON tf.userId = pa.user_id
       LEFT JOIN platform_mfa_assertions pma
         ON pma.user_id = pa.user_id AND pma.session_id = ?
       WHERE pa.user_id = ?
       LIMIT 1`,
    )
    .bind(sessionId ?? "", userId)
    .first<PlatformAdministratorRow>();
}

function isEnrollmentComplete(row: PlatformAdministratorRow): boolean {
  return (
    row.revokedAt === null &&
    row.mfaEnrolledAt !== null &&
    row.recoveryCodesConfirmedAt !== null &&
    row.twoFactorEnabled === 1 &&
    row.twoFactorVerified === 1
  );
}

export interface PlatformAdministratorMfaStatus {
  readonly activePlatformAdministrator: boolean;
  readonly enrollmentComplete: boolean;
  readonly hasPasskey: boolean;
  readonly twoFactorEnabled: boolean;
}

export async function getPlatformAdministratorMfaStatus(
  database: D1Database,
  userId: string,
): Promise<PlatformAdministratorMfaStatus> {
  const [row, passkeyRow] = await Promise.all([
    findPlatformAdministrator(database, userId),
    database
      .prepare("SELECT COUNT(*) AS count FROM passkey WHERE userId = ?")
      .bind(userId)
      .first<{ count: number }>(),
  ]);
  const activePlatformAdministrator = row !== null && row.revokedAt === null;
  return {
    activePlatformAdministrator,
    enrollmentComplete: activePlatformAdministrator && isEnrollmentComplete(row),
    hasPasskey: (passkeyRow?.count ?? 0) > 0,
    twoFactorEnabled:
      activePlatformAdministrator && row.twoFactorEnabled === 1 && row.twoFactorVerified === 1,
  };
}

export async function confirmPlatformAdministratorMfaEnrollment(
  database: D1Database,
  userId: string | null,
  now = new Date(),
): Promise<DomainResult<{ readonly userId: string }>> {
  if (!userId) {
    return failure("unauthorized", "Sign in is required.");
  }
  const row = await findPlatformAdministrator(database, userId);
  if (row?.revokedAt !== null) {
    return failure("forbidden", "This identity is not an active Platform Administrator.");
  }
  if (row.twoFactorEnabled !== 1 || row.twoFactorVerified !== 1) {
    return failure("forbidden", "Complete TOTP enrollment before confirming recovery codes.");
  }

  const confirmedAt = now.toISOString();
  await database
    .prepare(
      `UPDATE platform_administrators
       SET mfa_enrolled_at = COALESCE(mfa_enrolled_at, ?),
           recovery_codes_confirmed_at = ?
       WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .bind(confirmedAt, confirmedAt, userId)
    .run();
  return success({ userId });
}

export async function recordPlatformMfaAssertion(
  database: D1Database,
  sessionId: string,
  userId: string,
  method: PlatformMfaMethod,
  now = new Date(),
): Promise<DomainResult<PlatformAdministratorContext>> {
  const administrator = await findPlatformAdministrator(database, userId);
  if (!administrator || !isEnrollmentComplete(administrator)) {
    return failure("forbidden", "Platform Administrator MFA enrollment is incomplete or revoked.");
  }

  const verifiedAt = now.getTime();
  const expiresAt = verifiedAt + PLATFORM_MFA_ASSERTION_SECONDS * 1000;
  await database
    .prepare(
      `INSERT INTO platform_mfa_assertions
        (session_id, user_id, method, verified_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         user_id = excluded.user_id,
         method = excluded.method,
         verified_at = excluded.verified_at,
         expires_at = excluded.expires_at`,
    )
    .bind(sessionId, userId, method, verifiedAt, expiresAt)
    .run();

  return success({
    mfaMethod: method,
    mfaVerifiedUntil: expiresAt,
    userId,
  });
}

export async function authorizePlatformAdministratorSession(
  database: D1Database,
  sessionId: string | null,
  userId: string | null,
  now = new Date(),
): Promise<DomainResult<PlatformAdministratorContext>> {
  if (!sessionId || !userId) {
    return failure("unauthorized", "Sign in is required.");
  }
  const administrator = await findPlatformAdministrator(database, userId, sessionId);
  if (administrator?.revokedAt !== null) {
    return failure("forbidden", "This identity is not an active Platform Administrator.");
  }
  if (!isEnrollmentComplete(administrator)) {
    return failure("forbidden", "Platform Administrator MFA enrollment is incomplete.");
  }
  if (
    !administrator.assertionMethod ||
    !administrator.assertionExpiresAt ||
    administrator.assertionExpiresAt <= now.getTime()
  ) {
    return failure("unauthorized", "A recent Platform Administrator MFA verification is required.");
  }

  return success({
    mfaMethod: administrator.assertionMethod,
    mfaVerifiedUntil: administrator.assertionExpiresAt,
    userId,
  });
}
