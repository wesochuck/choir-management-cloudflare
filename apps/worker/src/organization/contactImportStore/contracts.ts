import type {
  ContactImportRecord,
  ContactImportTarget,
  ContactImportValidatedRow,
} from "@choir/domain";
import type { SqlStorageValue } from "@cloudflare/workers-types";

export function contactImportIdempotencyKey(importId: string): string {
  return `contact-import:${importId}`;
}

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

export interface ImportRow {
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

export interface StagedRow {
  readonly [column: string]: SqlStorageValue;
  readonly cellsJson: string;
  readonly contactId: string | null;
  readonly dedupeKey: string | null;
  readonly error: string;
  readonly rowIndex: number;
  readonly rowNumber: number;
  readonly status: string;
}

export interface ExistingContactStatusRow {
  readonly [column: string]: SqlStorageValue;
  readonly channel: string | null;
  readonly normalizedEmail: string;
  readonly status: string | null;
}

export interface ContactImportCounterRow {
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

export interface ContactSnapshotRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly id: string;
  readonly lastName: string | null;
  readonly phone: string | null;
  readonly source: string | null;
}

export interface PreferenceStatusRow {
  readonly [column: string]: SqlStorageValue;
  readonly channel: string;
  readonly contactId: string;
  readonly status: string;
}

export interface BatchPendingRow {
  readonly cells: readonly string[];
  readonly rowIndex: number;
  readonly rowNumber: number;
}

export interface ValidatedImportRow {
  readonly entry: BatchPendingRow;
  readonly record: ContactImportRecord;
  readonly result: ContactImportValidatedRow;
}

export interface RowContactMatch {
  readonly contactId: string;
  readonly matchType: "email" | "phone";
}

export interface AppliedRowEffect {
  readonly contactId: string;
  readonly effect: "created" | "updated";
  readonly existingEmailStatus: string | null;
  readonly existingSmsStatus: string | null;
}
