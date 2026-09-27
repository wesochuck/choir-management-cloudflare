import type { OrganizationInvitationRole } from "@choir/contracts";

export interface CanChangeMemberRoleParams {
  readonly actorRole: OrganizationInvitationRole;
  readonly currentTargetRole: OrganizationInvitationRole;
  readonly isSelf: boolean;
  readonly newTargetRole: OrganizationInvitationRole;
  readonly totalOwnersCount?: number;
}

export type RoleChangeFailureReason =
  | "member_not_permitted"
  | "admin_cannot_change_self"
  | "admin_cannot_modify_owner"
  | "admin_cannot_grant_owner"
  | "last_owner";

export type RoleChangeDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: "forbidden" | "conflict";
      readonly message: string;
      readonly reason: RoleChangeFailureReason;
    };

export function evaluateMemberRoleChange(params: CanChangeMemberRoleParams): RoleChangeDecision {
  const { actorRole, currentTargetRole, isSelf, newTargetRole, totalOwnersCount } = params;

  if (actorRole === "member") {
    return {
      allowed: false,
      code: "forbidden",
      message: "Only Organization Owners and Administrators may change Membership roles.",
      reason: "member_not_permitted",
    };
  }

  if (actorRole === "administrator") {
    if (isSelf) {
      return {
        allowed: false,
        code: "forbidden",
        message: "Organization Administrators cannot change their own role.",
        reason: "admin_cannot_change_self",
      };
    }
    if (currentTargetRole === "owner") {
      return {
        allowed: false,
        code: "forbidden",
        message: "Organization Administrators cannot modify an Owner's role.",
        reason: "admin_cannot_modify_owner",
      };
    }
    if (newTargetRole === "owner") {
      return {
        allowed: false,
        code: "forbidden",
        message: "Organization Administrators cannot grant Owner access.",
        reason: "admin_cannot_grant_owner",
      };
    }
  }

  if (actorRole === "owner") {
    if (currentTargetRole === "owner" && newTargetRole !== "owner") {
      if (totalOwnersCount !== undefined && totalOwnersCount <= 1) {
        return {
          allowed: false,
          code: "conflict",
          message: "An Organization must have at least one Owner.",
          reason: "last_owner",
        };
      }
    }
  }

  return { allowed: true };
}

export function allowedRoleOptionsForActor(
  actorRole: OrganizationInvitationRole,
  currentTargetRole: OrganizationInvitationRole,
  isSelf: boolean,
): readonly OrganizationInvitationRole[] {
  if (actorRole === "member") {
    return [];
  }
  if (actorRole === "administrator") {
    if (isSelf || currentTargetRole === "owner") {
      return [];
    }
    return ["member", "administrator"];
  }
  return ["member", "administrator", "owner"];
}
