import { failure, success, type DomainResult } from "@choir/domain";

export type OrganizationRole = "administrator" | "member" | "owner";

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
