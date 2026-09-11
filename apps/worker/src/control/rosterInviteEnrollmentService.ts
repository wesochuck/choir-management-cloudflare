import type {
  CreateRosterInviteLinkRequest,
  RosterInviteLinkStatus,
  RosterInviteLinkSummary,
} from "@choir/contracts";

import type { Env } from "../env";
import { organizationStoreStub } from "../organization/rpc/client";
import {
  issueSignedLink,
  verifySignedLinkScope,
  type SignedLinkEnvelope,
} from "../security/signedLinks";
import { linkOrganizationProfile } from "../tenancy/linkOrganizationProfile";

export interface RosterInviteLinkRow {
  readonly [column: string]: unknown;
  readonly active_reservations: number;
  readonly committed_uses: number;
  readonly created_at: number;
  readonly created_by_user_id: string;
  readonly expires_at: number;
  readonly id: string;
  readonly label: string;
  readonly max_uses: number | null;
  readonly nonce: string;
  readonly organization_id: string;
  readonly revocation_version: number;
  readonly revoked_at: number | null;
  readonly revoked_by_user_id: string | null;
}

export interface RosterInviteEnrollmentRow {
  readonly [column: string]: unknown;
  readonly created_at: number;
  readonly fencing_version: number;
  readonly id: string;
  readonly idempotency_key: string;
  readonly last_error_code: string | null;
  readonly link_id: string;
  readonly membership_id: string | null;
  readonly organization_id: string;
  readonly preexisting_membership: number;
  readonly profile_id: string;
  readonly request_digest: string;
  readonly reservation_lease_expires_at: number;
  readonly retry_count: number;
  readonly state: "reserved" | "prepared" | "admitted" | "completed" | "canceled" | "needs_repair";
  readonly updated_at: number;
  readonly user_id: string;
}

export function computeRosterInviteLinkStatus(
  link: Pick<RosterInviteLinkRow, "expires_at" | "revoked_at" | "max_uses" | "committed_uses">,
  now = Date.now(),
): RosterInviteLinkStatus {
  if (link.revoked_at !== null) {
    return "revoked";
  }
  if (link.expires_at <= now) {
    return "expired";
  }
  if (link.max_uses !== null && link.committed_uses >= link.max_uses) {
    return "exhausted";
  }
  return "active";
}

export function formatRosterInviteLinkSummary(
  row: RosterInviteLinkRow,
  now = Date.now(),
): RosterInviteLinkSummary {
  return {
    activeReservations: row.active_reservations,
    committedUses: row.committed_uses,
    createdAt: new Date(row.created_at).toISOString(),
    createdByUserId: row.created_by_user_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    id: row.id,
    label: row.label,
    maxUses: row.max_uses,
    organizationId: row.organization_id,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    status: computeRosterInviteLinkStatus(row, now),
  };
}

export async function createRosterInviteLink(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly canonicalHost: string;
    readonly organizationId: string;
    readonly request: CreateRosterInviteLinkRequest;
  },
  now = Date.now(),
): Promise<{ readonly expiresAt: string; readonly id: string; readonly shareUrl: string }> {
  const linkId = crypto.randomUUID();
  const nonce = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresInDays = input.request.expiresInDays;
  const expiresAt = now + expiresInDays * 86_400_000;
  const maxUses = input.request.maxUses ?? null;

  await env.CONTROL_DB.prepare(
    `INSERT INTO organization_roster_invite_links
      (id, organization_id, label, created_by_user_id, created_at, expires_at,
       nonce, revocation_version, max_uses, committed_uses, active_reservations)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0)`,
  )
    .bind(
      linkId,
      input.organizationId,
      input.request.label,
      input.actorUserId,
      now,
      expiresAt,
      nonce,
      maxUses,
    )
    .run();

  const envelope: SignedLinkEnvelope = {
    algorithm: "HS256",
    expiresAt: Math.floor(expiresAt / 1000),
    issuedAt: Math.floor(now / 1000),
    nonce,
    organizationId: input.organizationId,
    purpose: "roster_invite",
    resourceId: linkId,
    revocation: "1",
    version: 1,
  };

  const token = await issueSignedLink(env.SIGNED_LINK_SECRET, envelope);
  const protocol = input.canonicalHost.includes("localhost") ? "http" : "https";
  const shareUrl = `${protocol}://${input.canonicalHost}/join-roster#token=${token}`;

  return {
    expiresAt: new Date(expiresAt).toISOString(),
    id: linkId,
    shareUrl,
  };
}

export async function listRosterInviteLinks(
  database: D1Database,
  organizationId: string,
): Promise<readonly RosterInviteLinkSummary[]> {
  const rows = await database
    .prepare(
      `SELECT * FROM organization_roster_invite_links
       WHERE organization_id = ?
       ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(organizationId)
    .all<RosterInviteLinkRow>();

  const now = Date.now();
  return rows.results.map((row) => formatRosterInviteLinkSummary(row, now));
}

export async function generateRosterInviteShareUrl(
  env: Env,
  input: {
    readonly canonicalHost: string;
    readonly linkId: string;
    readonly organizationId: string;
  },
): Promise<{ readonly expiresAt: string; readonly id: string; readonly shareUrl: string } | null> {
  const row = await env.CONTROL_DB.prepare(
    `SELECT * FROM organization_roster_invite_links
     WHERE id = ? AND organization_id = ? LIMIT 1`,
  )
    .bind(input.linkId, input.organizationId)
    .first<RosterInviteLinkRow>();

  if (!row) {
    return null;
  }

  const envelope: SignedLinkEnvelope = {
    algorithm: "HS256",
    expiresAt: Math.floor(row.expires_at / 1000),
    issuedAt: Math.floor(row.created_at / 1000),
    nonce: row.nonce,
    organizationId: row.organization_id,
    purpose: "roster_invite",
    resourceId: row.id,
    revocation: String(row.revocation_version),
    version: 1,
  };

  const token = await issueSignedLink(env.SIGNED_LINK_SECRET, envelope);
  const protocol = input.canonicalHost.includes("localhost") ? "http" : "https";
  const shareUrl = `${protocol}://${input.canonicalHost}/join-roster#token=${token}`;

  return {
    expiresAt: new Date(row.expires_at).toISOString(),
    id: row.id,
    shareUrl,
  };
}

export async function revokeRosterInviteLink(
  database: D1Database,
  input: {
    readonly actorUserId: string;
    readonly linkId: string;
    readonly organizationId: string;
  },
  now = Date.now(),
): Promise<string | null> {
  const result = await database
    .prepare(
      `UPDATE organization_roster_invite_links
       SET revoked_at = ?, revoked_by_user_id = ?, revocation_version = revocation_version + 1
       WHERE id = ? AND organization_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, input.actorUserId, input.linkId, input.organizationId)
    .run();

  if (result.meta.changes === 0) {
    // Check if already revoked
    const existing = await database
      .prepare(
        `SELECT revoked_at FROM organization_roster_invite_links
         WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(input.linkId, input.organizationId)
      .first<{ revoked_at: number | null }>();
    return existing?.revoked_at ? new Date(existing.revoked_at).toISOString() : null;
  }

  return new Date(now).toISOString();
}

export interface ValidatedRosterInvite {
  readonly envelope: SignedLinkEnvelope;
  readonly link: RosterInviteLinkRow;
}

export async function validateRosterInviteToken(
  env: Env,
  token: string,
  expectedOrganizationId: string,
  now = new Date(),
): Promise<
  | { readonly ok: true; readonly value: ValidatedRosterInvite }
  | { readonly code: string; readonly message: string; readonly ok: false }
> {
  const verified = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId,
    expectedPurpose: "roster_invite",
    now,
  });

  if (!verified?.resourceId) {
    return {
      code: "invalid_invite_token",
      message: "The roster invite link is invalid or expired.",
      ok: false,
    };
  }

  const link = await env.CONTROL_DB.prepare(
    `SELECT * FROM organization_roster_invite_links
     WHERE id = ? AND organization_id = ? LIMIT 1`,
  )
    .bind(verified.resourceId, expectedOrganizationId)
    .first<RosterInviteLinkRow>();

  if (!link) {
    return {
      code: "invite_not_found",
      message: "The roster invite was not found.",
      ok: false,
    };
  }

  if (link.revoked_at !== null) {
    return {
      code: "invite_revoked",
      message: "This roster invite link has been revoked by an administrator.",
      ok: false,
    };
  }

  if (link.expires_at <= now.getTime()) {
    return {
      code: "invite_expired",
      message: "This roster invite link has expired.",
      ok: false,
    };
  }

  if (String(link.revocation_version) !== verified.revocation) {
    return {
      code: "invite_revoked",
      message: "This roster invite link is no longer valid.",
      ok: false,
    };
  }

  return {
    ok: true,
    value: { envelope: verified, link },
  };
}

export interface RedeemRosterInviteInput {
  readonly actorUserId: string;
  readonly displayName: string;
  readonly idempotencyKey: string;
  readonly organizationId: string;
  readonly phone?: string;
  readonly requestId: string;
  readonly showInDirectory: boolean;
  readonly token: string;
  readonly voicePart: string;
}

export interface RedeemRosterInviteResult {
  readonly enrollmentId: string;
  readonly membershipId: string;
  readonly profileId: string;
  readonly status: "completed" | "already_enrolled" | "pending";
}

// eslint-disable-next-line complexity -- cross-store two-phase admission orchestration
export async function redeemRosterInvite(
  env: Env,
  input: RedeemRosterInviteInput,
  now = Date.now(),
): Promise<
  | { readonly ok: true; readonly value: RedeemRosterInviteResult }
  | {
      readonly code: string;
      readonly message: string;
      readonly ok: false;
      readonly status: 202 | 400 | 404 | 409 | 500;
    }
> {
  const validated = await validateRosterInviteToken(
    env,
    input.token,
    input.organizationId,
    new Date(now),
  );
  if (!validated.ok) {
    return { code: validated.code, message: validated.message, ok: false, status: 400 };
  }

  const { link } = validated.value;

  // Step A: Check if user already has an active Membership with linked profile in this Organization
  const existingMembership = await env.CONTROL_DB.prepare(
    `SELECT id, role, profileId FROM member
     WHERE organizationId = ? AND userId = ?
     LIMIT 1`,
  )
    .bind(input.organizationId, input.actorUserId)
    .first<{ id: string; profileId: string | null; role: string }>();

  if (existingMembership?.profileId) {
    const existingEnrollment = await env.CONTROL_DB.prepare(
      `SELECT id FROM organization_roster_invite_enrollments
       WHERE organization_id = ? AND user_id = ?
       LIMIT 1`,
    )
      .bind(input.organizationId, input.actorUserId)
      .first<{ id: string }>();

    return {
      ok: true,
      value: {
        enrollmentId: existingEnrollment?.id ?? `existing-${existingMembership.id}`,
        membershipId: existingMembership.id,
        profileId: existingMembership.profileId,
        status: "already_enrolled",
      },
    };
  }

  // Check existing enrollment for this (organization, user) or (organization, idempotencyKey)
  let enrollment = await env.CONTROL_DB.prepare(
    `SELECT * FROM organization_roster_invite_enrollments
     WHERE organization_id = ? AND (user_id = ? OR idempotency_key = ?)
     LIMIT 1`,
  )
    .bind(input.organizationId, input.actorUserId, input.idempotencyKey)
    .first<RosterInviteEnrollmentRow>();

  if (enrollment?.state === "completed" && enrollment.membership_id) {
    return {
      ok: true,
      value: {
        enrollmentId: enrollment.id,
        membershipId: enrollment.membership_id,
        profileId: enrollment.profile_id,
        status: "completed",
      },
    };
  }

  // Step B: Capacity check & reservation in D1
  if (!enrollment) {
    if (link.max_uses !== null && link.committed_uses + link.active_reservations >= link.max_uses) {
      return {
        code: "invite_exhausted",
        message: "This roster invite link has reached its maximum enrollment capacity.",
        ok: false,
        status: 409,
      };
    }

    const enrollmentId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const requestDigest = crypto.randomUUID();
    const leaseExpiresAt = now + 60_000;
    const preexistingMembership = existingMembership ? 1 : 0;

    try {
      await env.CONTROL_DB.batch([
        env.CONTROL_DB.prepare(
          `INSERT INTO organization_roster_invite_enrollments
            (id, organization_id, link_id, user_id, profile_id, membership_id,
             idempotency_key, request_digest, state, reservation_lease_expires_at,
             fencing_version, preexisting_membership, retry_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, 1, ?, 0, ?, ?)`,
        ).bind(
          enrollmentId,
          input.organizationId,
          link.id,
          input.actorUserId,
          profileId,
          existingMembership?.id ?? null,
          input.idempotencyKey,
          requestDigest,
          leaseExpiresAt,
          preexistingMembership,
          now,
          now,
        ),
        env.CONTROL_DB.prepare(
          `UPDATE organization_roster_invite_links
           SET active_reservations = active_reservations + 1
           WHERE id = ?`,
        ).bind(link.id),
      ]);

      enrollment = await env.CONTROL_DB.prepare(
        `SELECT * FROM organization_roster_invite_enrollments WHERE id = ? LIMIT 1`,
      )
        .bind(enrollmentId)
        .first<RosterInviteEnrollmentRow>();
    } catch {
      // Competing reservation won the race; re-fetch existing
      enrollment = await env.CONTROL_DB.prepare(
        `SELECT * FROM organization_roster_invite_enrollments
         WHERE organization_id = ? AND user_id = ? LIMIT 1`,
      )
        .bind(input.organizationId, input.actorUserId)
        .first<RosterInviteEnrollmentRow>();
    }
  }

  if (!enrollment) {
    return {
      code: "enrollment_reservation_failed",
      message: "Could not reserve enrollment capacity.",
      ok: false,
      status: 500,
    };
  }

  // Step C: Prepare Organization Profile in DO
  const store = organizationStoreStub(env, input.organizationId);
  const prepareResult = await store.prepareRosterInviteEnrollment({
    actorUserId: input.actorUserId,
    displayName: input.displayName,
    enrollmentId: enrollment.id,
    organizationId: input.organizationId,
    phone: input.phone ?? "",
    profileId: enrollment.profile_id,
    requestId: input.requestId,
    showInDirectory: input.showInDirectory,
    userId: input.actorUserId,
    voicePart: input.voicePart,
  });

  if (!prepareResult.ok) {
    if (prepareResult.code === "voice_part_not_configured") {
      return {
        code: "voice_part_not_configured",
        message: "The selected voice part is not configured for this Organization.",
        ok: false,
        status: 400,
      };
    }
    return {
      code: "enrollment_preparation_failed",
      message: "Profile preparation was rejected by the Organization store.",
      ok: false,
      status: 400,
    };
  }

  // Step D: Commit the admission decision in D1 (admission commit point)
  if (enrollment.state === "reserved" || enrollment.state === "prepared") {
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        `UPDATE organization_roster_invite_enrollments
         SET state = 'admitted', updated_at = ?
         WHERE id = ? AND state IN ('reserved', 'prepared')`,
      ).bind(now, enrollment.id),
      env.CONTROL_DB.prepare(
        `UPDATE organization_roster_invite_links
         SET committed_uses = committed_uses + 1,
             active_reservations = MAX(0, active_reservations - 1)
         WHERE id = ?`,
      ).bind(enrollment.link_id),
    ]);
  }

  // Step E: Establish Membership in D1
  let membershipId = existingMembership?.id;
  if (!membershipId) {
    const newMembershipId = crypto.randomUUID();
    try {
      await env.CONTROL_DB.prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, ?, 'member', ?)`,
      )
        .bind(newMembershipId, input.organizationId, input.actorUserId, now)
        .run();
      membershipId = newMembershipId;
    } catch {
      // Look up if created concurrently
      const current = await env.CONTROL_DB.prepare(
        `SELECT id FROM member WHERE organizationId = ? AND userId = ? LIMIT 1`,
      )
        .bind(input.organizationId, input.actorUserId)
        .first<{ id: string }>();
      membershipId = current?.id ?? newMembershipId;
    }
  }

  // Step F: Commit profile in DO and link to membership
  const commitResult = await store.commitRosterInviteEnrollment({
    actorUserId: input.actorUserId,
    enrollmentId: enrollment.id,
    organizationId: input.organizationId,
    requestId: input.requestId,
  });

  if (!commitResult.ok) {
    // Record needs_repair for background or retry completion
    await env.CONTROL_DB.prepare(
      `UPDATE organization_roster_invite_enrollments
       SET state = 'needs_repair', last_error_code = 'do_commit_failed', updated_at = ?
       WHERE id = ?`,
    )
      .bind(now, enrollment.id)
      .run();

    return {
      code: "admission_finalization_pending",
      message: "Admission accepted but final profile creation is finishing.",
      ok: false,
      status: 202,
    };
  }

  // Link profile to membership
  const linkResult = await linkOrganizationProfile(
    env,
    {
      actorUserId: input.actorUserId,
      membershipId,
      organizationId: input.organizationId,
      profileId: enrollment.profile_id,
      requestId: input.requestId,
    },
    new Date(now),
  );

  if (!linkResult.ok) {
    await env.CONTROL_DB.prepare(
      `UPDATE organization_roster_invite_enrollments
       SET state = 'needs_repair', last_error_code = 'profile_link_failed', updated_at = ?
       WHERE id = ?`,
    )
      .bind(now, enrollment.id)
      .run();

    return {
      code: "admission_finalization_pending",
      message: "Admission accepted but profile link is finishing.",
      ok: false,
      status: 202,
    };
  }

  // Mark enrollment completed
  await env.CONTROL_DB.prepare(
    `UPDATE organization_roster_invite_enrollments
     SET state = 'completed', membership_id = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(membershipId, now, enrollment.id)
    .run();

  return {
    ok: true,
    value: {
      enrollmentId: enrollment.id,
      membershipId,
      profileId: enrollment.profile_id,
      status: "completed",
    },
  };
}

export async function getRosterInviteEnrollmentStatus(
  database: D1Database,
  input: {
    readonly actorUserId: string;
    readonly enrollmentId: string;
    readonly organizationId: string;
  },
): Promise<RosterInviteEnrollmentRow | null> {
  return database
    .prepare(
      `SELECT * FROM organization_roster_invite_enrollments
       WHERE id = ? AND organization_id = ? AND user_id = ? LIMIT 1`,
    )
    .bind(input.enrollmentId, input.organizationId, input.actorUserId)
    .first<RosterInviteEnrollmentRow>();
}
