import { failure, success, type DomainResult } from "@choir/domain";
import type {
  ProfileReconciliationFieldChoices,
  ProfileReconciliationResponse,
} from "@choir/contracts";

import type { Env } from "../env";
import { organizationStoreStub } from "../organization/rpc/client";

export interface ExecuteProfileReconciliationInput {
  readonly actorUserId: string;
  readonly confirmedSamePerson: true;
  readonly expectedSourceProfileId: string;
  readonly fieldChoices: ProfileReconciliationFieldChoices;
  readonly idempotencyKey: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly previewRevision: string;
  readonly requestId: string;
  readonly targetProfileId: string;
}

interface MemberRow {
  readonly id: string;
  readonly organizationId: string;
  readonly profileId: string | null;
  readonly role: string;
  readonly userId: string;
}

interface D1ReconciliationRow {
  readonly actor_user_id: string;
  readonly created_at: number;
  readonly field_choices_json?: string | null;
  readonly id: string;
  readonly idempotency_key: string;
  readonly membership_id: string;
  readonly organization_id: string;
  readonly preview_revision: string;
  readonly request_digest?: string;
  readonly source_profile_id: string;
  readonly state: "reserved" | "prepared" | "relinked" | "completed" | "failed" | "needs_repair";
  readonly target_profile_id: string;
  readonly updated_at: number;
}

function isFieldChoicesRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStoredFieldChoices(
  raw: string | null | undefined,
): ProfileReconciliationFieldChoices | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isFieldChoicesRecord(parsed)) return null;
    const notes: unknown = parsed.notes;
    const phone: unknown = parsed.phone;
    if (
      (notes !== "keep_target" && notes !== "overwrite_with_source" && notes !== "append_source") ||
      (phone !== "keep_target" && phone !== "overwrite_with_source")
    ) {
      return null;
    }
    return { notes, phone };
  } catch {
    return null;
  }
}

async function checkExistingOrValidateMembership(
  env: Env,
  input: ExecuteProfileReconciliationInput,
  existing: D1ReconciliationRow | null,
): Promise<
  | DomainResult<ProfileReconciliationResponse>
  | { readonly alreadyRelinked: boolean; readonly member: MemberRow }
> {
  const requestDigest = `${input.expectedSourceProfileId}->${input.targetProfileId}:${input.previewRevision}`;
  if (existing) {
    if (existing.request_digest !== requestDigest) {
      return failure("conflict", "Idempotency key was previously used with different parameters.");
    }
    if (existing.state === "completed") {
      const stub = organizationStoreStub(env, input.organizationId);
      const doStatus = await stub.getProfileReconciliationStatus(existing.id);
      if (doStatus.ok && doStatus.state === "completed") {
        return success({
          canonicalProfileId: existing.target_profile_id,
          id: existing.id,
          membershipId: existing.membership_id,
          message: "Profiles successfully consolidated.",
          occurredAt: new Date(existing.updated_at).toISOString(),
          requestId: input.requestId,
          sourceProfileId: existing.source_profile_id,
          status: "completed",
          targetProfileId: existing.target_profile_id,
        });
      }
    }
  }

  const member = await env.CONTROL_DB.prepare(
    `SELECT id, organizationId, profileId, userId, role FROM member
     WHERE id = ? AND organizationId = ? LIMIT 1`,
  )
    .bind(input.membershipId, input.organizationId)
    .first<MemberRow>();

  if (!member) {
    return failure("not_found", "The Organization Membership was not found.");
  }

  let alreadyRelinked = false;
  if (member.profileId === input.targetProfileId) {
    alreadyRelinked = true;
  } else if (member.profileId !== input.expectedSourceProfileId) {
    return failure("conflict", "The Membership is no longer linked to the expected Profile.");
  }

  const conflictingMember = await env.CONTROL_DB.prepare(
    `SELECT id FROM member
     WHERE organizationId = ? AND profileId = ? AND id <> ? LIMIT 1`,
  )
    .bind(input.organizationId, input.targetProfileId, input.membershipId)
    .first<{ id: string }>();

  if (conflictingMember) {
    return failure("conflict", "The target Profile is already linked to another Membership.");
  }

  return { alreadyRelinked, member };
}

async function prepareAndRelink(
  env: Env,
  input: ExecuteProfileReconciliationInput,
  member: MemberRow,
  reconciliationId: string,
  timestamp: number,
  isoDate: string,
  stub: ReturnType<typeof organizationStoreStub>,
): Promise<DomainResult<void>> {
  const prepareResult = await stub.prepareProfileReconciliation({
    actorUserId: input.actorUserId,
    expectedSourceProfileId: input.expectedSourceProfileId,
    fieldChoices: input.fieldChoices,
    idempotencyKey: input.idempotencyKey,
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    previewRevision: input.previewRevision,
    reconciliationId,
    requestId: input.requestId,
    targetProfileId: input.targetProfileId,
  });

  if (!prepareResult.ok) {
    await env.CONTROL_DB.prepare(
      `UPDATE organization_profile_reconciliations
       SET state = 'failed', last_error_code = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(prepareResult.error?.code ?? "prepare_failed", timestamp, reconciliationId)
      .run();

    return failure(
      prepareResult.error?.code === "stale_preview" ? "conflict" : "validation_failed",
      prepareResult.error?.message ?? "Profile reconciliation preparation failed.",
    );
  }

  const updateMemberStmt = env.CONTROL_DB.prepare(
    `UPDATE member
     SET profileId = ?
     WHERE id = ? AND organizationId = ? AND profileId = ?`,
  ).bind(
    input.targetProfileId,
    input.membershipId,
    input.organizationId,
    input.expectedSourceProfileId,
  );

  const updateEnrollmentStmt = env.CONTROL_DB.prepare(
    `UPDATE organization_roster_invite_enrollments
     SET canonical_profile_id = ?, updated_at = ?
     WHERE organization_id = ? AND user_id = ? AND profile_id = ?`,
  ).bind(
    input.targetProfileId,
    timestamp,
    input.organizationId,
    member.userId,
    input.expectedSourceProfileId,
  );

  const auditStmt = env.CONTROL_DB.prepare(
    `INSERT INTO platform_audit_events
      (id, actor_user_id, organization_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, ?, ?, 'organization.membership.profile_reconciled',
       'organization_membership', ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.actorUserId,
    input.organizationId,
    input.membershipId,
    input.requestId,
    JSON.stringify({
      after: { profileId: input.targetProfileId },
      before: { profileId: input.expectedSourceProfileId },
      reconciliationId,
    }),
    isoDate,
  );

  const updateRecStmt = env.CONTROL_DB.prepare(
    `UPDATE organization_profile_reconciliations
     SET state = 'relinked', updated_at = ?
     WHERE id = ?`,
  ).bind(timestamp, reconciliationId);

  const batchResults = await env.CONTROL_DB.batch([
    updateMemberStmt,
    updateEnrollmentStmt,
    auditStmt,
    updateRecStmt,
  ]);

  const memberUpdateResult = batchResults[0];
  if (memberUpdateResult?.meta.changes === 0) {
    await env.CONTROL_DB.prepare(
      `UPDATE organization_profile_reconciliations
       SET state = 'failed', last_error_code = 'cas_mismatch', updated_at = ?
       WHERE id = ?`,
    )
      .bind(timestamp, reconciliationId)
      .run();

    return failure(
      "conflict",
      "Membership was modified by another operation concurrently. Reconciliation aborted.",
    );
  }

  return success(undefined);
}

async function reserveReconciliationInD1(
  env: Env,
  input: ExecuteProfileReconciliationInput,
  reconciliationId: string,
  requestDigest: string,
  timestamp: number,
): Promise<DomainResult<void>> {
  try {
    await env.CONTROL_DB.prepare(
      `INSERT INTO organization_profile_reconciliations
        (id, organization_id, membership_id, source_profile_id, target_profile_id,
         idempotency_key, state, preview_revision, request_digest, actor_user_id,
         field_choices_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        reconciliationId,
        input.organizationId,
        input.membershipId,
        input.expectedSourceProfileId,
        input.targetProfileId,
        input.idempotencyKey,
        input.previewRevision,
        requestDigest,
        input.actorUserId,
        JSON.stringify(input.fieldChoices),
        timestamp,
        timestamp,
      )
      .run();
    return success(undefined);
  } catch {
    const raced = await env.CONTROL_DB.prepare(
      `SELECT * FROM organization_profile_reconciliations
       WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    )
      .bind(input.organizationId, input.idempotencyKey)
      .first<D1ReconciliationRow>();
    if (raced && raced.request_digest !== requestDigest) {
      return failure("conflict", "Idempotency key was previously used with different parameters.");
    }
    return success(undefined);
  }
}

async function commitAndFinalizeReconciliation(
  env: Env,
  input: ExecuteProfileReconciliationInput,
  reconciliationId: string,
  timestamp: number,
  isoDate: string,
  stub: ReturnType<typeof organizationStoreStub>,
): Promise<DomainResult<ProfileReconciliationResponse>> {
  let commitResult: {
    readonly error?: { readonly code: string; readonly message: string } | undefined;
    readonly ok: boolean;
  };
  try {
    commitResult = await stub.commitProfileReconciliation({
      actorUserId: input.actorUserId,
      expectedSourceProfileId: input.expectedSourceProfileId,
      fieldChoices: input.fieldChoices,
      idempotencyKey: input.idempotencyKey,
      membershipId: input.membershipId,
      organizationId: input.organizationId,
      previewRevision: input.previewRevision,
      reconciliationId,
      requestId: input.requestId,
      targetProfileId: input.targetProfileId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    commitResult = { error: { code: "do_commit_exception", message }, ok: false };
  }

  if (!commitResult.ok) {
    await env.CONTROL_DB.prepare(
      `UPDATE organization_profile_reconciliations
       SET state = 'needs_repair', last_error_code = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(commitResult.error?.code ?? "do_commit_failed", timestamp, reconciliationId)
      .run();

    return success({
      canonicalProfileId: input.targetProfileId,
      id: reconciliationId,
      membershipId: input.membershipId,
      message: "Membership relinked; profile consolidation pending background finalization.",
      occurredAt: isoDate,
      requestId: input.requestId,
      sourceProfileId: input.expectedSourceProfileId,
      status: "pending_repair",
      targetProfileId: input.targetProfileId,
    });
  }

  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      `UPDATE organization_profile_reconciliations
       SET state = 'completed', updated_at = ?
       WHERE id = ?`,
    ).bind(timestamp, reconciliationId),
    env.CONTROL_DB.prepare(
      `UPDATE organization_roster_invite_enrollments
       SET canonical_profile_id = ?, updated_at = ?
       WHERE organization_id = ? AND profile_id = ?
         AND (canonical_profile_id IS NULL OR canonical_profile_id = profile_id)`,
    ).bind(input.targetProfileId, timestamp, input.organizationId, input.expectedSourceProfileId),
  ]);

  return success({
    canonicalProfileId: input.targetProfileId,
    id: reconciliationId,
    membershipId: input.membershipId,
    message: "Profiles successfully consolidated.",
    occurredAt: isoDate,
    requestId: input.requestId,
    sourceProfileId: input.expectedSourceProfileId,
    status: "completed",
    targetProfileId: input.targetProfileId,
  });
}

export async function executeProfileReconciliation(
  env: Env,
  input: ExecuteProfileReconciliationInput,
  now = new Date(),
): Promise<DomainResult<ProfileReconciliationResponse>> {
  const timestamp = now.getTime();
  const isoDate = now.toISOString();

  // 1. Check idempotency in D1
  const existing = await env.CONTROL_DB.prepare(
    `SELECT * FROM organization_profile_reconciliations
     WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
  )
    .bind(input.organizationId, input.idempotencyKey)
    .first<D1ReconciliationRow>();

  // 2. Validate Membership and target state
  const validationResult = await checkExistingOrValidateMembership(env, input, existing);
  if (!("member" in validationResult)) {
    return validationResult;
  }
  const { member } = validationResult;

  const reconciliationId = existing?.id ?? crypto.randomUUID();
  const requestDigest = `${input.expectedSourceProfileId}->${input.targetProfileId}:${input.previewRevision}`;

  // 3. Reserve reconciliation in D1 if not existing
  if (!existing) {
    const reserveResult = await reserveReconciliationInD1(
      env,
      input,
      reconciliationId,
      requestDigest,
      timestamp,
    );
    if (!reserveResult.ok) {
      return reserveResult;
    }
  }

  // 4 & 5. Call DO prepare and perform conditional D1 CAS update if not already relinked
  const stub = organizationStoreStub(env, input.organizationId);

  if (existing?.state !== "relinked" && !validationResult.alreadyRelinked) {
    const relinkResult = await prepareAndRelink(
      env,
      input,
      member,
      reconciliationId,
      timestamp,
      isoDate,
      stub,
    );
    if (!relinkResult.ok) {
      return relinkResult;
    }
  }

  // 6 & 7. Call DO commit and finalize D1 state
  return commitAndFinalizeReconciliation(env, input, reconciliationId, timestamp, isoDate, stub);
}

export async function getProfileReconciliationStatus(
  database: D1Database,
  input: {
    readonly id: string;
    readonly organizationId: string;
  },
): Promise<D1ReconciliationRow | null> {
  return database
    .prepare(
      `SELECT * FROM organization_profile_reconciliations
       WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.id, input.organizationId)
    .first<D1ReconciliationRow>();
}

export interface RepairPendingProfileReconciliationsResult {
  readonly attempted: number;
  readonly failed: number;
  readonly repaired: number;
}

export async function repairPendingProfileReconciliations(
  env: Pick<Env, "CONTROL_DB" | "ORGANIZATION_STORE">,
  options?: { readonly maxRows?: number },
): Promise<RepairPendingProfileReconciliationsResult> {
  const maxRows = Math.min(Math.max(options?.maxRows ?? 10, 1), 50);
  const now = new Date();
  const timestamp = now.getTime();

  const queryResult = await env.CONTROL_DB.prepare(
    `SELECT id, organization_id, membership_id, source_profile_id, target_profile_id,
            idempotency_key, preview_revision, actor_user_id, field_choices_json, updated_at
     FROM organization_profile_reconciliations
     WHERE state = 'needs_repair'
     ORDER BY updated_at ASC
     LIMIT ?`,
  )
    .bind(maxRows)
    .all<D1ReconciliationRow>();

  const rows = queryResult.results;
  let repaired = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const storedChoices = parseStoredFieldChoices(row.field_choices_json);
      if (!storedChoices) {
        await env.CONTROL_DB.prepare(
          `UPDATE organization_profile_reconciliations
            SET last_error_code = 'missing_field_choices', updated_at = ?
            WHERE id = ?`,
        )
          .bind(timestamp, row.id)
          .run();
        failed++;
        continue;
      }
      const stub = organizationStoreStub(env, row.organization_id);
      const commitResult = await stub.commitProfileReconciliation({
        actorUserId: row.actor_user_id,
        expectedSourceProfileId: row.source_profile_id,
        fieldChoices: storedChoices,
        idempotencyKey: row.idempotency_key,
        membershipId: row.membership_id,
        organizationId: row.organization_id,
        previewRevision: row.preview_revision,
        reconciliationId: row.id,
        requestId: `repair-${row.id}-${String(timestamp)}`,
        targetProfileId: row.target_profile_id,
      });

      if (commitResult.ok) {
        await env.CONTROL_DB.batch([
          env.CONTROL_DB.prepare(
            `UPDATE organization_profile_reconciliations
             SET state = 'completed', updated_at = ?
             WHERE id = ?`,
          ).bind(timestamp, row.id),
          env.CONTROL_DB.prepare(
            `UPDATE organization_roster_invite_enrollments
             SET canonical_profile_id = ?, updated_at = ?
             WHERE organization_id = ? AND profile_id = ?
               AND (canonical_profile_id IS NULL OR canonical_profile_id = profile_id)`,
          ).bind(row.target_profile_id, timestamp, row.organization_id, row.source_profile_id),
        ]);
        repaired++;
      } else {
        await env.CONTROL_DB.prepare(
          `UPDATE organization_profile_reconciliations
           SET last_error_code = ?, updated_at = ?
           WHERE id = ?`,
        )
          .bind(commitResult.error?.code ?? "commit_failed", timestamp, row.id)
          .run();
        failed++;
      }
    } catch {
      await env.CONTROL_DB.prepare(
        `UPDATE organization_profile_reconciliations
         SET last_error_code = 'do_exception', updated_at = ?
         WHERE id = ?`,
      )
        .bind(timestamp, row.id)
        .run();
      failed++;
    }
  }

  return { attempted: rows.length, failed, repaired };
}
