import { failure, success, type DomainResult } from "@choir/domain";

type OrganizationRole = "administrator" | "member" | "owner";

interface BetterAuthMemberRow {
  readonly assertionExpiresAt: number | null;
  readonly mfaRequired: number;
  readonly organizationId: string;
  readonly role: string;
  readonly sessionAssuranceMethod: string | null;
  readonly userId: string;
}

export interface OrganizationAuthorizationContext {
  readonly active: boolean;
  readonly mfaRequired: boolean;
  readonly organizationId: string;
  readonly role: OrganizationRole;
  readonly userId: string;
}

export function authorizeOrganization(
  resolvedOrganizationId: string,
  membership: OrganizationAuthorizationContext | null,
): DomainResult<OrganizationAuthorizationContext> {
  if (!membership) {
    return failure("unauthorized", "Sign in is required.");
  }
  if (!membership.active || membership.organizationId !== resolvedOrganizationId) {
    return failure("forbidden", "This Organization Membership cannot access the requested host.");
  }
  return success(membership);
}

function normalizeBetterAuthRole(role: string): OrganizationRole | null {
  switch (role) {
    case "admin":
      return "administrator";
    case "member":
    case "owner":
      return role;
    default:
      return null;
  }
}

export async function authorizeOrganizationMember(
  database: D1Database,
  resolvedOrganizationId: string,
  sessionId: string | null | undefined,
  userId: string | null | undefined,
  options: { readonly enforceMfa?: boolean; readonly now?: Date } = {},
): Promise<DomainResult<OrganizationAuthorizationContext>> {
  if (!sessionId || !userId) {
    return failure("unauthorized", "Sign in is required.");
  }

  const row = await database
    .prepare(
      `SELECT m.organizationId, m.role, m.userId,
        o.mfa_required AS mfaRequired,
        oma.expires_at AS assertionExpiresAt,
        saa.method AS sessionAssuranceMethod
       FROM member m
       JOIN organizations o ON o.id = m.organizationId
       LEFT JOIN organization_mfa_assertions oma
         ON oma.organization_id = m.organizationId
         AND oma.user_id = m.userId
         AND oma.session_id = ?
       LEFT JOIN session_auth_assurance saa
         ON saa.session_id = ?
         AND saa.user_id = m.userId
       WHERE m.organizationId = ? AND m.userId = ?
       LIMIT 1`,
    )
    .bind(sessionId, sessionId, resolvedOrganizationId, userId)
    .first<BetterAuthMemberRow>();
  const role = row ? normalizeBetterAuthRole(row.role) : null;
  if (!row || !role) {
    return failure(
      "forbidden",
      "This identity is not an active member of the requested Organization.",
    );
  }
  const mfaRequired = row.mfaRequired === 1;
  const nowTime = (options.now ?? new Date()).getTime();
  const mfaSatisfied =
    row.sessionAssuranceMethod === "passkey" ||
    (row.assertionExpiresAt !== null && row.assertionExpiresAt > nowTime);
  if (options.enforceMfa !== false && mfaRequired && !mfaSatisfied) {
    return failure("unauthorized", "A recent Organization MFA verification is required.");
  }

  return authorizeOrganization(resolvedOrganizationId, {
    active: true,
    mfaRequired,
    organizationId: row.organizationId,
    role,
    userId: row.userId,
  });
}
