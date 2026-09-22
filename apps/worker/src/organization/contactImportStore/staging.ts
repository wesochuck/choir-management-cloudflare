import { CONTACT_IMPORT_MAX_HEADERS, CONTACT_IMPORT_ROWS_MAX } from "@choir/domain";

import { ContactStoreError, type ContactStoreStorage } from "../contactStore";
import {
  contactImportIdempotencyKey,
  type ContactImportJobStatus,
  type ContactImportSummary,
} from "./contracts";
import {
  actorUserIdSchema,
  assertOrganization,
  assertTargetListsExist,
  countProbableDuplicates,
  organizationIdSchema,
  parseImportStatus,
  parseStringArray,
  readCounters,
  readImportRow,
  requireStagedImport,
  requireUuid,
  requireValidMapping,
  toSummary,
  writeAudit,
} from "./shared";

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
