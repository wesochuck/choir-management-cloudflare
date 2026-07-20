import { failure, success, type DomainResult } from "@choir/domain";

export type OrganizationRole = "administrator" | "member" | "owner";

interface BetterAuthMemberRow {
  readonly organizationId: string;
  readonly role: string;
  readonly userId: string;
}

export interface OrganizationAuthorizationContext {
  readonly active: boolean;
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
  userId: string | null,
): Promise<DomainResult<OrganizationAuthorizationContext>> {
  if (!userId) {
    return failure("unauthorized", "Sign in is required.");
  }

  const row = await database
    .prepare(
      `SELECT organizationId, role, userId
       FROM member
       WHERE organizationId = ? AND userId = ?
       LIMIT 1`,
    )
    .bind(resolvedOrganizationId, userId)
    .first<BetterAuthMemberRow>();
  const role = row ? normalizeBetterAuthRole(row.role) : null;
  if (!row || !role) {
    return failure(
      "forbidden",
      "This identity is not an active member of the requested Organization.",
    );
  }

  return authorizeOrganization(resolvedOrganizationId, {
    active: true,
    organizationId: row.organizationId,
    role,
    userId: row.userId,
  });
}
