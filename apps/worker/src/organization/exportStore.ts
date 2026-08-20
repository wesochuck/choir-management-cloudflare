import type { DurableObjectStorage, SqlStorageValue } from "@cloudflare/workers-types";
import { z } from "zod";

const EXPORT_TABLES = [
  "organization_metadata",
  "profiles",
  "venues",
  "events",
  "event_rosters",
  "seating_charts",
  "music_pieces",
  "organization_resources",
  "communication_messages",
  "communication_deliveries",
  "communication_templates",
  "communication_suppressions",
  "public_website_settings",
  "ticket_purchases",
  "discount_codes",
  "discount_code_redemptions",
  "ticket_bundles",
  "ticket_bundle_events",
  "ticket_bundle_allocations",
  "ticket_notifications",
  "ticket_scan_events",
  "polls",
  "poll_options",
  "poll_responses",
  "auditions",
  "audition_slots",
  "audition_notifications",
  "patrons",
  "donations",
  "donation_expirations",
  "seasons",
  "dues",
  "setup_state",
  "audit_events",
] as const;

const exportOrganizationIdSchema = z.string().min(1).max(128);
const MAX_ROWS_PER_TABLE = 10_000;
const EXPORT_PAGE_SIZE = 1_000;
const exportFormatSchema = z.literal("json");
const exportContextSchema = z.object({
  actorType: z.enum(["organization_member", "platform_administrator"]),
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

export interface OrganizationExportSnapshot {
  readonly files: readonly {
    readonly checksums: Readonly<Record<string, string>>;
    readonly contentType: string;
    readonly fileName: string;
    readonly id: string;
    readonly sizeBytes: number;
    readonly storageKey: string;
    readonly uploadedAt: string | null;
  }[];
  readonly metadata: Readonly<Record<string, SqlStorageValue>>;
  readonly records: Readonly<Record<string, readonly Readonly<Record<string, SqlStorageValue>>[]>>;
  readonly safety: {
    readonly fileCount: number;
    readonly maxRowsPerTable: number;
    readonly tableCounts: Readonly<Record<string, number>>;
    readonly tooLarge: boolean;
  };
}

interface OrganizationIdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface OrganizationExportRow {
  readonly [column: string]: SqlStorageValue;
  readonly actorType: string;
  readonly actorUserId: string;
  readonly archiveKey: string | null;
  readonly byteCount: number | null;
  readonly checksumSha256: string | null;
  readonly errorCode: string;
  readonly exportId: string;
  readonly format: string;
  readonly requestId: string;
  readonly status: string;
}

export function organizationExportKey(organizationId: string, exportId: string): string {
  return `organizations/${organizationId}/exports/${exportId}.json`;
}

function exportResponse(row: OrganizationExportRow): Response {
  return Response.json({
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    archiveKey: row.archiveKey,
    byteCount: row.byteCount,
    checksumSha256: row.checksumSha256,
    errorCode: row.errorCode || null,
    exportId: row.exportId,
    format: row.format,
    requestId: row.requestId,
    status: row.status,
  });
}

function readExportRow(
  storage: DurableObjectStorage,
  organizationId: string,
  exportId: string,
): OrganizationExportRow | null {
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== organizationId) return null;
  return (
    storage.sql
      .exec<OrganizationExportRow>(
        `SELECT id AS exportId, format, status, actor_type AS actorType,
          actor_user_id AS actorUserId,
          request_id AS requestId, archive_key AS archiveKey, byte_count AS byteCount,
          checksum_sha256 AS checksumSha256, error_code AS errorCode
         FROM organization_exports WHERE id = ? LIMIT 1`,
        exportId,
      )
      .toArray()
      .at(0) ?? null
  );
}

export function createOrganizationExportInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const parsed = exportContextSchema.extend({ format: exportFormatSchema }).safeParse(input);
  if (!parsed.success) return Response.json({ code: "validation_failed" }, { status: 400 });
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const exportId = crypto.randomUUID();
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO organization_exports
        (id, format, status, actor_type, actor_user_id, request_id, error_code, created_at, updated_at)
       VALUES (?, 'json', 'queued', ?, ?, ?, '', ?, ?)`,
      exportId,
      parsed.data.actorType,
      parsed.data.actorUserId,
      parsed.data.requestId,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'organization_export', ?, ?, ?)`,
      exportId,
      `organization-export:${exportId}`,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, 'organization.export.requested',
         'organization_export', ?, ?, ?, ?)`,
      `organization-export:${exportId}`,
      parsed.data.actorType,
      parsed.data.actorUserId,
      exportId,
      parsed.data.requestId,
      JSON.stringify({ format: parsed.data.format }),
      now,
    );
  });
  return Response.json({ exportId, status: "queued" });
}

export function readOrganizationExportJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  exportId: string | null,
): Response {
  const parsedId = z.uuid().safeParse(exportId);
  if (!organizationId || !parsedId.success) {
    return Response.json({ code: "export_not_found" }, { status: 404 });
  }
  const row = readExportRow(storage, organizationId, parsedId.data);
  return row ? exportResponse(row) : Response.json({ code: "export_not_found" }, { status: 404 });
}

export function completeOrganizationExportInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const parsed = exportContextSchema
    .extend({
      archiveKey: z.string().min(1).max(512),
      byteCount: z.number().int().nonnegative(),
      checksumSha256: z.string().min(1).max(128),
      exportId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return Response.json({ code: "validation_failed" }, { status: 400 });
  const row = readExportRow(storage, parsed.data.organizationId, parsed.data.exportId);
  if (!row) return Response.json({ code: "export_not_found" }, { status: 404 });
  if (
    parsed.data.archiveKey !==
    organizationExportKey(parsed.data.organizationId, parsed.data.exportId)
  ) {
    return Response.json({ code: "export_scope_conflict" }, { status: 409 });
  }
  if (row.status === "completed") return exportResponse(row);
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE organization_exports
       SET status = 'completed', archive_key = ?, byte_count = ?, checksum_sha256 = ?,
           error_code = '', updated_at = ?, completed_at = ?
       WHERE id = ? AND status IN ('queued', 'processing', 'failed')`,
      parsed.data.archiveKey,
      parsed.data.byteCount,
      parsed.data.checksumSha256,
      now,
      now,
      parsed.data.exportId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, 'organization.export.completed',
         'organization_export', ?, ?, ?, ?)`,
      `organization-export-completed:${parsed.data.exportId}`,
      row.actorType,
      row.actorUserId,
      parsed.data.exportId,
      parsed.data.requestId,
      JSON.stringify({ byteCount: parsed.data.byteCount }),
      now,
    );
  });
  const updated = readExportRow(storage, parsed.data.organizationId, parsed.data.exportId);
  return updated
    ? exportResponse(updated)
    : Response.json({ code: "export_not_found" }, { status: 404 });
}

export function failOrganizationExportInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const parsed = exportContextSchema
    .extend({ errorCode: z.string().min(1).max(128), exportId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return Response.json({ code: "validation_failed" }, { status: 400 });
  const row = readExportRow(storage, parsed.data.organizationId, parsed.data.exportId);
  if (!row) return Response.json({ code: "export_not_found" }, { status: 404 });
  storage.sql.exec(
    `UPDATE organization_exports
     SET status = 'failed', error_code = ?, archive_key = NULL, byte_count = NULL,
       checksum_sha256 = NULL, updated_at = ?
     WHERE id = ? AND status != 'completed'`,
    parsed.data.errorCode,
    new Date().toISOString(),
    parsed.data.exportId,
  );
  const updated = readExportRow(storage, parsed.data.organizationId, parsed.data.exportId);
  return updated
    ? exportResponse(updated)
    : Response.json({ code: "export_not_found" }, { status: 404 });
}

function readMetadata(
  storage: DurableObjectStorage,
  organizationId: string,
): OrganizationExportSnapshot["metadata"] {
  const identity = storage.sql
    .exec<OrganizationIdentityRow>(
      `SELECT organization_id AS organizationId, name, slug,
        lifecycle_state AS lifecycleState, created_at AS createdAt, updated_at AS updatedAt,
        timezone, roster_configuration_json AS rosterConfigurationJson,
        seating_configuration_json AS seatingConfigurationJson,
        donation_settings_json AS donationSettingsJson,
        transaction_fee_settings_json AS transactionFeeSettingsJson,
        audition_settings_json AS auditionSettingsJson
       FROM organization_metadata WHERE organization_id = ? LIMIT 1`,
      organizationId,
    )
    .toArray()
    .at(0);
  if (identity?.organizationId !== organizationId) {
    throw new Error("organization_identity_conflict");
  }
  return identity;
}

function readRecords(storage: DurableObjectStorage): {
  readonly records: OrganizationExportSnapshot["records"];
  readonly tableCounts: Readonly<Record<string, number>>;
  readonly tooLarge: boolean;
} {
  const records: Record<string, readonly Readonly<Record<string, SqlStorageValue>>[]> = {};
  const tableCounts: Record<string, number> = {};
  let tooLarge = false;
  for (const table of EXPORT_TABLES) {
    const count = storage.sql
      .exec<{ readonly count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      .one().count;
    tableCounts[table] = count;
    if (count > MAX_ROWS_PER_TABLE) tooLarge = true;

    const tableRows: Readonly<Record<string, SqlStorageValue>>[] = [];
    let lastRowId = 0;
    for (;;) {
      const page = storage.sql
        .exec<Readonly<Record<string, SqlStorageValue>> & { readonly __exportRowId: number }>(
          `SELECT rowid AS __exportRowId, * FROM ${table}
           WHERE rowid > ? ORDER BY rowid LIMIT ?`,
          lastRowId,
          EXPORT_PAGE_SIZE,
        )
        .toArray();
      if (page.length === 0) break;
      for (const row of page) {
        const { __exportRowId, ...record } = row;
        if (tableRows.length >= MAX_ROWS_PER_TABLE) break;
        tableRows.push(record);
        lastRowId = __exportRowId;
      }
      if (count > MAX_ROWS_PER_TABLE && tableRows.length >= MAX_ROWS_PER_TABLE) break;
      if (page.length < EXPORT_PAGE_SIZE) break;
    }
    records[table] = tableRows;
  }
  return { records, tableCounts, tooLarge };
}

function readFiles(storage: DurableObjectStorage): {
  readonly files: OrganizationExportSnapshot["files"];
  readonly fileCount: number;
  readonly tooLarge: boolean;
} {
  const fileCount = storage.sql
    .exec<{ readonly count: number }>(
      "SELECT COUNT(*) AS count FROM private_files WHERE status = 'ready'",
    )
    .one().count;
  if (fileCount > MAX_ROWS_PER_TABLE) {
    return { fileCount, files: [], tooLarge: true };
  }

  const files: OrganizationExportSnapshot["files"][number][] = [];
  let lastId = "";
  for (;;) {
    const page = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly contentType: string;
        readonly fileName: string;
        readonly id: string;
        readonly sizeBytes: number;
        readonly storageKey: string;
        readonly uploadedAt: string | null;
      }>(
        `SELECT id, storage_key AS storageKey, file_name AS fileName,
          content_type AS contentType, size_bytes AS sizeBytes, ready_at AS uploadedAt
         FROM private_files
         WHERE status = 'ready' AND id > ? ORDER BY id LIMIT ?`,
        lastId,
        EXPORT_PAGE_SIZE,
      )
      .toArray();
    if (page.length === 0) break;
    files.push(
      ...page.map((row) => ({
        checksums: {},
        contentType: row.contentType,
        fileName: row.fileName,
        id: row.id,
        sizeBytes: row.sizeBytes,
        storageKey: row.storageKey,
        uploadedAt: row.uploadedAt,
      })),
    );
    lastId = page[page.length - 1]?.id ?? lastId;
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  return { fileCount, files, tooLarge: false };
}

export function readOrganizationExportSnapshot(
  storage: DurableObjectStorage,
  organizationId: string,
): OrganizationExportSnapshot {
  const parsedOrganizationId = exportOrganizationIdSchema.parse(organizationId);
  const files = readFiles(storage);
  const records = readRecords(storage);
  return {
    files: files.files,
    metadata: readMetadata(storage, parsedOrganizationId),
    records: records.records,
    safety: {
      fileCount: files.fileCount,
      maxRowsPerTable: MAX_ROWS_PER_TABLE,
      tableCounts: records.tableCounts,
      tooLarge: files.tooLarge || records.tooLarge,
    },
  };
}
