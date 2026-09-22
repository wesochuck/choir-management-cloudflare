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
  updateContactImportMappingInStore,
} from "./contactImportStore";
import {
  createContactInStore,
  createContactListInStore,
  listContactsFromStore,
  type ContactStoreStorage,
} from "./contactStore";
import {
  createFreshContactContext,
  dbAllUnknown,
  DEFAULT_CONTACT_TEST_ACTOR_ID as ACTOR_ID,
  expectContactStoreError as expectImportError,
  isVersionRow,
  runMigrations,
  uuidFor,
} from "./contactTestkit";

const ORG_ID = "org-contact-import-test";
const OTHER_ORG_ID = "org-contact-import-other";

const IMPORT_TARGETS: ContactImportTarget[] = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "emailStatus",
  "source",
];

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

function contactCount(storage: ContactStoreStorage): number {
  return listContactsFromStore(storage, { limit: 500, organizationId: ORG_ID }).contacts.length;
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
    const { storage } = createFreshContactContext(ORG_ID);
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
    const { storage } = createFreshContactContext(ORG_ID);
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
    const { storage } = createFreshContactContext(ORG_ID);
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
    const { storage } = createFreshContactContext(ORG_ID);
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
    const { storage } = createFreshContactContext(ORG_ID);
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
    const { storage } = createFreshContactContext(ORG_ID);
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
    const { storage } = createFreshContactContext(ORG_ID);
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
    expect(contactCount(storage)).toBe(1);
  });
});
