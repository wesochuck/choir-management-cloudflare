import {
  CONTACT_IMPORT_MAX_LISTS,
  ContactImportError,
  suggestContactImportMapping,
  validateContactImportMapping,
  type ContactImportPreview,
  type ContactImportTarget,
} from "@choir/domain";
import { z } from "zod";

import { ContactStoreError, type ContactStoreStorage } from "../contactStore";
import type {
  ContactImportCounterRow,
  ContactImportJobStatus,
  ContactImportSummary,
  ImportRow,
  StagedRow,
} from "./contracts";

export const uuidSchema = z.uuid();
export const organizationIdSchema = z.string().min(1).max(128);
export const actorUserIdSchema = z.string().min(1).max(128);

export function requireUuid(
  value: string,
  code: "contact_import_not_found" | "validation_failed" = "validation_failed",
): void {
  if (!uuidSchema.safeParse(value).success) {
    throw new ContactStoreError(code, "Expected a UUID.");
  }
}

export function assertOrganization(
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
    .exec<{ readonly organizationId: string }>(
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

export function requireValidMapping(
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

export function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function readImportRow(
  storage: ContactStoreStorage,
  importId: string,
): ImportRow | undefined {
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

export function readCounters(
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

export function countErrorRows(storage: ContactStoreStorage, importId: string): number {
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

export function readSampleRows(storage: ContactStoreStorage, importId: string): string[][] {
  return storage.sql
    .exec<StagedRow>(
      "SELECT cells_json AS cellsJson FROM contact_import_rows WHERE import_id = ? ORDER BY row_index ASC LIMIT 5",
      importId,
    )
    .toArray()
    .map((row) => parseStringArray(row.cellsJson));
}

export const IMPORT_STATUSES: readonly ContactImportJobStatus[] = [
  "staged",
  "confirmed",
  "processing",
  "completed",
  "failed",
  "cancelled",
];

export function parseImportStatus(value: string): ContactImportJobStatus {
  const found = IMPORT_STATUSES.find((status) => status === value);
  if (!found) throw new ContactStoreError("contact_import_not_found", "Contact import not found.");
  return found;
}

export function resolveStoredMapping(
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

export function readImportTimestamps(
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

export function toSummary(
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

export function writeAudit(
  storage: ContactStoreStorage,
  params: {
    readonly action: string;
    readonly actorUserId: string;
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

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function countProbableDuplicates(
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

export function requireStagedImport(
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

export function assertTargetListsExist(
  storage: ContactStoreStorage,
  listIds: readonly string[],
): void {
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
