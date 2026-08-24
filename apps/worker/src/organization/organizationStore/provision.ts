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

const requeueJobSchema = deliveryJobSchema.pick({
  idempotencyKey: true,
  jobId: true,
  kind: true,
  organizationId: true,
});

function sourceIdFromJobKey(idempotencyKey: string, prefix: string): string | null {
  if (!idempotencyKey.startsWith(prefix)) return null;
  const sourceId = idempotencyKey.slice(prefix.length).split(":", 1)[0];
  return sourceId ?? null;
}

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
       VALUES (?, ?, ?, 'provisioning', ?, ?)
       ON CONFLICT(organization_id) DO UPDATE SET
         name = excluded.name, slug = excluded.slug, updated_at = excluded.updated_at`,
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

/**
 * Reopens a terminal job's source record before a platform operator creates a
 * fresh queue delivery. The queue attempt counter belongs to the new message,
 * so the ledger is reset to zero and the normal consumer claims it at attempt 1.
 */
export async function requeueJob(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = requeueJobSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ code: "invalid_job_requeue" }, { status: 400 });
  }

  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }

  const ledger = storage.sql
    .exec<{
      readonly jobId: string;
      readonly kind: string;
      readonly status: string;
    }>(
      `SELECT job_id AS jobId, kind, status
       FROM job_ledger WHERE idempotency_key = ? LIMIT 1`,
      parsed.data.idempotencyKey,
    )
    .toArray()
    .at(0);
  if (!ledger) return Response.json({ code: "job_not_found" }, { status: 404 });
  if (ledger.jobId !== parsed.data.jobId || ledger.kind !== parsed.data.kind) {
    return Response.json({ code: "job_identity_conflict" }, { status: 409 });
  }
  if (ledger.status === "completed") {
    return Response.json({ requeued: false, status: "completed" });
  }
  if (ledger.status !== "failed") {
    return Response.json({ code: "job_not_terminal" }, { status: 409 });
  }

  const outbox = storage.sql
    .exec<{ readonly idempotencyKey: string; readonly kind: string }>(
      `SELECT idempotency_key AS idempotencyKey, kind
       FROM scheduled_job_outbox WHERE job_id = ? LIMIT 1`,
      parsed.data.jobId,
    )
    .toArray()
    .at(0);
  if (!outbox) return Response.json({ code: "job_source_not_found" }, { status: 404 });
  if (outbox.kind !== parsed.data.kind || outbox.idempotencyKey !== parsed.data.idempotencyKey) {
    return Response.json({ code: "job_source_conflict" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const sourceState = { ready: true };
  // eslint-disable-next-line complexity -- source-specific reset logic is kept atomic with the ledger reset.
  storage.transactionSync(() => {
    if (parsed.data.kind === "communication_delivery") {
      const messageId = sourceIdFromJobKey(parsed.data.idempotencyKey, "communication:");
      if (!messageId) {
        sourceState.ready = false;
      } else {
        const deliveryCount = storage.sql
          .exec<{ readonly count: number }>(
            `SELECT COUNT(*) AS count FROM communication_deliveries
             WHERE message_id = ? AND status IN ('queued', 'processing', 'failed')`,
            messageId,
          )
          .one().count;
        sourceState.ready = deliveryCount > 0;
        if (sourceState.ready) {
          storage.sql.exec(
            `UPDATE communication_deliveries
             SET status = 'queued', failure_detail = '', updated_at = ?
             WHERE message_id = ? AND status IN ('processing', 'failed')`,
            now,
            messageId,
          );
          storage.sql.exec(
            "UPDATE communication_messages SET status = 'Queued', updated_at = ? WHERE id = ?",
            now,
            messageId,
          );
        }
      }
    } else if (parsed.data.kind === "audition_notification") {
      const notificationId = sourceIdFromJobKey(
        parsed.data.idempotencyKey,
        "audition-notification:",
      );
      if (!notificationId) {
        sourceState.ready = false;
      } else {
        const source = storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM audition_notifications WHERE id = ? LIMIT 1",
            notificationId,
          )
          .toArray()
          .at(0);
        sourceState.ready =
          source !== undefined && ["queued", "processing", "failed"].includes(source.status);
        if (sourceState.ready) {
          storage.sql.exec(
            `UPDATE audition_notifications
             SET status = 'queued', failure_detail = '', updated_at = ?, sent_at = NULL
             WHERE id = ?`,
            now,
            notificationId,
          );
        }
      }
    } else if (parsed.data.kind === "payment_notification") {
      const source = storage.sql
        .exec<{ readonly status: string }>(
          "SELECT status FROM payment_notifications WHERE id = ? LIMIT 1",
          parsed.data.jobId,
        )
        .toArray()
        .at(0);
      sourceState.ready =
        source !== undefined && ["queued", "processing", "failed"].includes(source.status);
      if (sourceState.ready) {
        storage.sql.exec(
          `UPDATE payment_notifications
           SET status = 'queued', failure_detail = '', updated_at = ?, sent_at = NULL
           WHERE id = ?`,
          now,
          parsed.data.jobId,
        );
      }
    } else if (parsed.data.kind === "ticket_notification") {
      const notificationId = sourceIdFromJobKey(parsed.data.idempotencyKey, "ticket-notification:");
      if (!notificationId) {
        sourceState.ready = false;
      } else {
        const source = storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM ticket_notifications WHERE id = ? LIMIT 1",
            notificationId,
          )
          .toArray()
          .at(0);
        sourceState.ready =
          source !== undefined && ["queued", "processing", "failed"].includes(source.status);
        if (sourceState.ready) {
          storage.sql.exec(
            `UPDATE ticket_notifications
             SET status = 'queued', failure_detail = '', updated_at = ?, sent_at = NULL
             WHERE id = ?`,
            now,
            notificationId,
          );
        }
      }
    } else if (parsed.data.kind === "organization_export") {
      const source = storage.sql
        .exec<{ readonly status: string }>(
          "SELECT status FROM organization_exports WHERE id = ? LIMIT 1",
          parsed.data.jobId,
        )
        .toArray()
        .at(0);
      sourceState.ready =
        source !== undefined && ["queued", "processing", "failed"].includes(source.status);
      if (sourceState.ready) {
        storage.sql.exec(
          `UPDATE organization_exports
           SET status = 'queued', error_code = '', archive_key = NULL,
               byte_count = NULL, checksum_sha256 = NULL, updated_at = ?, completed_at = NULL
           WHERE id = ?`,
          now,
          parsed.data.jobId,
        );
      }
    }

    if (sourceState.ready) {
      storage.sql.exec(
        `UPDATE job_ledger
         SET status = 'failed', attempt = 0, completed_at = NULL, failed_at = NULL,
             terminal_at = NULL, last_error_code = ''
         WHERE idempotency_key = ? AND job_id = ? AND kind = ? AND status = 'failed'`,
        parsed.data.idempotencyKey,
        parsed.data.jobId,
        parsed.data.kind,
      );
    }
  });

  if (!sourceState.ready) {
    return Response.json({ code: "job_source_not_retryable" }, { status: 409 });
  }
  return Response.json({ requeued: true, status: "failed" });
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
