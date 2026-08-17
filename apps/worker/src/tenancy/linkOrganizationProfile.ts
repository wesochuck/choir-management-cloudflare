import { failure, success, type DomainResult } from "@choir/domain";

import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";

interface MembershipProfileRow {
  readonly profileId: string | null;
}

export interface OrganizationProfileLink {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly profileId: string;
}

export async function linkOrganizationProfile(
  env: Env,
  input: OrganizationProfileLink & {
    readonly actorUserId: string;
    readonly requestId: string;
  },
  now = new Date(),
): Promise<DomainResult<OrganizationProfileLink>> {
  const profileResponse = await invokeOrganizationRpc(
    organizationStoreStub(env, input.organizationId),
    `https://organization.internal/internal/profiles/${encodeURIComponent(input.profileId)}`,
  );
  if (profileResponse.status === 404) {
    return failure("not_found", "The Organization Profile was not found in this Organization.");
  }
  if (!profileResponse.ok) {
    throw new Error("Organization Profile verification failed.");
  }

  const membership = await env.CONTROL_DB.prepare(
    `SELECT profileId FROM member
     WHERE id = ? AND organizationId = ?
     LIMIT 1`,
  )
    .bind(input.membershipId, input.organizationId)
    .first<MembershipProfileRow>();
  if (!membership) {
    return failure("not_found", "The Organization Membership was not found.");
  }
  if (membership.profileId === input.profileId) {
    return success({
      membershipId: input.membershipId,
      organizationId: input.organizationId,
      profileId: input.profileId,
    });
  }
  const conflictingMembership = await env.CONTROL_DB.prepare(
    `SELECT id FROM member
     WHERE organizationId = ? AND profileId = ? AND id <> ?
     LIMIT 1`,
  )
    .bind(input.organizationId, input.profileId, input.membershipId)
    .first<{ id: string }>();
  if (conflictingMembership) {
    return failure("conflict", "This Organization Profile is already linked to a Membership.");
  }

  const occurredAt = now.toISOString();
  try {
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        `UPDATE member SET profileId = ?
         WHERE id = ? AND organizationId = ?`,
      ).bind(input.profileId, input.membershipId, input.organizationId),
      env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'organization.membership.profile_linked',
           'organization_membership', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.actorUserId,
        input.organizationId,
        input.membershipId,
        input.requestId,
        JSON.stringify({
          after: { profileId: input.profileId },
          before: { profileId: membership.profileId },
        }),
        occurredAt,
      ),
    ]);
  } catch {
    return failure("conflict", "The Organization Profile could not be linked.");
  }

  return success({
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    profileId: input.profileId,
  });
}
