import type { OrganizationInvitationRole } from "@choir/contracts";
import { evaluateMemberRoleChange, failure, success, type DomainResult } from "@choir/domain";

import type { Env } from "../env";

interface MemberRow {
  readonly id: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
}

export interface UpdateOrganizationMemberRoleInput {
  readonly actorRole: OrganizationInvitationRole;
  readonly actorUserId: string;
  readonly expectedRole: OrganizationInvitationRole;
  readonly membershipId: string;
  readonly newRole: OrganizationInvitationRole;
  readonly organizationId: string;
  readonly requestId: string;
}

export interface UpdateOrganizationMemberRoleOutput {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly previousRole: OrganizationInvitationRole;
  readonly role: OrganizationInvitationRole;
}

function normalizeDbRole(dbRole: "admin" | "member" | "owner"): OrganizationInvitationRole {
  return dbRole === "admin" ? "administrator" : dbRole;
}

function toDbRole(appRole: OrganizationInvitationRole): "admin" | "member" | "owner" {
  return appRole === "administrator" ? "admin" : appRole;
}

function buildUpdateStatement(
  env: Env,
  input: UpdateOrganizationMemberRoleInput,
  currentRole: OrganizationInvitationRole,
  expectedDbRole: "admin" | "member" | "owner",
): D1PreparedStatement {
  const newDbRole = toDbRole(input.newRole);
  if (currentRole === "owner" && input.newRole !== "owner") {
    return env.CONTROL_DB.prepare(
      `UPDATE member
       SET role = ?
       WHERE id = ?
         AND organizationId = ?
         AND role = 'owner'
         AND (
           SELECT role
           FROM member
           WHERE organizationId = ?
             AND userId = ?
         ) = 'owner'
         AND (
           SELECT COUNT(*)
           FROM member
           WHERE organizationId = ?
             AND role = 'owner'
         ) > 1`,
    ).bind(
      newDbRole,
      input.membershipId,
      input.organizationId,
      input.organizationId,
      input.actorUserId,
      input.organizationId,
    );
  }

  const allowedActorRoles = input.actorRole === "owner" ? ["owner"] : ["admin", "owner"];
  const actorRoleClause = allowedActorRoles.length === 1 ? "= 'owner'" : "IN ('admin', 'owner')";
  return env.CONTROL_DB.prepare(
    `UPDATE member
     SET role = ?
     WHERE id = ?
       AND organizationId = ?
       AND role = ?
       AND (
         SELECT role
         FROM member
         WHERE organizationId = ?
           AND userId = ?
       ) ${actorRoleClause}`,
  ).bind(
    newDbRole,
    input.membershipId,
    input.organizationId,
    expectedDbRole,
    input.organizationId,
    input.actorUserId,
  );
}

async function diagnoseUpdateFailure(
  env: Env,
  input: UpdateOrganizationMemberRoleInput,
  currentRole: OrganizationInvitationRole,
): Promise<DomainResult<never>> {
  const freshActor = await env.CONTROL_DB.prepare(
    `SELECT role FROM member WHERE organizationId = ? AND userId = ? LIMIT 1`,
  )
    .bind(input.organizationId, input.actorUserId)
    .first<{ role: string }>();

  const actorLostPerm =
    !freshActor ||
    (input.actorRole === "owner" && freshActor.role !== "owner") ||
    (input.actorRole === "administrator" &&
      freshActor.role !== "admin" &&
      freshActor.role !== "owner");

  if (actorLostPerm) {
    return failure("forbidden", "You no longer have permission to change Membership roles.");
  }

  if (currentRole === "owner" && input.newRole !== "owner") {
    const freshOwners = await env.CONTROL_DB.prepare(
      `SELECT COUNT(*) AS count FROM member WHERE organizationId = ? AND role = 'owner'`,
    )
      .bind(input.organizationId)
      .first<{ count: number }>();
    if ((freshOwners?.count ?? 0) <= 1) {
      return failure("conflict", "An Organization must have at least one Owner.");
    }
  }

  return failure(
    "conflict",
    "The Organization Membership role has changed. Please refresh and try again.",
  );
}

export async function updateOrganizationMemberRole(
  env: Env,
  input: UpdateOrganizationMemberRoleInput,
  now = new Date(),
): Promise<DomainResult<UpdateOrganizationMemberRoleOutput>> {
  const target = await env.CONTROL_DB.prepare(
    `SELECT id, userId, role FROM member
     WHERE id = ? AND organizationId = ?
     LIMIT 1`,
  )
    .bind(input.membershipId, input.organizationId)
    .first<MemberRow>();

  if (!target) {
    return failure("not_found", "The Organization Membership was not found.");
  }

  const currentRole = normalizeDbRole(target.role);

  if (currentRole !== input.expectedRole) {
    return failure(
      "conflict",
      "The Organization Membership role has changed. Please refresh and try again.",
    );
  }

  const ownersCountResult = await env.CONTROL_DB.prepare(
    `SELECT COUNT(*) AS count FROM member WHERE organizationId = ? AND role = 'owner'`,
  )
    .bind(input.organizationId)
    .first<{ count: number }>();
  const totalOwnersCount = ownersCountResult?.count ?? 0;

  const decision = evaluateMemberRoleChange({
    actorRole: input.actorRole,
    currentTargetRole: currentRole,
    isSelf: target.userId === input.actorUserId,
    newTargetRole: input.newRole,
    totalOwnersCount,
  });

  if (!decision.allowed) {
    return failure(decision.code, decision.message);
  }

  if (input.newRole === currentRole) {
    return success({
      membershipId: input.membershipId,
      organizationId: input.organizationId,
      previousRole: currentRole,
      role: input.newRole,
    });
  }

  const occurredAt = now.toISOString();
  const updateStmt = buildUpdateStatement(env, input, currentRole, target.role);
  const auditStmt = env.CONTROL_DB.prepare(
    `INSERT INTO platform_audit_events
      (id, actor_user_id, organization_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     SELECT
       ?, ?, ?, 'organization.membership.role_updated', 'organization_membership', ?,
       ?, ?, ?
     WHERE changes() > 0`,
  ).bind(
    crypto.randomUUID(),
    input.actorUserId,
    input.organizationId,
    input.membershipId,
    input.requestId,
    JSON.stringify({
      after: { role: input.newRole },
      before: { role: currentRole },
      targetUserId: target.userId,
    }),
    occurredAt,
  );

  try {
    const results = await env.CONTROL_DB.batch([updateStmt, auditStmt]);
    const updateResult = results[0];
    if (!updateResult || updateResult.meta.changes === 0) {
      return await diagnoseUpdateFailure(env, input, currentRole);
    }
  } catch {
    return failure("conflict", "The Organization Membership role could not be updated.");
  }

  return success({
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    previousRole: currentRole,
    role: input.newRole,
  });
}
