import {
  CONTACT_IMPORT_BATCH_SIZE,
  CONTACT_IMPORT_MAX_HEADERS,
  CONTACT_IMPORT_MAX_LISTS,
  CONTACT_IMPORT_ROWS_MAX,
  ContactImportError,
  applyContactImportMapping,
  contactImportDedupeKey,
  parseContactImportStatus,
  previewContactImport,
  renderContactImportErrorCsv,
  suggestContactImportMapping,
  validateContactImportMapping,
  validateContactImportRecord,
  type ContactImportPreview,
  type ContactImportRecord,
  type ContactImportTarget,
  type ContactImportValidatedRow,
} from "@choir/domain";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import { z } from "zod";

import {
  addContactsToListInStore,
  ContactStoreError,
  createContactInStore,
  updateContactInStore,
  type ContactStoreStorage,
} from "./contactStore";

/**
 * Phase 5 staged CSV contact-import persistence.
 *
 * Temp data is DO-staged (never R2), so every staged row is implicitly scoped
 * to the single Organization owned by this Durable Object; the R2-substitution
 * class of attack has no surface here. Cross-tenant job replay is blocked the
 * same way as all contact storage: `assertOrganization` compares the
 * caller-supplied Organization against `organization_metadata`, and a foreign
 * import ID simply does not exist in this object's tables.
 *
 * Execution policy (V1, conservative):
 * - blank imported scalars never erase stored values (fill-when-blank only);
 * - channel statuses merge through the Phase 1 helper, so an existing
 *   unsubscribe/suppression always survives an imported subscribe while an
 *   imported unsubscribe may unsubscribe;
 * - all selected lists are added idempotently; existing memberships survive;
 * - matching is normalized email first, normalized phone second, never name.
 */

export function contactImportIdempotencyKey(importId: string): string {
  return `contact-import:${importId}`;
}

const uuidSchema = z.uuid();
const organizationIdSchema = z.string().min(1).max(128);
const actorUserIdSchema = z.string().min(1).max(128);

export type ContactImportJobStatus =
  "staged" | "confirmed" | "processing" | "completed" | "failed" | "cancelled";

export interface ContactImportSummary {
  readonly actorUserId: string;
  readonly byteCount: number;
  readonly completedAt: string | null;
  readonly confirmedAt: string | null;
  readonly contactsCreated: number;
  readonly contactsUpdated: number;
  readonly createdAt: string;
  readonly errorCode: string | null;
  readonly existingMatches: number;
  readonly fileName: string;
  readonly hasErrorCsv: boolean;
  readonly headers: readonly string[];
  readonly idempotencyKey: string;
  readonly importId: string;
  readonly inFileDuplicates: number;
  readonly invalidRows: number;
  readonly listIds: readonly string[];
  readonly mapping: readonly ContactImportTarget[] | null;
  readonly membershipsAdded: number;
  readonly newContacts: number;
  readonly processedRows: number;
  readonly rowCount: number;
  readonly rowsRead: number;
  readonly sampleRows: readonly (readonly string[])[];
  readonly status: ContactImportJobStatus;
  readonly suppressedPreserved: number;
  readonly updatedAt: string;
}

export interface ContactImportBatchResult {
  readonly completed: boolean;
  readonly processedThisBatch: number;
  readonly summary: ContactImportSummary;
}

interface ImportRow {
  readonly [column: string]: SqlStorageValue;
  readonly actorUserId: string;
  readonly byteCount: number;
  readonly cellsJson: string;
  readonly contactId: string | null;
  readonly createdAt: string;
  readonly errorCode: string;
  readonly fileName: string;
  readonly headersJson: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly listIdsJson: string;
  readonly mappingJson: string;
  readonly status: string;
  readonly updatedAt: string;
}

interface StagedRow {
  readonly [column: string]: SqlStorageValue;
  readonly cellsJson: string;
  readonly contactId: string | null;
  readonly dedupeKey: string | null;
  readonly error: string;
  readonly rowIndex: number;
  readonly rowNumber: number;
  readonly status: string;
}

interface ExistingContactStatusRow {
  readonly [column: string]: SqlStorageValue;
  readonly channel: string | null;
  readonly normalizedEmail: string;
  readonly status: string | null;
}

interface ContactImportCounterRow {
  readonly [column: string]: SqlStorageValue;
  readonly contactsCreated: number;
  readonly contactsUpdated: number;
  readonly existingMatches: number;
  readonly inFileDuplicates: number;
  readonly invalidRows: number;
  readonly membershipsAdded: number;
  readonly processedRows: number;
  readonly rowCount: number;
  readonly suppressedPreserved: number;
}

interface ContactSnapshotRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly id: string;
  readonly lastName: string | null;
  readonly phone: string | null;
  readonly source: string | null;
}

interface PreferenceStatusRow {
  readonly [column: string]: SqlStorageValue;
  readonly channel: string;
  readonly contactId: string;
  readonly status: string;
}

function requireUuid(
  value: string,
  code: "contact_import_not_found" | "validation_failed" = "validation_failed",
): void {
  if (!uuidSchema.safeParse(value).success) {
    throw new ContactStoreError(code, "Expected a UUID.");
  }
}

function assertOrganization(
  storage: ContactStoreStorage,
  organizationId: string | null | undefined,
): void {
  if (!organizationId) {
    throw new ContactStoreError(
      "organization_identity_conflict",
      "Organization identity mismatch.",
    );
  }
  const stored = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (stored !== organizationId) {
    throw new ContactStoreError(
      "organization_identity_conflict",
      "Organization identity mismatch.",
    );
  }
}

function requireValidMapping(
  headers: readonly string[],
  mapping: readonly string[],
): ContactImportTarget[] {
  try {
    return validateContactImportMapping(headers, mapping);
  } catch (error: unknown) {
    if (error instanceof ContactImportError) {
      throw new ContactStoreError("validation_failed", error.message);
    }
    throw error;
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function readImportRow(storage: ContactStoreStorage, importId: string): ImportRow | undefined {
  return storage.sql
    .exec<ImportRow>(
      `SELECT id, status, file_name AS fileName, byte_count AS byteCount,
        headers_json AS headersJson, mapping_json AS mappingJson, list_ids_json AS listIdsJson,
        idempotency_key AS idempotencyKey, actor_user_id AS actorUserId,
        error_code AS errorCode, created_at AS createdAt, updated_at AS updatedAt
        FROM contact_imports WHERE id = ? LIMIT 1`,
      importId,
    )
    .toArray()
    .at(0);
}

function readCounters(
  storage: ContactStoreStorage,
  importId: string,
): {
  contactsCreated: number;
  contactsUpdated: number;
  existingMatches: number;
  inFileDuplicates: number;
  invalidRows: number;
  membershipsAdded: number;
  processedRows: number;
  rowCount: number;
  suppressedPreserved: number;
} {
  const row = storage.sql
    .exec<ContactImportCounterRow>(
      `SELECT row_count AS rowCount, processed_rows AS processedRows,
        contacts_created AS contactsCreated, contacts_updated AS contactsUpdated,
        existing_matches AS existingMatches, in_file_duplicates AS inFileDuplicates,
        invalid_rows AS invalidRows, suppressed_preserved AS suppressedPreserved,
        memberships_added AS membershipsAdded
        FROM contact_imports WHERE id = ? LIMIT 1`,
      importId,
    )
    .toArray()
    .at(0);
  if (!row) {
    throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  }
  return {
    contactsCreated: row.contactsCreated,
    contactsUpdated: row.contactsUpdated,
    existingMatches: row.existingMatches,
    inFileDuplicates: row.inFileDuplicates,
    invalidRows: row.invalidRows,
    membershipsAdded: row.membershipsAdded,
    processedRows: row.processedRows,
    rowCount: row.rowCount,
    suppressedPreserved: row.suppressedPreserved,
  };
}

function countErrorRows(storage: ContactStoreStorage, importId: string): number {
  return (
    storage.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM contact_import_rows WHERE import_id = ? AND status IN ('error', 'skipped')",
        importId,
      )
      .toArray()
      .at(0)?.count ?? 0
  );
}

function readSampleRows(storage: ContactStoreStorage, importId: string): string[][] {
  return storage.sql
    .exec<StagedRow>(
      "SELECT cells_json AS cellsJson FROM contact_import_rows WHERE import_id = ? ORDER BY row_index ASC LIMIT 5",
      importId,
    )
    .toArray()
    .map((row) => parseStringArray(row.cellsJson));
}

const IMPORT_STATUSES: readonly ContactImportJobStatus[] = [
  "staged",
  "confirmed",
  "processing",
  "completed",
  "failed",
  "cancelled",
];

function parseImportStatus(value: string): ContactImportJobStatus {
  const found = IMPORT_STATUSES.find((status) => status === value);
  if (!found) throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  return found;
}

function resolveStoredMapping(
  headers: readonly string[],
  mappingRaw: readonly string[],
): readonly ContactImportTarget[] | null {
  if (mappingRaw.length === 0) return null;
  try {
    return requireValidMapping(headers, mappingRaw);
  } catch {
    return null;
  }
}

function readImportTimestamps(
  storage: ContactStoreStorage,
  importId: string,
): { readonly completedAt: string | null; readonly confirmedAt: string | null } {
  const row = storage.sql
    .exec<{ readonly completedAt: string | null; readonly confirmedAt: string | null }>(
      "SELECT confirmed_at AS confirmedAt, completed_at AS completedAt FROM contact_imports WHERE id = ? LIMIT 1",
      importId,
    )
    .toArray()
    .at(0);
  return { completedAt: row?.completedAt ?? null, confirmedAt: row?.confirmedAt ?? null };
}

function toSummary(
  storage: ContactStoreStorage,
  row: ImportRow,
  preview: Pick<
    ContactImportPreview,
    | "existingMatches"
    | "inFileDuplicates"
    | "invalidRows"
    | "newContacts"
    | "rowsRead"
    | "suppressedPreserved"
  > | null,
): ContactImportSummary {
  const counters = readCounters(storage, row.id);
  const headers = parseStringArray(row.headersJson);
  const timestamps = readImportTimestamps(storage, row.id);
  return {
    actorUserId: row.actorUserId,
    byteCount: row.byteCount,
    completedAt: timestamps.completedAt,
    confirmedAt: timestamps.confirmedAt,
    contactsCreated: counters.contactsCreated,
    contactsUpdated: counters.contactsUpdated,
    createdAt: row.createdAt,
    errorCode: row.errorCode ? row.errorCode : null,
    existingMatches: preview?.existingMatches ?? counters.existingMatches,
    fileName: row.fileName,
    hasErrorCsv: countErrorRows(storage, row.id) > 0,
    headers,
    idempotencyKey: row.idempotencyKey,
    importId: row.id,
    inFileDuplicates: preview?.inFileDuplicates ?? counters.inFileDuplicates,
    invalidRows: preview?.invalidRows ?? counters.invalidRows,
    listIds: parseStringArray(row.listIdsJson),
    mapping: resolveStoredMapping(headers, parseStringArray(row.mappingJson)),
    membershipsAdded: counters.membershipsAdded,
    newContacts: preview?.newContacts ?? counters.contactsCreated,
    processedRows: counters.processedRows,
    rowCount: counters.rowCount,
    rowsRead: preview?.rowsRead ?? counters.rowCount,
    sampleRows: readSampleRows(storage, row.id),
    status: parseImportStatus(row.status),
    suppressedPreserved: preview?.suppressedPreserved ?? counters.suppressedPreserved,
    updatedAt: row.updatedAt,
  };
}

function writeAudit(
  storage: ContactStoreStorage,
  params: {
    readonly actorUserId: string;
    readonly action: string;
    readonly importId: string;
    readonly requestId: string;
    readonly summary: unknown;
  },
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, 'contact_import', ?, ?, ?, ?)`,
    crypto.randomUUID(),
    params.actorUserId,
    params.action,
    params.importId,
    params.requestId,
    JSON.stringify(params.summary),
    new Date().toISOString(),
  );
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function countProbableDuplicates(
  headers: readonly string[],
  rows:
    | readonly (readonly string[])[]
    | readonly {
        readonly cells: readonly string[];
        readonly rowNumber?: number;
      }[],
): number {
  const suggested = suggestContactImportMapping(headers);
  const emailIndex = suggested.indexOf("email");
  if (emailIndex < 0) return 0;
  let count = 0;
  const seen = new Set<string>();
  for (const entry of rows) {
    const cells = "cells" in entry ? entry.cells : entry;
    const normalized = (cells[emailIndex] ?? "").trim().toLowerCase();
    if (!normalized) continue;
    if (seen.has(normalized)) count += 1;
    else seen.add(normalized);
  }
  return count;
}

export function createContactImportInStore(
  storage: ContactStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly byteCount: number;
    readonly fileName: string;
    readonly headers: readonly string[];
    readonly importId: string;
    readonly malformedRows?:
      | readonly {
          readonly cells: readonly string[];
          readonly error: string;
          readonly rowNumber: number;
        }[]
      | undefined;
    readonly organizationId: string;
    readonly requestId: string;
    readonly rows:
      | readonly (readonly string[])[]
      | readonly {
          readonly cells: readonly string[];
          readonly rowNumber?: number;
        }[];
  },
): {
  readonly importId: string;
  readonly probableDuplicateCount: number;
  readonly rowCount: number;
} {
  if (!organizationIdSchema.safeParse(input.organizationId).success) {
    throw new ContactStoreError("validation_failed", "Invalid organizationId.");
  }
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.importId);
  requireUuid(input.requestId);
  assertOrganization(storage, input.organizationId);
  if (!Number.isInteger(input.byteCount) || input.byteCount < 0) {
    throw new ContactStoreError("validation_failed", "Invalid byte count.");
  }
  if (input.headers.length === 0 || input.headers.length > CONTACT_IMPORT_MAX_HEADERS) {
    throw new ContactStoreError("validation_failed", "Invalid CSV headers.");
  }
  if (input.rows.length > CONTACT_IMPORT_ROWS_MAX) {
    throw new ContactStoreError("validation_failed", "Too many import rows.");
  }
  const malformed = input.malformedRows ?? [];
  const totalRows = input.rows.length + malformed.length;
  if (totalRows > CONTACT_IMPORT_ROWS_MAX) {
    throw new ContactStoreError("validation_failed", "Too many import rows.");
  }
  const now = new Date().toISOString();
  const idempotencyKey = contactImportIdempotencyKey(input.importId);
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO contact_imports
        (id, status, file_name, byte_count, headers_json, mapping_json, list_ids_json,
         idempotency_key, actor_user_id, request_id, row_count,
         processed_rows, invalid_rows, created_at, updated_at)
       VALUES (?, 'staged', ?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.importId,
      input.fileName.slice(0, 255),
      input.byteCount,
      JSON.stringify([...input.headers]),
      idempotencyKey,
      input.actorUserId,
      input.requestId,
      totalRows,
      malformed.length,
      malformed.length,
      now,
      now,
    );
    // Chunked bulk inserts keep one statement bounded while staging up to 10k rows.
    // Rows rejected by the parser are staged as error rows so upload, preview,
    // result, and error-CSV counts stay consistent for the whole file.
    const staged: {
      readonly cells: string[];
      readonly error: string;
      readonly rowNumber: number;
      readonly status: string;
    }[] = [
      ...input.rows.map((entry, index) => {
        if ("cells" in entry) {
          return {
            cells: [...entry.cells],
            error: "",
            rowNumber: entry.rowNumber ?? index + 2,
            status: "pending",
          };
        }
        return {
          cells: [...entry],
          error: "",
          rowNumber: index + 2,
          status: "pending",
        };
      }),
      ...malformed.map((entry) => ({
        cells: [...entry.cells],
        error: entry.error,
        rowNumber: entry.rowNumber,
        status: "error",
      })),
    ];
    staged.sort((left, right) => left.rowNumber - right.rowNumber);
    for (let offset = 0; offset < staged.length; offset += 500) {
      const chunk = staged.slice(offset, offset + 500);
      const valuesSql = chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
      const bindings: unknown[] = [];
      chunk.forEach((entry, chunkIndex) => {
        bindings.push(
          input.importId,
          offset + chunkIndex,
          entry.rowNumber,
          JSON.stringify(entry.cells),
          entry.status,
          entry.error.slice(0, 2000),
        );
      });
      storage.sql.exec(
        `INSERT INTO contact_import_rows (import_id, row_index, row_number, cells_json, status, error) VALUES ${valuesSql}`,
        ...bindings,
      );
    }
    writeAudit(storage, {
      action: "contact_import.staged",
      actorUserId: input.actorUserId,
      importId: input.importId,
      requestId: input.requestId,
      summary: { fileName: input.fileName.slice(0, 255), rowCount: totalRows },
    });
  });
  const probableDuplicateCount = countProbableDuplicates(input.headers, input.rows);
  return { importId: input.importId, probableDuplicateCount, rowCount: totalRows };
}

export function getContactImportFromStore(
  storage: ContactStoreStorage,
  organizationId: string | null,
  importId: string,
): ContactImportSummary {
  assertOrganization(storage, organizationId);
  requireUuid(importId, "contact_import_not_found");
  const row = readImportRow(storage, importId);
  if (!row) throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  return toSummary(storage, row, null);
}

function requireStagedImport(
  storage: ContactStoreStorage,
  organizationId: string | null,
  importId: string,
): ImportRow {
  assertOrganization(storage, organizationId);
  requireUuid(importId, "contact_import_not_found");
  const row = readImportRow(storage, importId);
  if (!row) throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  if (row.status !== "staged") {
    throw new ContactStoreError(
      "contact_import_conflict",
      "The contact import is no longer editable.",
    );
  }
  return row;
}

function assertTargetListsExist(storage: ContactStoreStorage, listIds: readonly string[]): void {
  const unique = [...new Set(listIds)];
  if (unique.length === 0 || unique.length > CONTACT_IMPORT_MAX_LISTS) {
    throw new ContactStoreError("validation_failed", "At least one target list is required.");
  }
  for (const listId of unique) requireUuid(listId);
  const found = new Set(
    storage.sql
      .exec<{ readonly id: string }>(
        `SELECT id FROM contact_lists WHERE id IN (${placeholders(unique.length)})`,
        ...unique,
      )
      .toArray()
      .map((row) => row.id),
  );
  if (found.size !== unique.length) {
    throw new ContactStoreError("contact_list_not_found", "A target contact list was not found.");
  }
}

export function updateContactImportMappingInStore(
  storage: ContactStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly importId: string;
    readonly listIds: readonly string[];
    readonly mapping: readonly string[];
    readonly organizationId: string;
    readonly requestId: string;
  },
): ContactImportSummary {
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.requestId);
  const row = requireStagedImport(storage, input.organizationId, input.importId);
  const headers = parseStringArray(row.headersJson);
  const targets = requireValidMapping(headers, input.mapping);
  assertTargetListsExist(storage, input.listIds);
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE contact_imports SET mapping_json = ?, list_ids_json = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(targets),
      JSON.stringify([...new Set(input.listIds)]),
      now,
      input.importId,
    );
    writeAudit(storage, {
      action: "contact_import.mapping_saved",
      actorUserId: input.actorUserId,
      importId: input.importId,
      requestId: input.requestId,
      summary: { listCount: new Set(input.listIds).size },
    });
  });
  const updated = readImportRow(storage, input.importId);
  if (!updated)
    throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  return toSummary(storage, updated, null);
}

function readAllStagedCells(
  storage: ContactStoreStorage,
  importId: string,
): {
  readonly errorRows: {
    readonly cells: string[];
    readonly error: string;
    readonly rowNumber: number;
  }[];
  readonly pendingRows: { readonly cells: string[]; readonly rowNumber: number }[];
} {
  const errorRows: { cells: string[]; error: string; rowNumber: number }[] = [];
  const pendingRows: { cells: string[]; rowNumber: number }[] = [];
  for (const row of storage.sql
    .exec<StagedRow>(
      `SELECT cells_json AS cellsJson, error, row_number AS rowNumber, status
        FROM contact_import_rows WHERE import_id = ? ORDER BY row_index ASC`,
      importId,
    )
    .toArray()) {
    if (row.status === "error") {
      errorRows.push({
        cells: parseStringArray(row.cellsJson),
        error: row.error || "Row was skipped.",
        rowNumber: row.rowNumber,
      });
    } else {
      pendingRows.push({ cells: parseStringArray(row.cellsJson), rowNumber: row.rowNumber });
    }
  }
  return { errorRows, pendingRows };
}

function readExistingEmailStatuses(
  storage: ContactStoreStorage,
): ReadonlyMap<string, { readonly emailStatus: string; readonly smsStatus: string }> {
  const rows = storage.sql
    .exec<ExistingContactStatusRow>(
      `SELECT c.normalized_email AS normalizedEmail, p.channel AS channel, p.status AS status
        FROM contacts c LEFT JOIN contact_communication_preferences p ON p.contact_id = c.id
        WHERE c.normalized_email IS NOT NULL`,
    )
    .toArray();
  const merged = new Map<string, { emailStatus: string; smsStatus: string }>();
  for (const row of rows) {
    const current = merged.get(row.normalizedEmail) ?? {
      emailStatus: "unknown",
      smsStatus: "unknown",
    };
    if (row.channel === "email" && row.status) current.emailStatus = row.status;
    else if (row.channel === "sms" && row.status) current.smsStatus = row.status;
    merged.set(row.normalizedEmail, { ...current });
  }
  return merged;
}

export function previewContactImportFromStore(
  storage: ContactStoreStorage,
  organizationId: string | null,
  importId: string,
): ContactImportSummary & { readonly preview: ContactImportPreview } {
  const row = requireStagedImport(storage, organizationId, importId);
  const headers = parseStringArray(row.headersJson);
  const mappingRaw = parseStringArray(row.mappingJson);
  if (mappingRaw.length !== headers.length) {
    throw new ContactStoreError(
      "contact_import_conflict",
      "Save a column mapping before previewing.",
    );
  }
  const targets = requireValidMapping(headers, mappingRaw);
  const staged = readAllStagedCells(storage, importId);
  const { preview } = previewContactImport({
    existingByEmail: readExistingEmailStatuses(storage),
    headers,
    malformedRows: staged.errorRows,
    rows: staged.pendingRows.map((entry) => entry.cells),
    targets,
  });
  return { ...toSummary(storage, row, preview), preview };
}

export function confirmContactImportInStore(
  storage: ContactStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly importId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
): {
  readonly idempotencyKey: string;
  readonly importId: string;
  readonly status: ContactImportJobStatus;
} {
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.requestId);
  assertOrganization(storage, input.organizationId);
  requireUuid(input.importId, "contact_import_not_found");
  const existing = readImportRow(storage, input.importId);
  if (!existing)
    throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  // Confirm is idempotent: a repeated confirm (queue retry, double click)
  // returns the same job without duplicating outbox work or mutations.
  if (
    existing.status === "confirmed" ||
    existing.status === "processing" ||
    existing.status === "completed"
  ) {
    return {
      idempotencyKey: existing.idempotencyKey,
      importId: existing.id,
      status: parseImportStatus(existing.status),
    };
  }
  if (existing.status !== "staged") {
    throw new ContactStoreError(
      "contact_import_conflict",
      "The contact import cannot be confirmed.",
    );
  }
  const headers = parseStringArray(existing.headersJson);
  const mappingRaw = parseStringArray(existing.mappingJson);
  if (mappingRaw.length !== headers.length) {
    throw new ContactStoreError(
      "contact_import_conflict",
      "Save a column mapping before confirming.",
    );
  }
  requireValidMapping(headers, mappingRaw);
  const listIds = parseStringArray(existing.listIdsJson);
  assertTargetListsExist(storage, listIds);
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE contact_imports SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'staged'",
      now,
      now,
      input.importId,
    );
    // The outbox row drives the async queue job; INSERT OR IGNORE keeps a
    // retried confirm from enqueueing a second delivery for the same import.
    storage.sql.exec(
      `INSERT OR IGNORE INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'contact_import', ?, ?, ?)`,
      input.importId,
      existing.idempotencyKey,
      now,
      now,
    );
    writeAudit(storage, {
      action: "contact_import.confirmed",
      actorUserId: input.actorUserId,
      importId: input.importId,
      requestId: input.requestId,
      summary: {
        listCount: listIds.length,
        rowCount: readCounters(storage, input.importId).rowCount,
      },
    });
  });
  return { idempotencyKey: existing.idempotencyKey, importId: existing.id, status: "confirmed" };
}

export function cancelContactImportInStore(
  storage: ContactStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly importId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
): { readonly importId: string; readonly status: "cancelled" } {
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.requestId);
  const row = requireStagedImport(storage, input.organizationId, input.importId);
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM contact_import_rows WHERE import_id = ?", input.importId);
    storage.sql.exec("DELETE FROM contact_imports WHERE id = ?", input.importId);
    writeAudit(storage, {
      action: "contact_import.cancelled",
      actorUserId: input.actorUserId,
      importId: input.importId,
      requestId: input.requestId,
      summary: { fileName: row.fileName },
    });
  });
  return { importId: input.importId, status: "cancelled" };
}

interface BatchPendingRow {
  readonly cells: string[];
  readonly rowIndex: number;
  readonly rowNumber: number;
}

interface MatchedContactSnapshot {
  readonly displayName: string | null;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly id: string;
  readonly lastName: string | null;
  readonly phone: string | null;
  readonly source: string | null;
}

function readPendingBatch(
  storage: ContactStoreStorage,
  importId: string,
  batchSize: number,
): BatchPendingRow[] {
  return storage.sql
    .exec<StagedRow>(
      `SELECT row_index AS rowIndex, row_number AS rowNumber, cells_json AS cellsJson
        FROM contact_import_rows WHERE import_id = ? AND status = 'pending'
        ORDER BY row_index ASC LIMIT ?`,
      importId,
      batchSize,
    )
    .toArray()
    .map((row) => ({
      cells: parseStringArray(row.cellsJson),
      rowIndex: row.rowIndex,
      rowNumber: row.rowNumber,
    }));
}

function readSeenDedupeKeys(
  storage: ContactStoreStorage,
  importId: string,
  batchKeys: readonly string[],
): Set<string> {
  const distinct = [...new Set(batchKeys)];
  if (distinct.length === 0) return new Set();
  const placeholders = distinct.map(() => "?").join(", ");
  return new Set(
    storage.sql
      .exec<{ readonly dedupeKey: string }>(
        `SELECT dedupe_key AS dedupeKey FROM contact_import_rows WHERE import_id = ? AND dedupe_key IN (${placeholders})`,
        importId,
        ...distinct,
      )
      .toArray()
      .map((row) => row.dedupeKey),
  );
}

function markRow(
  storage: ContactStoreStorage,
  importId: string,
  rowIndex: number,
  status: "done" | "error" | "skipped",
  error: string,
  contactId: string | null,
  dedupeKey: string | null,
): void {
  storage.sql.exec(
    `UPDATE contact_import_rows
      SET status = ?, error = ?, contact_id = ?, dedupe_key = ?
      WHERE import_id = ? AND row_index = ? AND status = 'pending'`,
    status,
    error.slice(0, 2000),
    contactId,
    dedupeKey,
    importId,
    rowIndex,
  );
}

function nonBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface ValidatedImportRow {
  readonly entry: BatchPendingRow;
  readonly record: ContactImportRecord;
  readonly result: ContactImportValidatedRow;
}

interface BatchMatchMaps {
  readonly contactsByEmail: Map<string, string>;
  readonly contactsByPhone: Map<string, string>;
  readonly preferencesByContact: Map<
    string,
    { readonly emailStatus: string; readonly smsStatus: string }
  >;
  readonly seen: Set<string>;
  readonly snapshots: Map<string, MatchedContactSnapshot>;
}

interface BatchTallies {
  contactsCreated: number;
  contactsUpdated: number;
  existingMatches: number;
  inFileDuplicates: number;
  invalidRows: number;
  suppressedPreserved: number;
}

interface BatchContext {
  readonly actorUserId: string;
  readonly importId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

interface ImportContactPatch {
  readonly displayName?: string | null;
  readonly email?: string | null;
  readonly emailStatus: "subscribed" | "unknown" | "unsubscribed";
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly phone?: string | null;
  readonly preferenceSource?: string | null;
  readonly smsStatus: "subscribed" | "unknown" | "unsubscribed";
  readonly source?: string | null;
}

interface FillPatchDraft {
  displayName?: string | null;
  email?: string | null;
  emailStatus: "subscribed" | "unknown" | "unsubscribed";
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  preferenceSource?: string | null;
  smsStatus: "subscribed" | "unknown" | "unsubscribed";
  source?: string | null;
}

const FILL_PATCH_FIELDS = [
  "firstName",
  "lastName",
  "displayName",
  "email",
  "phone",
  "source",
] as const;

function fillBlankScalars(
  patch: FillPatchDraft,
  snapshot: MatchedContactSnapshot,
  record: ContactImportRecord,
): void {
  for (const field of FILL_PATCH_FIELDS) {
    if (!snapshot[field] && nonBlank(record[field])) {
      patch[field] = record[field].trim();
    }
  }
}

function prepareBatchRows(
  pending: readonly BatchPendingRow[],
  headers: readonly string[],
  targets: readonly ContactImportTarget[],
): ValidatedImportRow[] {
  return pending.map((entry) => {
    const record = applyContactImportMapping(entry.cells, headers, targets);
    return { entry, record, result: validateContactImportRecord(record, entry.rowNumber) };
  });
}

function loadBatchMatchMaps(
  storage: ContactStoreStorage,
  importId: string,
  validated: readonly ValidatedImportRow[],
): BatchMatchMaps {
  // One batched lookup per match key for the whole batch (never per-row N+1).
  const emails: string[] = [];
  const phones: string[] = [];
  const batchKeys: string[] = [];
  for (const row of validated) {
    if (row.result.errors.length > 0) continue;
    if (row.result.normalizedEmail) emails.push(row.result.normalizedEmail);
    else if (row.result.normalizedPhone) phones.push(row.result.normalizedPhone);
    const key = contactImportDedupeKey(row.result.normalizedEmail, row.result.normalizedPhone);
    if (key !== null) batchKeys.push(key);
  }
  const contactsByEmail = readContactsByNormalizedEmail(storage, emails);
  const contactsByPhone = readContactsByNormalizedPhone(storage, phones);
  const snapshots = readContactSnapshots(storage, [
    ...contactsByEmail.values(),
    ...contactsByPhone.values(),
  ]);
  return {
    contactsByEmail,
    contactsByPhone,
    preferencesByContact: readPreferenceStatuses(storage, [...snapshots.keys()]),
    seen: readSeenDedupeKeys(storage, importId, batchKeys),
    snapshots,
  };
}

function resolveRowMatch(
  maps: BatchMatchMaps,
  normalizedEmail: string | null,
  normalizedPhone: string | null,
): string | undefined {
  if (normalizedEmail) return maps.contactsByEmail.get(normalizedEmail);
  if (normalizedPhone) return maps.contactsByPhone.get(normalizedPhone);
  return undefined;
}

/**
 * Conservative update: fill only blank stored scalars, merge statuses through
 * the Phase 1 helper (an existing unsubscribe always wins over an imported
 * subscribe, while an imported unsubscribe may unsubscribe).
 */
function buildFillPatch(
  snapshot: MatchedContactSnapshot | undefined,
  record: ContactImportRecord,
): ImportContactPatch {
  const patch: FillPatchDraft = {
    emailStatus: parseContactImportStatus(record.emailStatus) ?? "unknown",
    smsStatus: parseContactImportStatus(record.smsStatus) ?? "unknown",
  };
  if (snapshot) fillBlankScalars(patch, snapshot, record);
  if (nonBlank(record.consentSource)) patch.preferenceSource = record.consentSource.trim();
  return patch;
}

function updateMatchedContact(
  storage: ContactStoreStorage,
  context: BatchContext,
  maps: BatchMatchMaps,
  tallies: BatchTallies,
  touched: Set<string>,
  matchedId: string,
  record: ContactImportRecord,
  key: string | null,
  rowIndex: number,
): void {
  tallies.existingMatches += 1;
  const preferences = maps.preferencesByContact.get(matchedId) ?? {
    emailStatus: "unknown",
    smsStatus: "unknown",
  };
  const patch = buildFillPatch(maps.snapshots.get(matchedId), record);
  if (
    (preferences.emailStatus === "unsubscribed" || preferences.emailStatus === "suppressed") &&
    patch.emailStatus === "subscribed"
  ) {
    tallies.suppressedPreserved += 1;
  }
  updateContactInStore(storage, {
    actorUserId: context.actorUserId,
    contactId: matchedId,
    organizationId: context.organizationId,
    requestId: context.requestId,
    ...patch,
  });
  tallies.contactsUpdated += 1;
  touched.add(matchedId);
  markRow(storage, context.importId, rowIndex, "done", "", matchedId, key);
}

function snapshotCreatedContact(
  maps: BatchMatchMaps,
  contact: {
    readonly displayName?: string | null | undefined;
    readonly email?: string | null | undefined;
    readonly firstName?: string | null | undefined;
    readonly id: string;
    readonly lastName?: string | null | undefined;
    readonly phone?: string | null | undefined;
    readonly source?: string | null | undefined;
  },
): void {
  maps.snapshots.set(contact.id, {
    displayName: contact.displayName ?? null,
    email: contact.email ?? null,
    firstName: contact.firstName ?? null,
    id: contact.id,
    lastName: contact.lastName ?? null,
    phone: contact.phone ?? null,
    source: contact.source ?? null,
  });
}

function createImportedContact(
  storage: ContactStoreStorage,
  context: BatchContext,
  maps: BatchMatchMaps,
  tallies: BatchTallies,
  touched: Set<string>,
  record: ContactImportRecord,
  result: ContactImportValidatedRow,
  key: string | null,
  rowIndex: number,
): void {
  const created = createContactInStore(storage, {
    actorUserId: context.actorUserId,
    contactId: crypto.randomUUID(),
    displayName: nonBlank(record.displayName),
    email: nonBlank(record.email),
    emailStatus: parseContactImportStatus(record.emailStatus) ?? "unknown",
    firstName: nonBlank(record.firstName),
    lastName: nonBlank(record.lastName),
    organizationId: context.organizationId,
    phone: nonBlank(record.phone),
    preferenceSource: nonBlank(record.consentSource),
    requestId: context.requestId,
    smsStatus: parseContactImportStatus(record.smsStatus) ?? "unknown",
    source: nonBlank(record.source),
  });
  if (result.normalizedEmail) maps.contactsByEmail.set(result.normalizedEmail, created.contact.id);
  else if (result.normalizedPhone) {
    maps.contactsByPhone.set(result.normalizedPhone, created.contact.id);
  }
  snapshotCreatedContact(maps, created.contact);
  tallies.contactsCreated += 1;
  touched.add(created.contact.id);
  markRow(storage, context.importId, rowIndex, "done", "", created.contact.id, key);
}

function applyBatchRow(
  storage: ContactStoreStorage,
  context: BatchContext,
  maps: BatchMatchMaps,
  tallies: BatchTallies,
  touched: Set<string>,
  row: ValidatedImportRow,
): void {
  const { entry, record, result } = row;
  if (result.errors.length > 0) {
    tallies.invalidRows += 1;
    markRow(
      storage,
      context.importId,
      entry.rowIndex,
      "error",
      result.errors.join(" "),
      null,
      null,
    );
    return;
  }
  const key = contactImportDedupeKey(result.normalizedEmail, result.normalizedPhone);
  if (key !== null) {
    if (maps.seen.has(key)) {
      tallies.inFileDuplicates += 1;
      markRow(
        storage,
        context.importId,
        entry.rowIndex,
        "skipped",
        "Duplicate contact within this file.",
        null,
        key,
      );
      return;
    }
    maps.seen.add(key);
  }
  const matchedId = resolveRowMatch(maps, result.normalizedEmail, result.normalizedPhone);
  try {
    if (matchedId) {
      updateMatchedContact(
        storage,
        context,
        maps,
        tallies,
        touched,
        matchedId,
        record,
        key,
        entry.rowIndex,
      );
    } else {
      createImportedContact(
        storage,
        context,
        maps,
        tallies,
        touched,
        record,
        result,
        key,
        entry.rowIndex,
      );
    }
  } catch (error: unknown) {
    // Row-level failures (duplicate race, validation) never abort the batch;
    // unexpected failures propagate so the queue consumer retries the batch.
    if (error instanceof ContactStoreError) {
      tallies.invalidRows += 1;
      markRow(storage, context.importId, entry.rowIndex, "error", error.message, null, null);
      return;
    }
    throw error;
  }
}

/**
 * One idempotent membership add per target list for every contact touched by
 * this batch (INSERT OR IGNORE inside the store keeps replays at zero).
 */
function addBatchMemberships(
  storage: ContactStoreStorage,
  context: BatchContext,
  listIds: readonly string[],
  touched: Set<string>,
): number {
  const contactIds = [...touched];
  if (contactIds.length === 0) return 0;
  let membershipsAdded = 0;
  for (const listId of listIds) {
    membershipsAdded += addContactsToListInStore(storage, {
      actorUserId: context.actorUserId,
      contactIds,
      listId,
      organizationId: context.organizationId,
      requestId: context.requestId,
    }).added;
  }
  return membershipsAdded;
}

function recordBatchTallies(
  storage: ContactStoreStorage,
  context: BatchContext,
  processed: number,
  tallies: BatchTallies,
  membershipsAdded: number,
): void {
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE contact_imports SET processed_rows = processed_rows + ?,
        contacts_created = contacts_created + ?, contacts_updated = contacts_updated + ?,
        existing_matches = existing_matches + ?, in_file_duplicates = in_file_duplicates + ?,
        invalid_rows = invalid_rows + ?, suppressed_preserved = suppressed_preserved + ?,
        memberships_added = memberships_added + ?, updated_at = ? WHERE id = ?`,
      processed,
      tallies.contactsCreated,
      tallies.contactsUpdated,
      tallies.existingMatches,
      tallies.inFileDuplicates,
      tallies.invalidRows,
      tallies.suppressedPreserved,
      membershipsAdded,
      now,
      context.importId,
    );
    writeAudit(storage, {
      action: "contact_import.batch_processed",
      actorUserId: context.actorUserId,
      importId: context.importId,
      requestId: context.requestId,
      summary: {
        batchSize: processed,
        contactsCreated: tallies.contactsCreated,
        contactsUpdated: tallies.contactsUpdated,
        invalidRows: tallies.invalidRows,
      },
    });
  });
}

/**
 * Processes the next bounded batch of a confirmed import. Each row mutation
 * is idempotent by match key (normalized email, then normalized phone), so a
 * crash halfway through simply resumes: already-marked rows are skipped and
 * rows created before the crash match by email instead of duplicating.
 * Reprocessing a completed import performs zero mutations.
 */
export function processContactImportBatchInStore(
  storage: ContactStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly batchSize?: number | undefined;
    readonly importId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
): ContactImportBatchResult {
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.requestId);
  assertOrganization(storage, input.organizationId);
  requireUuid(input.importId, "contact_import_not_found");
  const batchSize = Math.min(Math.max(input.batchSize ?? CONTACT_IMPORT_BATCH_SIZE, 1), 500);
  const job = readImportRow(storage, input.importId);
  if (!job) throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") {
    return {
      completed: job.status === "completed",
      processedThisBatch: 0,
      summary: toSummary(storage, job, null),
    };
  }
  if (job.status !== "confirmed" && job.status !== "processing") {
    throw new ContactStoreError(
      "contact_import_conflict",
      "Confirm the contact import before processing.",
    );
  }
  const headers = parseStringArray(job.headersJson);
  const targets = requireValidMapping(headers, parseStringArray(job.mappingJson));
  const listIds = [...new Set(parseStringArray(job.listIdsJson))];
  assertTargetListsExistOrFail(storage, input.importId, listIds);

  if (job.status === "confirmed") {
    storage.sql.exec(
      "UPDATE contact_imports SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'confirmed'",
      new Date().toISOString(),
      input.importId,
    );
  }

  const pending = readPendingBatch(storage, input.importId, batchSize);
  if (pending.length === 0) {
    return {
      completed: finalizeImport(storage, {
        actorUserId: input.actorUserId,
        importId: input.importId,
        requestId: input.requestId,
      }),
      processedThisBatch: 0,
      summary: finishSummary(storage, input.importId),
    };
  }

  const context: BatchContext = {
    actorUserId: input.actorUserId,
    importId: input.importId,
    organizationId: input.organizationId,
    requestId: input.requestId,
  };
  const validated = prepareBatchRows(pending, headers, targets);
  const maps = loadBatchMatchMaps(storage, input.importId, validated);
  const tallies: BatchTallies = {
    contactsCreated: 0,
    contactsUpdated: 0,
    existingMatches: 0,
    inFileDuplicates: 0,
    invalidRows: 0,
    suppressedPreserved: 0,
  };
  const touchedContactIds = new Set<string>();
  for (const row of validated) {
    applyBatchRow(storage, context, maps, tallies, touchedContactIds, row);
  }
  const membershipsAdded = addBatchMemberships(storage, context, listIds, touchedContactIds);
  recordBatchTallies(storage, context, pending.length, tallies, membershipsAdded);

  const remaining =
    storage.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM contact_import_rows WHERE import_id = ? AND status = 'pending'",
        input.importId,
      )
      .toArray()
      .at(0)?.count ?? 0;
  const completed =
    remaining === 0
      ? finalizeImport(storage, {
          actorUserId: input.actorUserId,
          importId: input.importId,
          requestId: input.requestId,
        })
      : false;
  return {
    completed,
    processedThisBatch: pending.length,
    summary: finishSummary(storage, input.importId),
  };
}

function assertTargetListsExistOrFail(
  storage: ContactStoreStorage,
  importId: string,
  listIds: readonly string[],
): void {
  try {
    assertTargetListsExist(storage, listIds);
  } catch (error: unknown) {
    if (error instanceof ContactStoreError) {
      const now = new Date().toISOString();
      storage.sql.exec(
        "UPDATE contact_imports SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?",
        error.code,
        now,
        importId,
      );
    }
    throw error;
  }
}

function finalizeImport(
  storage: ContactStoreStorage,
  input: { readonly actorUserId: string; readonly importId: string; readonly requestId: string },
): boolean {
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE contact_imports SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('confirmed', 'processing')`,
      now,
      now,
      input.importId,
    );
    const row = readImportRow(storage, input.importId);
    if (
      row &&
      (row.status === "completed" || row.status === "processing" || row.status === "confirmed")
    ) {
      writeAudit(storage, {
        action: "contact_import.completed",
        actorUserId: input.actorUserId,
        importId: input.importId,
        requestId: input.requestId,
        summary: readCounters(storage, input.importId),
      });
    }
  });
  return true;
}

function finishSummary(storage: ContactStoreStorage, importId: string): ContactImportSummary {
  const row = readImportRow(storage, importId);
  if (!row) throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  return toSummary(storage, row, null);
}

function readContactsByNormalizedEmail(
  storage: ContactStoreStorage,
  emails: readonly string[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (emails.length === 0) return result;
  const unique = [...new Set(emails)];
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500);
    for (const row of storage.sql
      .exec<{ readonly id: string; readonly normalizedEmail: string }>(
        `SELECT id, normalized_email AS normalizedEmail FROM contacts WHERE normalized_email IN (${placeholders(chunk.length)})`,
        ...chunk,
      )
      .toArray()) {
      result.set(row.normalizedEmail, row.id);
    }
  }
  return result;
}

function readContactsByNormalizedPhone(
  storage: ContactStoreStorage,
  phones: readonly string[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (phones.length === 0) return result;
  // First contact wins per phone number; a Set tracks claimed contacts so the
  // dedup stays O(N) instead of scanning accumulated values per row.
  const claimedContactIds = new Set<string>();
  const unique = [...new Set(phones)];
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500);
    for (const row of storage.sql
      .exec<{ readonly id: string; readonly normalizedPhone: string }>(
        `SELECT id, normalized_phone AS normalizedPhone FROM contacts WHERE normalized_phone IN (${placeholders(chunk.length)})`,
        ...chunk,
      )
      .toArray()) {
      if (!result.has(row.normalizedPhone) && !claimedContactIds.has(row.id)) {
        result.set(row.normalizedPhone, row.id);
        claimedContactIds.add(row.id);
      }
    }
  }
  return result;
}

function readContactSnapshots(
  storage: ContactStoreStorage,
  contactIds: readonly string[],
): Map<string, MatchedContactSnapshot> {
  const result = new Map<string, MatchedContactSnapshot>();
  const unique = [...new Set(contactIds)];
  if (unique.length === 0) return result;
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500);
    for (const row of storage.sql
      .exec<ContactSnapshotRow>(
        `SELECT id, first_name AS firstName, last_name AS lastName, display_name AS displayName,
          email, phone, source FROM contacts WHERE id IN (${placeholders(chunk.length)})`,
        ...chunk,
      )
      .toArray()) {
      result.set(row.id, {
        displayName: row.displayName ?? null,
        email: row.email ?? null,
        firstName: row.firstName ?? null,
        id: row.id,
        lastName: row.lastName ?? null,
        phone: row.phone ?? null,
        source: row.source ?? null,
      });
    }
  }
  return result;
}

function readPreferenceStatuses(
  storage: ContactStoreStorage,
  contactIds: readonly string[],
): Map<string, { readonly emailStatus: string; readonly smsStatus: string }> {
  const result = new Map<string, { emailStatus: string; smsStatus: string }>();
  const unique = [...new Set(contactIds)];
  if (unique.length === 0) return result;
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500);
    for (const row of storage.sql
      .exec<PreferenceStatusRow>(
        `SELECT contact_id AS contactId, channel, status FROM contact_communication_preferences
          WHERE contact_id IN (${placeholders(chunk.length)})`,
        ...chunk,
      )
      .toArray()) {
      const current = result.get(row.contactId) ?? { emailStatus: "unknown", smsStatus: "unknown" };
      if (row.channel === "email")
        result.set(row.contactId, { ...current, emailStatus: row.status });
      else if (row.channel === "sms")
        result.set(row.contactId, { ...current, smsStatus: row.status });
      else result.set(row.contactId, current);
    }
  }
  return result;
}

export function readContactImportErrorCsvFromStore(
  storage: ContactStoreStorage,
  organizationId: string | null,
  importId: string,
): { readonly csv: string; readonly headers: readonly string[]; readonly rowCount: number } {
  assertOrganization(storage, organizationId);
  requireUuid(importId, "contact_import_not_found");
  const job = readImportRow(storage, importId);
  if (!job) throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  const headers = parseStringArray(job.headersJson);
  const errorRows = storage.sql
    .exec<StagedRow>(
      `SELECT cells_json AS cellsJson, error, row_number AS rowNumber
        FROM contact_import_rows WHERE import_id = ? AND status IN ('error', 'skipped')
        ORDER BY row_number ASC`,
      importId,
    )
    .toArray()
    .map((row) => ({
      cells: parseStringArray(row.cellsJson),
      error: row.error || "Row was skipped.",
      rowNumber: row.rowNumber,
    }));
  return {
    csv: renderContactImportErrorCsv(headers, errorRows),
    headers,
    rowCount: errorRows.length,
  };
}
