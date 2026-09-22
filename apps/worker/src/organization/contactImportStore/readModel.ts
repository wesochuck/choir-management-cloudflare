import {
  previewContactImport,
  renderContactImportErrorCsv,
  type ContactImportPreview,
} from "@choir/domain";

import { ContactStoreError, type ContactStoreStorage } from "../contactStore";
import type { ContactImportSummary, ExistingContactStatusRow, StagedRow } from "./contracts";
import {
  assertOrganization,
  parseStringArray,
  readImportRow,
  requireStagedImport,
  requireUuid,
  requireValidMapping,
  toSummary,
} from "./shared";

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

function readAllStagedCells(
  storage: ContactStoreStorage,
  importId: string,
): {
  readonly errorRows: readonly {
    readonly cells: readonly string[];
    readonly error: string;
    readonly rowNumber: number;
  }[];
  readonly pendingRows: readonly {
    readonly cells: readonly string[];
    readonly rowNumber: number;
  }[];
} {
  const rows = storage.sql
    .exec<StagedRow>(
      `SELECT cells_json AS cellsJson, error, row_number AS rowNumber, status
        FROM contact_import_rows WHERE import_id = ? ORDER BY row_index ASC`,
      importId,
    )
    .toArray();
  const errorRows: { cells: string[]; error: string; rowNumber: number }[] = [];
  const pendingRows: { cells: string[]; rowNumber: number }[] = [];
  for (const row of rows) {
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
