import {
  CONTACT_IMPORT_BATCH_SIZE,
  applyContactImportMapping,
  contactImportDedupeKey,
  parseContactImportStatus,
  validateContactImportRecord,
  type ContactImportRecord,
  type ContactImportTarget,
  type ContactImportValidatedRow,
} from "@choir/domain";

import {
  addContactsToListInStore,
  ContactStoreError,
  createContactInStore,
  updateContactInStore,
  type ContactStoreStorage,
} from "../contactStore";
import type {
  BatchPendingRow,
  ContactImportBatchResult,
  ContactImportSummary,
  ContactSnapshotRow,
  PreferenceStatusRow,
  StagedRow,
  ValidatedImportRow,
} from "./contracts";
import {
  actorUserIdSchema,
  assertOrganization,
  assertTargetListsExist,
  parseStringArray,
  placeholders,
  readCounters,
  readImportRow,
  requireUuid,
  requireValidMapping,
  toSummary,
  writeAudit,
} from "./shared";

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
  const placeholdersSql = distinct.map(() => "?").join(", ");
  return new Set(
    storage.sql
      .exec<{ readonly dedupeKey: string }>(
        `SELECT dedupe_key AS dedupeKey FROM contact_import_rows WHERE import_id = ? AND dedupe_key IN (${placeholdersSql})`,
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

function nonBlank(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    if (error instanceof ContactStoreError) {
      tallies.invalidRows += 1;
      markRow(storage, context.importId, entry.rowIndex, "error", error.message, null, null);
      return;
    }
    throw error;
  }
}

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
