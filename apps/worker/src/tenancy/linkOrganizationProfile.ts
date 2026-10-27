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

// eslint-disable-next-line complexity -- guards manual and automatic Membership-to-Profile linking
export async function linkOrganizationProfile(
  env: Env,
  input: OrganizationProfileLink & {
    readonly actorUserId: string;
    readonly requireUnlinked?: boolean;
    readonly requestId: string;
    readonly source?: "manual" | "organization_invitation" | "roster_invite";
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
  if (input.requireUnlinked && membership.profileId !== null) {
    return failure(
      "conflict",
      "This Membership is already linked to another Organization Profile.",
    );
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

  const activeReconciliation = await env.CONTROL_DB.prepare(
    `SELECT id FROM organization_profile_reconciliations
     WHERE organization_id = ? AND (membership_id = ? OR source_profile_id = ? OR target_profile_id = ?)
       AND state IN ('reserved', 'prepared', 'relinked', 'needs_repair')
     LIMIT 1`,
  )
    .bind(input.organizationId, input.membershipId, input.profileId, input.profileId)
    .first<{ id: string }>();

  if (activeReconciliation) {
    return failure(
      "conflict",
      "This Profile or Membership is currently involved in an active profile reconciliation.",
    );
  }

  const stub = organizationStoreStub(env, input.organizationId);
  const canonicalProfileId = await stub.resolveCanonicalProfileId(input.profileId);
  if (canonicalProfileId !== input.profileId) {
    return failure("conflict", "This Profile has been retired into an alias.");
  }

  const occurredAt = now.toISOString();
  const source = input.source ?? "manual";
  const automaticLinkGuard =
    source === "manual"
      ? ""
      : `
         AND NOT EXISTS (
           SELECT 1 FROM member other
           WHERE other.organizationId = ? AND other.profileId = ? AND other.id <> ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM organization_profile_reconciliations reconciliation
           WHERE reconciliation.organization_id = ?
             AND (reconciliation.membership_id = ? OR reconciliation.source_profile_id = ?
               OR reconciliation.target_profile_id = ?)
             AND reconciliation.state IN ('reserved', 'prepared', 'relinked', 'needs_repair')
         )`;
  try {
    const results = await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        `UPDATE member SET profileId = ?
         WHERE id = ? AND organizationId = ? ${input.requireUnlinked ? "AND profileId IS NULL" : ""}${automaticLinkGuard}`,
      ).bind(
        input.profileId,
        input.membershipId,
        input.organizationId,
        ...(source === "manual"
          ? []
          : [
              input.organizationId,
              input.profileId,
              input.membershipId,
              input.organizationId,
              input.membershipId,
              input.profileId,
              input.profileId,
            ]),
      ),
      env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         SELECT ?, ?, ?, ?,
           'organization_membership', ?, ?, ?, ?
         WHERE changes() = 1`,
      ).bind(
        crypto.randomUUID(),
        input.actorUserId,
        input.organizationId,
        source === "manual"
          ? "organization.membership.profile_linked"
          : "organization.membership.profile_auto_linked",
        input.membershipId,
        input.requestId,
        JSON.stringify({
          after: { profileId: input.profileId },
          before: { profileId: membership.profileId },
          method: source,
        }),
        occurredAt,
      ),
    ]);
    if (input.requireUnlinked && results[0]?.meta.changes !== 1) {
      return failure(
        "conflict",
        "This Membership is already linked to another Organization Profile.",
      );
    }
  } catch {
    if (source !== "manual") throw new Error("Automatic Organization Profile linking failed.");
    return failure("conflict", "The Organization Profile could not be linked.");
  }

  return success({
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    profileId: input.profileId,
  });
}
