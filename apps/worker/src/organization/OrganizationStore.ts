import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import type { Env } from "../env";
import { deliveryJobSchema } from "../jobs/contracts";
import {
  privateFileIdSchema,
  privateFileReservationSchema,
  privateFileTransitionSchema,
  privateOrganizationFileKey,
} from "../storage/privateFiles";
import { migrateOrganization } from "./migrations";
import { currentOrganizationSchemaVersion } from "./schema";

const completionSchema = z.object({
  attempt: z.number().int().min(1).max(10),
  completedAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256),
  jobId: z.uuid(),
});

const failureSchema = z.object({
  attempt: z.number().int().min(1).max(10),
  failedAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256),
  jobId: z.uuid(),
});

const organizationProvisioningSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "pending"]),
  name: z.string().min(1).max(120),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
  slug: z.string().min(2).max(63),
});

const profileIdSchema = z.uuid();

interface OrganizationMetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly name: string;
  readonly organizationId: string;
  readonly slug: string;
}

interface OrganizationIdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface JobLedgerRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempt: number;
  readonly jobId: string;
  readonly status: string;
}

interface PrivateFileMetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentType: string;
  readonly fileName: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly uploadedAt: string;
}

function getProfileIdentity(storage: DurableObjectStorage, encodedProfileId: string): Response {
  const profileId = profileIdSchema.safeParse(decodeURIComponent(encodedProfileId));
  if (!profileId.success) {
    return Response.json({ code: "invalid_profile_id" }, { status: 400 });
  }
  const profile = storage.sql
    .exec<Record<string, SqlStorageValue> & { id: string }>(
      "SELECT id FROM profiles WHERE id = ? LIMIT 1",
      profileId.data,
    )
    .toArray()
    .at(0);
  return profile
    ? Response.json({ exists: true, profileId: profile.id })
    : Response.json({ code: "profile_not_found" }, { status: 404 });
}

async function provisionOrganizationStore(
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
      `organization-provisioned:${parsed.data.requestId}`,
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
  return Response.json({
    organizationId: parsed.data.organizationId,
    schemaVersion: currentOrganizationSchemaVersion,
    status: "active",
  });
}

async function claimJob(storage: DurableObjectStorage, request: Request): Promise<Response> {
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
        (idempotency_key, job_id, kind, status, attempt, claimed_at)
       VALUES (?, ?, ?, 'claimed', ?, ?)`,
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
     SET status = 'claimed', attempt = ?, claimed_at = ?, completed_at = NULL, failed_at = NULL
     WHERE idempotency_key = ? AND job_id = ? AND attempt < ?`,
    parsed.data.attempt,
    new Date().toISOString(),
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ claimed: reclaim.rowsWritten === 1, status: "claimed" });
}

async function completeJob(storage: DurableObjectStorage, request: Request): Promise<Response> {
  const parsed = completionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_completion" }, { status: 400 });
  }
  const result = storage.sql.exec(
    `UPDATE job_ledger SET status = 'completed', completed_at = ?, failed_at = NULL
     WHERE idempotency_key = ? AND job_id = ? AND attempt = ? AND status = 'claimed'`,
    parsed.data.completedAt,
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ completed: result.rowsWritten === 1 });
}

async function failJob(storage: DurableObjectStorage, request: Request): Promise<Response> {
  const parsed = failureSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_failure" }, { status: 400 });
  }
  const result = storage.sql.exec(
    `UPDATE job_ledger SET status = 'failed', completed_at = NULL, failed_at = ?
     WHERE idempotency_key = ? AND job_id = ? AND attempt = ? AND status = 'claimed'`,
    parsed.data.failedAt,
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ failed: result.rowsWritten === 1 });
}

async function reservePrivateFile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileReservationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file" }, { status: 400 });
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
  const storageKey = privateOrganizationFileKey(parsed.data.organizationId, parsed.data.fileId);
  try {
    storage.sql.exec(
      `INSERT INTO private_files
        (id, storage_key, file_name, content_type, size_bytes, status,
         uploaded_by, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      parsed.data.fileId,
      storageKey,
      parsed.data.fileName,
      parsed.data.contentType,
      parsed.data.sizeBytes,
      parsed.data.actorUserId,
      parsed.data.requestId,
      new Date().toISOString(),
    );
    return Response.json({ reserved: true, storageKey });
  } catch {
    return Response.json({ code: "private_file_conflict" }, { status: 409 });
  }
}

async function finalizePrivateFile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  }
  const expectedKey = privateOrganizationFileKey(parsed.data.organizationId, parsed.data.fileId);
  if (parsed.data.storageKey !== expectedKey) {
    return Response.json({ code: "private_file_scope_conflict" }, { status: 409 });
  }
  const uploadedAt = new Date().toISOString();
  const ready = storage.transactionSync(() => {
    const result = storage.sql.exec(
      `UPDATE private_files SET status = 'ready', ready_at = ?
       WHERE id = ? AND storage_key = ? AND uploaded_by = ? AND request_id = ?
         AND status = 'pending'`,
      uploadedAt,
      parsed.data.fileId,
      expectedKey,
      parsed.data.actorUserId,
      parsed.data.requestId,
    );
    if (result.rowsWritten !== 1) {
      return false;
    }
    storage.sql.exec(
      `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'organization.file.uploaded',
           'private_file', ?, ?, ?, ?)`,
      `private-file-uploaded:${parsed.data.requestId}`,
      parsed.data.actorUserId,
      parsed.data.fileId,
      parsed.data.requestId,
      JSON.stringify({ fileId: parsed.data.fileId, storageKey: expectedKey }),
      uploadedAt,
    );
    return true;
  });
  return ready
    ? Response.json({ ready: true, uploadedAt })
    : Response.json({ code: "private_file_not_reserved" }, { status: 409 });
}

async function abortPrivateFile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  }
  const expectedKey = privateOrganizationFileKey(parsed.data.organizationId, parsed.data.fileId);
  storage.sql.exec(
    `DELETE FROM private_files
     WHERE id = ? AND storage_key = ? AND uploaded_by = ? AND request_id = ?
       AND status = 'pending'`,
    parsed.data.fileId,
    expectedKey,
    parsed.data.actorUserId,
    parsed.data.requestId,
  );
  return Response.json({ aborted: true });
}

function getPrivateFileMetadata(storage: DurableObjectStorage, encodedFileId: string): Response {
  const fileId = privateFileIdSchema.safeParse(decodeURIComponent(encodedFileId));
  if (!fileId.success) {
    return Response.json({ code: "private_file_not_found" }, { status: 404 });
  }
  const metadata = storage.sql
    .exec<PrivateFileMetadataRow>(
      `SELECT id, storage_key AS storageKey, file_name AS fileName,
        content_type AS contentType, size_bytes AS sizeBytes, ready_at AS uploadedAt
       FROM private_files WHERE id = ? AND status = 'ready' LIMIT 1`,
      fileId.data,
    )
    .toArray()
    .at(0);
  return metadata
    ? Response.json(metadata)
    : Response.json({ code: "private_file_not_found" }, { status: 404 });
}

async function dispatchPostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  switch (pathname) {
    case "/internal/files/abort":
      return abortPrivateFile(storage, request);
    case "/internal/files/ready":
      return finalizePrivateFile(storage, request);
    case "/internal/files/reserve":
      return reservePrivateFile(storage, request);
    case "/internal/jobs/claim":
      return claimJob(storage, request);
    case "/internal/jobs/complete":
      return completeJob(storage, request);
    case "/internal/jobs/fail":
      return failJob(storage, request);
    case "/internal/provision":
      return provisionOrganizationStore(storage, request);
    default:
      return null;
  }
}

export class OrganizationStore extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    migrateOrganization(state.storage.sql);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/internal/health") {
      return Response.json({ status: "ok" });
    }

    if (request.method === "POST") {
      const response = await dispatchPostRequest(this.ctx.storage, url.pathname, request);
      if (response) {
        return response;
      }
    }

    const profileIdentityPrefix = "/internal/profiles/";
    if (request.method === "GET" && url.pathname.startsWith(profileIdentityPrefix)) {
      return getProfileIdentity(this.ctx.storage, url.pathname.slice(profileIdentityPrefix.length));
    }

    const privateFilePrefix = "/internal/files/";
    if (request.method === "GET" && url.pathname.startsWith(privateFilePrefix)) {
      return getPrivateFileMetadata(this.ctx.storage, url.pathname.slice(privateFilePrefix.length));
    }

    return Response.json({ code: "not_found" }, { status: 404 });
  }
}
