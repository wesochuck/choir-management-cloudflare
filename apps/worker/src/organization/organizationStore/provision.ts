import { deliveryJobSchema } from "../../jobs/contracts";
import { ensureOrganizationAlarm } from "../scheduler";
import { currentOrganizationSchemaVersion } from "../schema";

import {
  completionSchema,
  failureSchema,
  organizationProvisioningSchema,
  schemaPreparationRequestSchema,
  terminalSchema,
} from "./storeShared";
import type {
  OrganizationMetadataRow,
  OrganizationIdentityRow,
  OrganizationSchemaVersionRow,
  JobLedgerRow,
} from "./storeShared";

export async function provisionOrganizationStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = organizationProvisioningSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_provisioning_request" }, { status: 400 });
  }
  const existing = storage.sql
    .exec<OrganizationMetadataRow>(
      `SELECT organization_id AS organizationId, name, slug
       FROM organization_metadata
       LIMIT 1`,
    )
    .toArray()
    .at(0);
  if (
    existing &&
    (existing.organizationId !== parsed.data.organizationId ||
      existing.name !== parsed.data.name ||
      existing.slug !== parsed.data.slug)
  ) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }

  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO organization_metadata
        (organization_id, name, slug, lifecycle_state, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT(organization_id) DO UPDATE SET
         lifecycle_state = 'active', updated_at = excluded.updated_at`,
      parsed.data.organizationId,
      parsed.data.name,
      parsed.data.slug,
      occurredAt,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT OR IGNORE INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'platform_administrator', ?, 'organization.provisioned',
         'organization', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.organizationId,
      parsed.data.requestId,
      JSON.stringify({
        canonicalHostname: parsed.data.canonicalHostname,
        canonicalStatus: parsed.data.canonicalStatus,
        name: parsed.data.name,
        slug: parsed.data.slug,
      }),
      occurredAt,
    );
  });
  await ensureOrganizationAlarm(storage);
  return Response.json({
    organizationId: parsed.data.organizationId,
    schemaVersion: currentOrganizationSchemaVersion,
    status: "active",
  });
}

export async function claimJob(storage: DurableObjectStorage, request: Request): Promise<Response> {
  const parsed = deliveryJobSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_job" }, { status: 400 });
  }

  const existing = storage.sql
    .exec<JobLedgerRow>(
      `SELECT status, attempt, job_id AS jobId
       FROM job_ledger WHERE idempotency_key = ? LIMIT 1`,
      parsed.data.idempotencyKey,
    )
    .toArray()
    .at(0);
  if (!existing) {
    storage.sql.exec(
      `INSERT INTO job_ledger
        (idempotency_key, job_id, kind, status, attempt, retry_count, claimed_at)
       VALUES (?, ?, ?, 'claimed', ?, 0, ?)`,
      parsed.data.idempotencyKey,
      parsed.data.jobId,
      parsed.data.kind,
      parsed.data.attempt,
      new Date().toISOString(),
    );
    return Response.json({ claimed: true, status: "claimed" });
  }
  if (existing.jobId !== parsed.data.jobId) {
    return Response.json({ code: "idempotency_key_conflict" }, { status: 409 });
  }
  if (existing.status === "completed" || parsed.data.attempt <= existing.attempt) {
    return Response.json({ claimed: false, status: existing.status });
  }
  const reclaim = storage.sql.exec(
    `UPDATE job_ledger
     SET status = 'claimed', attempt = ?, retry_count = MAX(retry_count, ?),
       claimed_at = ?, completed_at = NULL, failed_at = NULL, terminal_at = NULL,
       last_error_code = ''
     WHERE idempotency_key = ? AND job_id = ? AND attempt < ?`,
    parsed.data.attempt,
    parsed.data.attempt - 1,
    new Date().toISOString(),
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ claimed: reclaim.rowsWritten === 1, status: "claimed" });
}

export async function completeJob(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = completionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_completion" }, { status: 400 });
  }
  const result = storage.sql.exec(
    `UPDATE job_ledger SET status = 'completed', completed_at = ?, failed_at = NULL,
       terminal_at = NULL, last_error_code = ''
     WHERE idempotency_key = ? AND job_id = ? AND attempt = ? AND status = 'claimed'`,
    parsed.data.completedAt,
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ completed: result.rowsWritten === 1 });
}

export async function failJob(storage: DurableObjectStorage, request: Request): Promise<Response> {
  const parsed = failureSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_failure" }, { status: 400 });
  }
  const result = storage.sql.exec(
    `UPDATE job_ledger SET status = 'failed', completed_at = NULL, failed_at = ?,
       retry_count = MAX(retry_count, ?), terminal_at = NULL
     WHERE idempotency_key = ? AND job_id = ? AND attempt = ? AND status = 'claimed'`,
    parsed.data.failedAt,
    parsed.data.attempt,
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ failed: result.rowsWritten === 1 });
}

export async function terminalJob(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = terminalSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_terminal_job" }, { status: 400 });
  }
  const result = storage.sql.exec(
    `UPDATE job_ledger SET status = 'failed', completed_at = NULL, failed_at = ?,
       retry_count = MAX(retry_count, ?), terminal_at = ?, last_error_code = ?
     WHERE idempotency_key = ? AND job_id = ? AND attempt <= ? AND status != 'completed'`,
    parsed.data.failedAt,
    parsed.data.attempt,
    parsed.data.terminalAt,
    parsed.data.errorCode,
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ terminal: result.rowsWritten === 1 });
}

export async function prepareOrganizationSchema(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = schemaPreparationRequestSchema.safeParse(await request.json());
  if (!parsed.success || parsed.data.targetVersion > currentOrganizationSchemaVersion) {
    return Response.json({ code: "invalid_schema_preparation" }, { status: 400 });
  }
  const organization = storage.sql
    .exec<OrganizationIdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (organization?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const version = storage.sql
    .exec<OrganizationSchemaVersionRow>(
      "SELECT MAX(version) AS schemaVersion FROM organization_schema_migrations",
    )
    .toArray()
    .at(0);
  if (!version || version.schemaVersion < parsed.data.targetVersion) {
    return Response.json({ code: "schema_preparation_incomplete" }, { status: 503 });
  }
  return Response.json({
    organizationId: organization.organizationId,
    schemaVersion: version.schemaVersion,
  });
}
