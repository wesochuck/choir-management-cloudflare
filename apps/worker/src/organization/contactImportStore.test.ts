import type { SqlStorageValue } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  CONTACT_IMPORT_ROWS_MAX,
  parseContactImportCsv,
  validateContactImportMapping,
  type ContactImportTarget,
} from "@choir/domain";
import {
  cancelContactImportInStore,
  confirmContactImportInStore,
  createContactImportInStore,
  getContactImportFromStore,
  previewContactImportFromStore,
  processContactImportBatchInStore,
  readContactImportErrorCsvFromStore,
  updateContactImportMappingInStore,
} from "./contactImportStore";
import {
  ContactStoreError,
  createContactInStore,
  createContactListInStore,
  listContactsFromStore,
  type ContactStoreStorage,
} from "./contactStore";
import { organizationSchemaMigrations } from "./schema/migrations";

const ORG_ID = "org-contact-import-test";
const OTHER_ORG_ID = "org-contact-import-other";
const ACTOR_ID = "user-import-tester";

function uuidFor(index: number): string {
  return `cccccccc-cccc-4ccc-8ccc-${index.toString(16).padStart(12, "0")}`;
}

function toSupportedValue(value: unknown): null | number | bigint | string | Uint8Array {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new Error(`Unsupported SQLite binding type: ${typeof value}`);
}

function isReadQuery(query: string): boolean {
  const normalized = query.trim().toUpperCase();
  return (
    normalized.startsWith("SELECT") ||
    normalized.startsWith("PRAGMA") ||
    normalized.startsWith("EXPLAIN") ||
    normalized.startsWith("WITH")
  );
}

function descriptorValue(row: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(row, key)?.value;
}

function isRowArray<T>(value: unknown, fallback: readonly T[]): value is T[] {
  return Array.isArray(value) && fallback.length >= 0;
}

function isCountRow(value: unknown): value is { readonly count: number } {
  if (typeof value !== "object" || value === null) return false;
  if (!("count" in value)) return false;
  return typeof descriptorValue(value, "count") === "number";
}

function isVersionRow(value: unknown): value is { readonly version: number } {
  if (typeof value !== "object" || value === null) return false;
  if (!("version" in value)) return false;
  return typeof descriptorValue(value, "version") === "number";
}

function isListIdRow(value: unknown): value is { readonly listId: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("listId" in value)) return false;
  return typeof descriptorValue(value, "listId") === "string";
}

function dbAllUnknown(db: DatabaseSync, query: string, ...params: readonly unknown[]): unknown[] {
  const raw: unknown = db.prepare(query).all(...params.map(toSupportedValue));
  return Array.isArray(raw) ? raw : [];
}

function countFor(db: DatabaseSync, query: string, ...params: readonly unknown[]): number {
  for (const row of dbAllUnknown(db, query, ...params)) {
    if (isCountRow(row)) return row.count;
  }
  return 0;
}

function createStorage(db: DatabaseSync): ContactStoreStorage {
  let depth = 0;
  const exec = <T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: readonly unknown[]
  ): { readonly one: () => T; readonly toArray: () => T[] } & Iterable<T> => {
    const statement = db.prepare(query);
    const params = bindings.map(toSupportedValue);
    if (isReadQuery(query)) {
      const raw: unknown = statement.all(...params);
      const fallback: readonly T[] = [];
      const rows: T[] = isRowArray(raw, fallback) ? raw : [];
      return {
        *[Symbol.iterator]() {
          yield* rows;
        },
        one(): T {
          const first = rows[0];
          if (first === undefined) throw new Error("Expected exactly one row.");
          return first;
        },
        toArray(): T[] {
          return rows;
        },
      };
    }
    statement.run(...params);
    const empty: T[] = [];
    return {
      *[Symbol.iterator]() {
        yield* empty;
      },
      one(): T {
        throw new Error("Expected exactly one row.");
      },
      toArray(): T[] {
        return empty;
      },
    };
  };
  return {
    sql: { exec },
    transactionSync<T>(fn: () => T): T {
      if (depth > 0) return fn();
      db.exec("BEGIN");
      depth += 1;
      try {
        const result = fn();
        depth -= 1;
        db.exec("COMMIT");
        return result;
      } catch (error: unknown) {
        depth -= 1;
        try {
          db.exec("ROLLBACK");
        } catch {
          // Preserve the original error when rollback itself fails.
        }
        throw error;
      }
    },
  };
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS organization_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = new Set<number>();
  for (const row of dbAllUnknown(db, "SELECT version FROM organization_schema_migrations")) {
    if (isVersionRow(row)) applied.add(row.version);
  }
  for (const migration of organizationSchemaMigrations) {
    if (applied.has(migration.version)) continue;
    for (const statement of migration.statements) db.exec(statement);
    db.prepare(
      "INSERT INTO organization_schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run(migration.version, new Date().toISOString());
    applied.add(migration.version);
  }
}

function seedOrganization(db: DatabaseSync, organizationId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, lifecycle_state, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(organizationId, "Import Test Org", "import-test", now, now);
}

interface Fixture {
  readonly db: DatabaseSync;
  readonly storage: ContactStoreStorage;
}

function createFixture(organizationId: string = ORG_ID): Fixture {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  seedOrganization(db, organizationId);
  return { db, storage: createStorage(db) };
}

function seedList(storage: ContactStoreStorage, index: number, name: string): string {
  const listId = uuidFor(900 + index);
  createContactListInStore(storage, {
    actorUserId: ACTOR_ID,
    description: null,
    listId,
    name,
    organizationId: ORG_ID,
    requestId: uuidFor(950 + index),
  });
  return listId;
}

const IMPORT_TARGETS: ContactImportTarget[] = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "emailStatus",
  "source",
];

function stageImport(
  storage: ContactStoreStorage,
  csv: string,
  options: { readonly importIndex?: number; readonly requestIndex?: number } = {},
): {
  readonly headers: readonly string[];
  readonly importId: string;
  readonly rows: readonly (readonly string[])[];
} {
  const parsed = parseContactImportCsv(csv);
  const importId = uuidFor(options.importIndex ?? 10);
  createContactImportInStore(storage, {
    actorUserId: ACTOR_ID,
    byteCount: new TextEncoder().encode(csv).byteLength,
    fileName: "import.csv",
    headers: [...parsed.headers],
    importId,
    malformedRows: parsed.malformedRows.map((entry) => ({
      cells: [...entry.cells],
      error: entry.error,
      rowNumber: entry.rowNumber,
    })),
    organizationId: ORG_ID,
    requestId: uuidFor(options.requestIndex ?? 20),
    rows: parsed.dataRows.map((entry) => ({
      cells: [...entry.cells],
      rowNumber: entry.rowNumber,
    })),
  });
  return { headers: parsed.headers, importId, rows: parsed.rows };
}

function mapImport(
  storage: ContactStoreStorage,
  importId: string,
  listIds: readonly string[],
  targets: readonly ContactImportTarget[] = IMPORT_TARGETS,
  requestIndex = 30,
): void {
  const summary = getContactImportFromStore(storage, ORG_ID, importId);
  const validated = validateContactImportMapping(summary.headers, [...targets]);
  updateContactImportMappingInStore(storage, {
    actorUserId: ACTOR_ID,
    importId,
    listIds: [...listIds],
    mapping: validated,
    organizationId: ORG_ID,
    requestId: uuidFor(requestIndex),
  });
}

function confirmImport(storage: ContactStoreStorage, importId: string, requestIndex = 40): void {
  confirmContactImportInStore(storage, {
    actorUserId: ACTOR_ID,
    importId,
    organizationId: ORG_ID,
    requestId: uuidFor(requestIndex),
  });
}

function processAll(
  storage: ContactStoreStorage,
  importId: string,
  batchSize = 200,
  requestIndex = 50,
): void {
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const result = processContactImportBatchInStore(storage, {
      actorUserId: ACTOR_ID,
      batchSize,
      importId,
      organizationId: ORG_ID,
      requestId: uuidFor(requestIndex + iteration),
    });
    if (result.completed) return;
  }
  throw new Error("Import did not complete within the bounded iteration budget.");
}

function contactCount(storage: ContactStoreStorage): number {
  return listContactsFromStore(storage, { limit: 500, organizationId: ORG_ID }).contacts.length;
}

function membershipCount(db: DatabaseSync): number {
  return countFor(db, "SELECT COUNT(*) AS count FROM contact_list_memberships");
}

function emailStatusOf(storage: ContactStoreStorage, email: string): string {
  const { contacts } = listContactsFromStore(storage, {
    limit: 500,
    organizationId: ORG_ID,
    query: email,
  });
  const contact = contacts.find((entry) => entry.normalizedEmail === email);
  if (!contact) throw new Error(`Expected contact ${email}.`);
  const row = storage.sql
    .exec<{ readonly status: string }>(
      "SELECT status FROM contact_communication_preferences WHERE contact_id = ? AND channel = 'email' LIMIT 1",
      contact.id,
    )
    .toArray()
    .at(0);
  return row?.status ?? "unknown";
}

function expectImportError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof ContactStoreError) {
      expect(error.code).toBe(code);
      return;
    }
    throw error;
  }
  throw new Error(`Expected ContactStoreError with code ${code}.`);
}

describe("contact import staging", () => {
  it("migrates fresh databases and stays idempotent", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    runMigrations(db);
    const versions: number[] = [];
    for (const row of dbAllUnknown(
      db,
      "SELECT version FROM organization_schema_migrations ORDER BY version",
    )) {
      if (isVersionRow(row)) versions.push(row.version);
    }
    expect(versions).toContain(79);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("stages an upload and exposes headers with sample rows", () => {
    const { storage } = createFixture();
    const { headers, importId } = stageImport(
      storage,
      "First Name,Email\nJane,jane@example.com\nBob,bob@example.com\n",
    );
    expect(headers).toEqual(["First Name", "Email"]);
    const summary = getContactImportFromStore(storage, ORG_ID, importId);
    expect(summary.status).toBe("staged");
    expect(summary.rowCount).toBe(2);
    expect(summary.sampleRows).toHaveLength(2);
  });

  it("rejects oversized staging and unknown imports", () => {
    const { storage } = createFixture();
    expectImportError(
      () =>
        createContactImportInStore(storage, {
          actorUserId: ACTOR_ID,
          byteCount: 1,
          fileName: "x.csv",
          headers: ["Email"],
          importId: uuidFor(61),
          organizationId: ORG_ID,
          requestId: uuidFor(62),
          rows: Array.from({ length: CONTACT_IMPORT_ROWS_MAX + 1 }, () => ["a@example.com"]),
        }),
      "validation_failed",
    );
    expectImportError(
      () => getContactImportFromStore(storage, ORG_ID, uuidFor(63)),
      "contact_import_not_found",
    );
  });

  it("blocks cross-tenant reads of staged imports", () => {
    const { storage } = createFixture();
    const { importId } = stageImport(storage, "Email\na@example.com\n", { importIndex: 64 });
    expectImportError(
      () => getContactImportFromStore(storage, OTHER_ORG_ID, importId),
      "organization_identity_conflict",
    );
    expectImportError(
      () =>
        processContactImportBatchInStore(storage, {
          actorUserId: ACTOR_ID,
          importId,
          organizationId: OTHER_ORG_ID,
          requestId: uuidFor(65),
        }),
      "organization_identity_conflict",
    );
  });

  it("requires a valid mapping and existing target lists", () => {
    const { storage } = createFixture();
    const listId = seedList(storage, 1, "Newsletter");
    const { headers, importId } = stageImport(storage, "Email,Phone\na@example.com,555\n", {
      importIndex: 66,
    });
    expectImportError(
      () =>
        updateContactImportMappingInStore(storage, {
          actorUserId: ACTOR_ID,
          importId,
          listIds: [listId],
          mapping: ["email", "email"],
          organizationId: ORG_ID,
          requestId: uuidFor(67),
        }),
      "validation_failed",
    );
    expect(headers).toHaveLength(2);
    expectImportError(
      () =>
        updateContactImportMappingInStore(storage, {
          actorUserId: ACTOR_ID,
          importId,
          listIds: [uuidFor(68)],
          mapping: ["email", "phone"],
          organizationId: ORG_ID,
          requestId: uuidFor(69),
        }),
      "contact_list_not_found",
    );
    expectImportError(
      () =>
        updateContactImportMappingInStore(storage, {
          actorUserId: ACTOR_ID,
          importId,
          listIds: [],
          mapping: ["email", "phone"],
          organizationId: ORG_ID,
          requestId: uuidFor(70),
        }),
      "validation_failed",
    );
  });

  it("cancels before confirm without creating contacts", () => {
    const { storage } = createFixture();
    const listId = seedList(storage, 2, "Newsletter");
    const { importId } = stageImport(storage, "Email\na@example.com\n", { importIndex: 71 });
    mapImport(storage, importId, [listId], ["email"], 72);
    const cancelled = cancelContactImportInStore(storage, {
      actorUserId: ACTOR_ID,
      importId,
      organizationId: ORG_ID,
      requestId: uuidFor(73),
    });
    expect(cancelled.status).toBe("cancelled");
    expect(contactCount(storage)).toBe(0);
    expectImportError(
      () => getContactImportFromStore(storage, ORG_ID, importId),
      "contact_import_not_found",
    );
  });

  it("refuses to confirm without a saved mapping and lists", () => {
    const { storage } = createFixture();
    const { importId } = stageImport(storage, "Email\na@example.com\n", { importIndex: 74 });
    expectImportError(
      () =>
        confirmContactImportInStore(storage, {
          actorUserId: ACTOR_ID,
          importId,
          organizationId: ORG_ID,
          requestId: uuidFor(75),
        }),
      "contact_import_conflict",
    );
  });
});

describe("contact import preview", () => {
  it("classifies new, existing, in-file duplicates, and invalid rows", () => {
    const { storage } = createFixture();
    const listId = seedList(storage, 3, "Newsletter");
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(80),
      displayName: "Existing Eve",
      email: "eve@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(81),
    });
    const { importId } = stageImport(
      storage,
      [
        "First Name,Last Name,Email,Phone,Email Status,Source",
        "Jane,Smith,jane@example.com,,,Website",
        "Eve,Ex,eve@example.com,,,Website",
        "Jane,Dup,  JANE@example.com ,,,Website",
        "Bad,Row,not-an-email,,,Website",
      ].join("\n"),
      { importIndex: 82 },
    );
    mapImport(storage, importId, [listId], IMPORT_TARGETS, 83);
    const previewed = previewContactImportFromStore(storage, ORG_ID, importId);
    expect(previewed.preview.rowsRead).toBe(4);
    expect(previewed.preview.newContacts).toBe(1);
    expect(previewed.preview.existingMatches).toBe(1);
    expect(previewed.preview.inFileDuplicates).toBe(1);
    expect(previewed.preview.invalidRows).toBe(1);
    // Preview never mutates contacts.
    expect(contactCount(storage)).toBe(1);
  });
});

describe("contact import execution", () => {
  it("imports new contacts with unknown consent when none is supplied (Scenario B)", () => {
    const { db, storage } = createFixture();
    const listId = seedList(storage, 4, "Newsletter");
    const { importId } = stageImport(
      storage,
      "First Name,Last Name,Email,Phone,Email Status,Source\nBob,Jones,bob@example.com,,,",
      { importIndex: 90 },
    );
    mapImport(storage, importId, [listId], IMPORT_TARGETS, 91);
    confirmImport(storage, importId, 92);
    processAll(storage, importId, 200, 93);
    const summary = getContactImportFromStore(storage, ORG_ID, importId);
    expect(summary.status).toBe("completed");
    expect(summary.contactsCreated).toBe(1);
    expect(summary.membershipsAdded).toBe(1);
    expect(emailStatusOf(storage, "bob@example.com")).toBe("unknown");
    expect(membershipCount(db)).toBe(1);
  });

  it("preserves unsubscribed status against imported subscribed (Scenarios C and I)", () => {
    const { storage } = createFixture();
    const listId = seedList(storage, 5, "Newsletter");
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(100),
      displayName: "Carol",
      email: "carol@example.com",
      emailStatus: "unsubscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(101),
    });
    const { importId } = stageImport(
      storage,
      "First Name,Last Name,Email,Phone,Email Status,Source\nCarol,White,carol@example.com,,subscribed,Website",
      { importIndex: 102 },
    );
    mapImport(storage, importId, [listId], IMPORT_TARGETS, 103);
    confirmImport(storage, importId, 104);
    processAll(storage, importId, 200, 105);
    expect(emailStatusOf(storage, "carol@example.com")).toBe("unsubscribed");
    expect(getContactImportFromStore(storage, ORG_ID, importId).suppressedPreserved).toBe(1);
  });

  it("applies an imported unsubscribe and fills blank fields without erasing", () => {
    const { storage } = createFixture();
    const listId = seedList(storage, 6, "Newsletter");
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(110),
      displayName: "Dan",
      email: "dan@example.com",
      emailStatus: "subscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(111),
    });
    const { importId } = stageImport(
      storage,
      "First Name,Last Name,Email,Phone,Email Status,Source\n,User,dan@example.com,+15551234567,unsubscribed,",
      { importIndex: 112 },
    );
    mapImport(storage, importId, [listId], IMPORT_TARGETS, 113);
    confirmImport(storage, importId, 114);
    processAll(storage, importId, 200, 115);
    expect(emailStatusOf(storage, "dan@example.com")).toBe("unsubscribed");
    const { contacts } = listContactsFromStore(storage, { limit: 500, organizationId: ORG_ID });
    // Blank first name in the CSV does not erase the stored display value.
    expect(contacts.find((entry) => entry.normalizedEmail === "dan@example.com")?.phone).toBe(
      "+15551234567",
    );
  });

  it("adds new memberships while preserving existing ones across multiple lists", () => {
    const { db, storage } = createFixture();
    const newsletter = seedList(storage, 7, "Newsletter");
    const donors = seedList(storage, 8, "Donors");
    const contactId = uuidFor(120);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Multi",
      email: "multi@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(121),
    });
    const { importId } = stageImport(
      storage,
      "First Name,Last Name,Email,Phone,Email Status,Source\nMulti,Person,multi@example.com,,,",
      { importIndex: 122 },
    );
    mapImport(storage, importId, [newsletter, donors], IMPORT_TARGETS, 123);
    confirmImport(storage, importId, 124);
    processAll(storage, importId, 200, 125);
    const memberships: string[] = [];
    for (const row of dbAllUnknown(
      db,
      "SELECT list_id AS listId FROM contact_list_memberships WHERE contact_id = ?",
      contactId,
    )) {
      if (isListIdRow(row)) memberships.push(row.listId);
    }
    memberships.sort();
    expect(memberships).toEqual([donors, newsletter].sort());
  });

  it("resumes after a halfway crash without duplicates", () => {
    const { db, storage } = createFixture();
    const listId = seedList(storage, 9, "Newsletter");
    const { importId } = stageImport(
      storage,
      [
        "First Name,Last Name,Email,Phone,Email Status,Source",
        "A,One,a1@example.com,,,",
        "B,Two,b2@example.com,,,",
        "C,Three,c3@example.com,,,",
      ].join("\n"),
      { importIndex: 130 },
    );
    mapImport(storage, importId, [listId], IMPORT_TARGETS, 131);
    confirmImport(storage, importId, 132);
    // Crash after the first row: only one bounded batch is processed.
    const partial = processContactImportBatchInStore(storage, {
      actorUserId: ACTOR_ID,
      batchSize: 1,
      importId,
      organizationId: ORG_ID,
      requestId: uuidFor(133),
    });
    expect(partial.completed).toBe(false);
    expect(partial.processedThisBatch).toBe(1);
    processAll(storage, importId, 200, 134);
    const summary = getContactImportFromStore(storage, ORG_ID, importId);
    expect(summary.status).toBe("completed");
    expect(summary.contactsCreated).toBe(3);
    expect(contactCount(storage)).toBe(3);
    expect(membershipCount(db)).toBe(3);
  });

  it("reprocessing the same confirmed job twice creates nothing new (Scenario G)", () => {
    const { db, storage } = createFixture();
    const listId = seedList(storage, 10, "Newsletter");
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(140),
      displayName: "Carol",
      email: "carol@example.com",
      emailStatus: "unsubscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(141),
    });
    const { importId } = stageImport(
      storage,
      [
        "First Name,Last Name,Email,Phone,Email Status,Source",
        "Jane,Smith,jane@example.com,,subscribed,Website",
        "Carol,White,carol@example.com,,subscribed,Website",
        "Jane,Dup,  JANE@example.com ,,,Website",
      ].join("\n"),
      { importIndex: 142 },
    );
    mapImport(storage, importId, [listId], IMPORT_TARGETS, 143);
    confirmImport(storage, importId, 144);
    processAll(storage, importId, 200, 145);
    const first = getContactImportFromStore(storage, ORG_ID, importId);
    expect(first.status).toBe("completed");
    const contactsAfterFirst = contactCount(storage);
    const membershipsAfterFirst = membershipCount(db);
    // Duplicate queue delivery / operator retry of the exact same job.
    const replay = processContactImportBatchInStore(storage, {
      actorUserId: ACTOR_ID,
      batchSize: 200,
      importId,
      organizationId: ORG_ID,
      requestId: uuidFor(146),
    });
    expect(replay.completed).toBe(true);
    expect(replay.processedThisBatch).toBe(0);
    const second = getContactImportFromStore(storage, ORG_ID, importId);
    expect(second.contactsCreated).toBe(first.contactsCreated);
    expect(second.contactsUpdated).toBe(first.contactsUpdated);
    expect(second.membershipsAdded).toBe(first.membershipsAdded);
    expect(contactCount(storage)).toBe(contactsAfterFirst);
    expect(membershipCount(db)).toBe(membershipsAfterFirst);
    expect(emailStatusOf(storage, "carol@example.com")).toBe("unsubscribed");
    expect(emailStatusOf(storage, "jane@example.com")).toBe("subscribed");
  });

  it("keeps duplicate confirm calls to a single queued job", () => {
    const { storage } = createFixture();
    const listId = seedList(storage, 11, "Newsletter");
    const { importId } = stageImport(storage, "Email\na@example.com\n", { importIndex: 150 });
    mapImport(storage, importId, [listId], ["email"], 151);
    const first = confirmContactImportInStore(storage, {
      actorUserId: ACTOR_ID,
      importId,
      organizationId: ORG_ID,
      requestId: uuidFor(152),
    });
    const second = confirmContactImportInStore(storage, {
      actorUserId: ACTOR_ID,
      importId,
      organizationId: ORG_ID,
      requestId: uuidFor(153),
    });
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    const outbox = storage.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE job_id = ?",
        importId,
      )
      .toArray()
      .at(0)?.count;
    expect(outbox).toBe(1);
  });

  it("matches phone-only rows on normalized phone but never merges on name alone", () => {
    const { storage } = createFixture();
    const listId = seedList(storage, 12, "Newsletter");
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(160),
      displayName: "Phyllis",
      organizationId: ORG_ID,
      phone: "(555) 123-4567",
      requestId: uuidFor(161),
    });
    const { importId } = stageImport(
      storage,
      [
        "First Name,Last Name,Email,Phone,Email Status,Source",
        ",, ,+15551234567,,",
        "Phyllis,Clone,,,,",
      ].join("\n"),
      { importIndex: 162 },
    );
    mapImport(storage, importId, [listId], IMPORT_TARGETS, 163);
    confirmImport(storage, importId, 164);
    processAll(storage, importId, 200, 165);
    const summary = getContactImportFromStore(storage, ORG_ID, importId);
    expect(summary.contactsCreated).toBe(1);
    expect(summary.contactsUpdated).toBe(1);
    expect(contactCount(storage)).toBe(2);
  });

  it("reports row errors through a downloadable error CSV", () => {
    const { storage } = createFixture();
    const listId = seedList(storage, 13, "Newsletter");
    const { importId } = stageImport(
      storage,
      [
        "First Name,Last Name,Email,Phone,Email Status,Source",
        "Bad,Row,not-an-email,,,",
        "Jane,Smith,jane@example.com,,,",
        "Extra,Row,jane2@example.com,,,Website,unexpected",
      ].join("\n"),
      { importIndex: 170 },
    );
    const staged = getContactImportFromStore(storage, ORG_ID, importId);
    expect(staged.rowCount).toBe(3);
    expect(staged.invalidRows).toBe(1);
    expect(staged.hasErrorCsv).toBe(true);
    mapImport(storage, importId, [listId], IMPORT_TARGETS, 171);
    const previewed = previewContactImportFromStore(storage, ORG_ID, importId);
    expect(previewed.preview.rowsRead).toBe(3);
    expect(previewed.preview.invalidRows).toBe(2);
    confirmImport(storage, importId, 172);
    processAll(storage, importId, 200, 173);
    const summary = getContactImportFromStore(storage, ORG_ID, importId);
    expect(summary.status).toBe("completed");
    expect(summary.invalidRows).toBe(2);
    expect(summary.contactsCreated).toBe(1);
    expect(summary.hasErrorCsv).toBe(true);
    const exported = readContactImportErrorCsvFromStore(storage, ORG_ID, importId);
    expect(exported.rowCount).toBe(2);
    expect(exported.csv).toContain("not-an-email");
    expect(exported.csv).toContain("unexpected");
  });

  it("preserves exact row numbers when malformed rows precede valid rows", () => {
    const { storage } = createFixture();
    const { importId } = stageImport(
      storage,
      [
        "First Name,Last Name,Email",
        "Malformed,Row,extra,column,here",
        "Valid,Contact,valid@example.com",
      ].join("\n"),
      { importIndex: 180 },
    );
    const rows = storage.sql
      .exec<{ readonly rowIndex: number; readonly rowNumber: number; readonly status: string }>(
        "SELECT row_index AS rowIndex, row_number AS rowNumber, status FROM contact_import_rows WHERE import_id = ? ORDER BY row_index ASC",
        importId,
      )
      .toArray();
    expect(rows).toEqual([
      { rowIndex: 0, rowNumber: 2, status: "error" },
      { rowIndex: 1, rowNumber: 3, status: "pending" },
    ]);
  });
});
