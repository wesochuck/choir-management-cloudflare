import { failure, success, type DomainResult } from "@choir/domain";

type OrganizationRole = "administrator" | "member" | "owner";

export const MEMBER_ACTIVITY_TOUCH_INTERVAL_MS = 15 * 60 * 1_000;

interface BetterAuthMemberRow {
  readonly assertionExpiresAt: number | null;
  readonly lastActiveAt: number | null;
  readonly mfaRequired: number;
  readonly organizationId: string;
  readonly profileId: string | null;
  readonly role: string;
  readonly sessionAssuranceMethod: string | null;
  readonly userId: string;
  readonly websiteEditor: number;
}

export interface OrganizationAuthorizationContext {
  readonly active: boolean;
  readonly mfaRequired: boolean;
  readonly organizationId: string;
  readonly profileLinked: boolean;
  readonly role: OrganizationRole;
  readonly userId: string;
  readonly websiteEditor?: boolean;
  readonly websiteOnly?: boolean;
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

function scopedMemberRole(
  row: BetterAuthMemberRow,
  scope: "shell" | "website" | undefined,
): DomainResult<Pick<OrganizationAuthorizationContext, "role" | "websiteEditor" | "websiteOnly">> {
  if (row.role === "website_editor" && scope) {
    return success({ role: "member", websiteEditor: true, websiteOnly: true });
  }
  const role = normalizeBetterAuthRole(row.role);
  if (!role)
    return failure(
      "forbidden",
      "This identity is not an active member of the requested Organization.",
    );
  if (row.websiteEditor === 1) return success({ role, websiteEditor: true });
  if (scope === "website" && role === "member") {
    return failure("forbidden", "Website Editor access is required.");
  }
  return success({ role });
}

export interface OrganizationAuthDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

async function touchMemberLastActiveIfStale(
  database: OrganizationAuthDatabase,
  row: Pick<BetterAuthMemberRow, "lastActiveAt" | "organizationId" | "userId">,
  nowTime: number,
  options: {
    readonly mfaRequired: boolean;
    readonly mfaSatisfied: boolean;
    readonly recordActivity: boolean | undefined;
  },
): Promise<void> {
  if (options.recordActivity === false) return;
  if (options.mfaRequired && !options.mfaSatisfied) return;
  if (row.lastActiveAt !== null && nowTime - row.lastActiveAt < MEMBER_ACTIVITY_TOUCH_INTERVAL_MS) {
    return;
  }
  await database
    .prepare(
      `UPDATE member
       SET lastActiveAt = ?
       WHERE organizationId = ? AND userId = ?
         AND (lastActiveAt IS NULL OR lastActiveAt < ?)`,
    )
    .bind(nowTime, row.organizationId, row.userId, nowTime - MEMBER_ACTIVITY_TOUCH_INTERVAL_MS + 1)
    .run();
}

export async function authorizeOrganizationMember(
  database: OrganizationAuthDatabase,
  resolvedOrganizationId: string,
  sessionId: string | null | undefined,
  userId: string | null | undefined,
  options: {
    readonly enforceMfa?: boolean;
    readonly now?: Date;
    readonly recordActivity?: boolean;
    readonly scope?: "shell" | "website";
  } = {},
): Promise<DomainResult<OrganizationAuthorizationContext>> {
  if (!sessionId || !userId) {
    return failure("unauthorized", "Sign in is required.");
  }

  const row = await database
    .prepare(
      `SELECT m.lastActiveAt, m.organizationId, m.profileId, m.role, m.userId, m.websiteEditor,
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
  if (!row) {
    return failure(
      "forbidden",
      "This identity is not an active member of the requested Organization.",
    );
  }
  const scopedRole = scopedMemberRole(row, options.scope);
  if (!scopedRole.ok) return scopedRole;
  const mfaRequired = row.mfaRequired === 1;
  const nowTime = (options.now ?? new Date()).getTime();
  const mfaSatisfied =
    row.sessionAssuranceMethod === "passkey" ||
    (row.assertionExpiresAt !== null && row.assertionExpiresAt > nowTime);
  if (options.enforceMfa !== false && mfaRequired && !mfaSatisfied) {
    return failure("unauthorized", "A recent Organization MFA verification is required.");
  }

  const result = authorizeOrganization(resolvedOrganizationId, {
    active: true,
    mfaRequired,
    organizationId: row.organizationId,
    profileLinked: Boolean(row.profileId),
    userId: row.userId,
    ...scopedRole.value,
  });

  if (result.ok) {
    await touchMemberLastActiveIfStale(database, row, nowTime, {
      mfaRequired,
      mfaSatisfied,
      recordActivity: options.recordActivity,
    });
  }

  return result;
}
