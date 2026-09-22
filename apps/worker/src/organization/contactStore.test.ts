import type { SqlStorageValue } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  addContactsToListInStore,
  ContactStoreError,
  createContactInStore,
  createContactListInStore,
  deleteContactInStore,
  deleteContactListInStore,
  getContactFromStore,
  listContactListsFromStore,
  listContactsFromStore,
  removeContactsFromListInStore,
  updateContactInStore,
  updateContactListInStore,
  type ContactStoreStorage,
} from "./contactStore";
import {
  currentOrganizationSchemaVersion,
  organizationSchemaMigrations,
} from "./schema/migrations";

const ORG_ID = "org-contacts-test";
const ACTOR_ID = "user-tester-001";

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

function isRowArray<T>(value: unknown, fallback: readonly T[]): value is T[] {
  return Array.isArray(value) && fallback.length >= 0;
}

function dbAllUnknown(db: DatabaseSync, query: string, ...params: readonly unknown[]): unknown[] {
  const raw: unknown = db.prepare(query).all(...params.map(toSupportedValue));
  return Array.isArray(raw) ? raw : [];
}

function descriptorValue(row: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(row, key)?.value;
}

function isCountRow(value: unknown): value is { readonly count: number } {
  if (typeof value !== "object" || value === null) return false;
  if (!("count" in value)) return false;
  return typeof descriptorValue(value, "count") === "number";
}

function isNameRow(value: unknown): value is { readonly name: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value)) return false;
  return typeof descriptorValue(value, "name") === "string";
}

function isVersionRow(value: unknown): value is { readonly version: number } {
  if (typeof value !== "object" || value === null) return false;
  if (!("version" in value)) return false;
  return typeof descriptorValue(value, "version") === "number";
}

function isChangeSummaryRow(value: unknown): value is { readonly changeSummary: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("changeSummary" in value)) return false;
  return typeof descriptorValue(value, "changeSummary") === "string";
}

function isPlanDetailRow(value: unknown): value is { readonly detail: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("detail" in value)) return false;
  return typeof descriptorValue(value, "detail") === "string";
}

function countFor(db: DatabaseSync, query: string, ...params: readonly unknown[]): number {
  for (const row of dbAllUnknown(db, query, ...params)) {
    if (isCountRow(row)) return row.count;
  }
  return 0;
}

interface TestContext {
  readonly db: DatabaseSync;
  readonly queryCount: () => number;
  readonly resetQueryCount: () => void;
  readonly storage: ContactStoreStorage;
}

function createAdapter(db: DatabaseSync): TestContext {
  let count = 0;
  const exec = <T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: readonly unknown[]
  ): { readonly one: () => T; readonly toArray: () => T[] } & Iterable<T> => {
    count += 1;
    const statement = db.prepare(query);
    const params = bindings.map(toSupportedValue);
    if (isReadQuery(query)) {
      const rawRows: unknown = statement.all(...params);
      const fallback: readonly T[] = [];
      const rows: T[] = isRowArray(rawRows, fallback) ? rawRows : [];
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

  let depth = 0;
  const storage: ContactStoreStorage = {
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
  return {
    db,
    queryCount: () => count,
    resetQueryCount: () => {
      count = 0;
    },
    storage,
  };
}

function runMigrations(db: DatabaseSync, upToVersion?: number): void {
  db.exec(`CREATE TABLE IF NOT EXISTS organization_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = new Set<number>();
  for (const row of dbAllUnknown(db, "SELECT version FROM organization_schema_migrations")) {
    if (isVersionRow(row)) applied.add(row.version);
  }
  for (const migration of organizationSchemaMigrations) {
    if (upToVersion !== undefined && migration.version > upToVersion) continue;
    if (applied.has(migration.version)) continue;
    // Execute the real forward-only DDL. Data-only apply() backfills for
    // seasons/events/templates are intentionally out of scope for contacts
    // persistence tests; contacts depend only on statement DDL.
    for (const statement of migration.statements) {
      db.exec(statement);
    }
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO organization_schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run(migration.version, now);
    applied.add(migration.version);
  }
}

function seedOrganization(db: DatabaseSync, organizationId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, lifecycle_state, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(organizationId, "Contacts Test Org", "contacts-test", now, now);
}

function seedProfile(db: DatabaseSync, profileId: string, displayName: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(profileId, displayName, now, now);
}

function createFreshContext(organizationId: string = ORG_ID): TestContext {
  const db = new DatabaseSync(":memory:");
  const context = createAdapter(db);
  runMigrations(db);
  seedOrganization(db, organizationId);
  context.resetQueryCount();
  return context;
}

function uuidFor(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`;
}

function expectContactStoreError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof ContactStoreError) {
      expect(error.code).toBe(code);
      return;
    }
    throw new Error(`Expected ContactStoreError with code ${code}.`, { cause: error });
  }
  throw new Error(`Expected ContactStoreError with code ${code}.`);
}

describe("contact schema migrations with real SQLite", () => {
  it("migrates a fresh database to the current version with contact tables", () => {
    const db = new DatabaseSync(":memory:");
    createAdapter(db);
    runMigrations(db);

    expect(currentOrganizationSchemaVersion).toBe(86);
    const tables = new Set<string>();
    for (const row of dbAllUnknown(db, "SELECT name FROM sqlite_master WHERE type = 'table'")) {
      if (isNameRow(row)) tables.add(row.name);
    }
    for (const table of [
      "contacts",
      "contact_communication_preferences",
      "contact_lists",
      "contact_list_memberships",
      "contact_imports",
      "contact_import_rows",
    ]) {
      expect(tables.has(table), `expected table ${table}`).toBe(true);
    }
    const contactColumns = new Set<string>();
    for (const row of dbAllUnknown(db, "PRAGMA table_info(contacts)")) {
      if (isNameRow(row)) contactColumns.add(row.name);
    }
    for (const column of [
      "id",
      "first_name",
      "last_name",
      "display_name",
      "email",
      "normalized_email",
      "phone",
      "normalized_phone",
      "profile_id",
      "source",
      "created_at",
      "updated_at",
    ]) {
      expect(contactColumns.has(column), `expected contacts.${column}`).toBe(true);
    }
    const indexes = new Set<string>();
    for (const row of dbAllUnknown(db, "SELECT name FROM sqlite_master WHERE type = 'index'")) {
      if (isNameRow(row)) indexes.add(row.name);
    }
    for (const index of [
      "idx_contacts_normalized_email",
      "idx_contacts_normalized_phone",
      "idx_contacts_profile_id",
      "idx_contacts_display_name",
      "idx_contact_list_memberships_list",
      "idx_contact_lists_name",
      "idx_ticket_purchases_contact_id",
      "idx_donations_contact_id",
      "idx_communication_deliveries_profile",
    ]) {
      expect(indexes.has(index), `expected index ${index}`).toBe(true);
    }
    const versions: number[] = [];
    for (const row of dbAllUnknown(
      db,
      "SELECT version FROM organization_schema_migrations ORDER BY version",
    )) {
      if (isVersionRow(row)) versions.push(row.version);
    }
    expect(versions.at(-1)).toBe(currentOrganizationSchemaVersion);
  });

  it("migrates from the pre-contacts schema while preserving existing rows", () => {
    const db = new DatabaseSync(":memory:");
    createAdapter(db);
    runMigrations(db, 77);
    seedOrganization(db, ORG_ID);
    seedProfile(db, uuidFor(9001), "Existing Singer");
    expect(countFor(db, "SELECT COUNT(*) AS count FROM profiles")).toBe(1);

    runMigrations(db);

    expect(countFor(db, "SELECT COUNT(*) AS count FROM profiles")).toBe(1);
    const contactTables: string[] = [];
    for (const row of dbAllUnknown(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'contact%'",
    )) {
      if (isNameRow(row)) contactTables.push(row.name);
    }
    expect(contactTables).toHaveLength(6);
  });

  it("is idempotent across repeated runs", () => {
    const { db, storage } = createFreshContext();
    const countBefore = countFor(
      db,
      "SELECT COUNT(*) AS count FROM organization_schema_migrations",
    );
    runMigrations(db);
    runMigrations(db);
    expect(countFor(db, "SELECT COUNT(*) AS count FROM organization_schema_migrations")).toBe(
      countBefore,
    );

    const contactId = uuidFor(9101);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Idempotent Check",
      organizationId: ORG_ID,
      requestId: uuidFor(9102),
    });
    runMigrations(db);
    expect(getContactFromStore(storage, ORG_ID, contactId).contact.displayName).toBe(
      "Idempotent Check",
    );
  });
});

describe("contact CRUD with real SQLite", () => {
  it("creates, reads, updates, and deletes a contact with audit evidence", () => {
    const { db, storage } = createFreshContext();
    const contactId = uuidFor(1001);

    const created = createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Jane Smith",
      email: "jane@example.com",
      organizationId: ORG_ID,
      phone: "+15551234567",
      requestId: uuidFor(1002),
      source: "manual",
    });
    expect(created.contact.id).toBe(contactId);
    expect(created.contact.normalizedEmail).toBe("jane@example.com");
    expect(created.contact.normalizedPhone).toBe("+15551234567");
    expect(created.preferences).toHaveLength(2);

    const fetched = getContactFromStore(storage, ORG_ID, contactId);
    expect(fetched.contact.email).toBe("jane@example.com");
    expect(fetched.listIds).toEqual([]);

    const updated = updateContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Jane A. Smith",
      organizationId: ORG_ID,
      requestId: uuidFor(1003),
    });
    expect(updated.contact.displayName).toBe("Jane A. Smith");
    expect(updated.contact.email).toBe("jane@example.com");

    const listId = uuidFor(1004);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Newsletter",
      organizationId: ORG_ID,
      requestId: uuidFor(1005),
    });
    expect(
      addContactsToListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [contactId],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(1006),
      }).added,
    ).toBe(1);

    expect(
      deleteContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        organizationId: ORG_ID,
        requestId: uuidFor(1007),
      }).deleted,
    ).toBe(true);
    expectContactStoreError(
      () => getContactFromStore(storage, ORG_ID, contactId),
      "contact_not_found",
    );

    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM contact_list_memberships WHERE contact_id = ?",
        contactId,
      ),
    ).toBe(0);
    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM contact_communication_preferences WHERE contact_id = ?",
        contactId,
      ),
    ).toBe(0);
    // Audit history is preserved after hard delete.
    expect(
      countFor(db, "SELECT COUNT(*) AS count FROM audit_events WHERE target_id = ?", contactId),
    ).toBeGreaterThanOrEqual(3);
  });

  it("rejects updates that would leave a contact without identity", () => {
    const { storage } = createFreshContext();
    const contactId = uuidFor(1101);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Solo Name",
      organizationId: ORG_ID,
      requestId: uuidFor(1102),
    });
    expectContactStoreError(
      () =>
        updateContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId,
          displayName: null,
          organizationId: ORG_ID,
          requestId: uuidFor(1103),
        }),
      "contact_missing_identity",
    );
    expect(getContactFromStore(storage, ORG_ID, contactId).contact.displayName).toBe("Solo Name");
  });

  it("returns typed not-found errors for missing contacts", () => {
    const { storage } = createFreshContext();
    expectContactStoreError(
      () => getContactFromStore(storage, ORG_ID, uuidFor(1201)),
      "contact_not_found",
    );
    expectContactStoreError(
      () =>
        updateContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(1201),
          displayName: "Ghost",
          organizationId: ORG_ID,
          requestId: uuidFor(1202),
        }),
      "contact_not_found",
    );
    expectContactStoreError(
      () =>
        deleteContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(1201),
          organizationId: ORG_ID,
          requestId: uuidFor(1203),
        }),
      "contact_not_found",
    );
  });
});

describe("contact identity, duplicates, and profiles", () => {
  it("detects normalized-email duplicates across case and space variants with typed errors", () => {
    const { storage } = createFreshContext();
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(2001),
      email: "Jane@Example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(2002),
    });
    try {
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId: uuidFor(2003),
        email: "  jane@example.COM  ",
        organizationId: ORG_ID,
        requestId: uuidFor(2004),
      });
      throw new Error("Expected duplicate to throw.");
    } catch (error: unknown) {
      if (!(error instanceof ContactStoreError)) throw error;
      expect(error.code).toBe("contact_duplicate_email");
      // Typed error, never raw SQLite constraint text.
      expect(error.message).not.toMatch(/UNIQUE constraint failed/i);
    }
  });

  it("allows many contacts with nullable email", () => {
    const { storage } = createFreshContext();
    for (const index of [2101, 2102, 2103]) {
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId: uuidFor(index),
        displayName: `No Email ${String(index)}`,
        organizationId: ORG_ID,
        requestId: uuidFor(index + 50),
      });
    }
    expect(listContactsFromStore(storage, { organizationId: ORG_ID }).contacts).toHaveLength(3);
  });

  it("rejects duplicate email on update without mutating the stored row", () => {
    const { storage } = createFreshContext();
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(2201),
      email: "alpha@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(2202),
    });
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(2203),
      email: "beta@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(2204),
    });
    expectContactStoreError(
      () =>
        updateContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(2203),
          email: " ALPHA@example.com ",
          organizationId: ORG_ID,
          requestId: uuidFor(2205),
        }),
      "contact_duplicate_email",
    );
    expect(getContactFromStore(storage, ORG_ID, uuidFor(2203)).contact.email).toBe(
      "beta@example.com",
    );
  });

  it("links profile_id when the profile exists and rejects unknown profiles", () => {
    const { db, storage } = createFreshContext();
    const profileId = uuidFor(2301);
    seedProfile(db, profileId, "Member Jane");

    const linked = createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(2302),
      organizationId: ORG_ID,
      profileId,
      requestId: uuidFor(2303),
    });
    expect(linked.contact.profileId).toBe(profileId);

    expectContactStoreError(
      () =>
        createContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(2304),
          email: "orphan@example.com",
          organizationId: ORG_ID,
          profileId: uuidFor(2305),
          requestId: uuidFor(2306),
        }),
      "contact_profile_not_found",
    );
    expectContactStoreError(
      () =>
        updateContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(2302),
          organizationId: ORG_ID,
          profileId: uuidFor(2307),
          requestId: uuidFor(2308),
        }),
      "contact_profile_not_found",
    );
  });
});

describe("contact lists and memberships", () => {
  it("creates, renames, and deletes lists without deleting contacts", () => {
    const { storage } = createFreshContext();
    const contactId = uuidFor(3001);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "List Member",
      organizationId: ORG_ID,
      requestId: uuidFor(3002),
    });
    const listId = uuidFor(3003);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      description: "Monthly news",
      listId,
      name: "Newsletter",
      organizationId: ORG_ID,
      requestId: uuidFor(3004),
    });
    expect(listContactListsFromStore(storage, ORG_ID).lists.map((list) => list.name)).toEqual([
      "Newsletter",
    ]);

    const renamed = updateContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Weekly Newsletter",
      organizationId: ORG_ID,
      requestId: uuidFor(3005),
    });
    expect(renamed.list.name).toBe("Weekly Newsletter");

    expect(
      addContactsToListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [contactId],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3006),
      }).added,
    ).toBe(1);
    // Duplicate membership is idempotent, not a second row.
    expect(
      addContactsToListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [contactId],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3007),
      }).added,
    ).toBe(0);

    expect(
      deleteContactListInStore(storage, {
        actorUserId: ACTOR_ID,
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3008),
      }).deleted,
    ).toBe(true);
    expect(listContactListsFromStore(storage, ORG_ID).lists).toHaveLength(0);
    // Contacts survive list deletion.
    expect(getContactFromStore(storage, ORG_ID, contactId).contact.displayName).toBe("List Member");
    expect(getContactFromStore(storage, ORG_ID, contactId).listIds).toEqual([]);
  });

  it("removes members and validates list operations", () => {
    const { storage } = createFreshContext();
    const first = uuidFor(3101);
    const second = uuidFor(3102);
    const seeds: readonly {
      readonly contactId: string;
      readonly name: string;
      readonly requestId: string;
    }[] = [
      { contactId: first, name: "First", requestId: uuidFor(3111) },
      { contactId: second, name: "Second", requestId: uuidFor(3112) },
    ];
    for (const seed of seeds) {
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId: seed.contactId,
        displayName: seed.name,
        organizationId: ORG_ID,
        requestId: seed.requestId,
      });
    }
    const listId = uuidFor(3103);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Audience",
      organizationId: ORG_ID,
      requestId: uuidFor(3104),
    });
    expect(
      addContactsToListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [first, second],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3105),
      }).added,
    ).toBe(2);
    expect(
      removeContactsFromListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [first],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3106),
      }).removed,
    ).toBe(1);
    expect(
      removeContactsFromListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [first],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3107),
      }).removed,
    ).toBe(0);
    expect(getContactFromStore(storage, ORG_ID, second).listIds).toEqual([listId]);

    expectContactStoreError(
      () =>
        createContactListInStore(storage, {
          actorUserId: ACTOR_ID,
          listId: uuidFor(3108),
          name: "   ",
          organizationId: ORG_ID,
          requestId: uuidFor(3109),
        }),
      "validation_failed",
    );
    expectContactStoreError(
      () => getContactFromStore(storage, ORG_ID, uuidFor(3110)),
      "contact_not_found",
    );
  });

  describe("unified contact detail with real SQLite", () => {
    function seedTicketPurchaseWithContact(
      db: DatabaseSync,
      purchaseIndex: number,
      contactId: string,
    ): void {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at, contact_id)
         VALUES (?, ?, ?, 'Spring Concert', ?, 'UTC', 'Buyer', 'buyer@example.com',
           1, 500, 0, 500, ?, '', 'paid', 1, ?, ?, ?)`,
      ).run(
        uuidFor(5_000 + purchaseIndex),
        uuidFor(6_000 + purchaseIndex),
        uuidFor(777),
        now,
        `detail_session_${String(purchaseIndex)}`,
        now,
        now,
        contactId,
      );
    }

    function seedDonationWithContact(
      db: DatabaseSync,
      donationIndex: number,
      contactId: string,
    ): void {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO donations
          (id, checkout_request_id, status, amount_cents, buyer_name, buyer_email,
           provider_session_id, provider_payment_id, created_at, updated_at, marketing_consent, contact_id)
         VALUES (?, ?, 'paid', 1000, 'Donor', 'donor@example.com', ?, '', ?, ?, 1, ?)`,
      ).run(
        uuidFor(7_000 + donationIndex),
        uuidFor(8_000 + donationIndex),
        `detail_dsession_${String(donationIndex)}`,
        now,
        now,
        contactId,
      );
    }

    function seedDelivery(
      db: DatabaseSync,
      deliveryIndex: number,
      contactId: string,
      channel: "email" | "sms",
      status: "failed" | "sent",
      createdAt: string,
    ): void {
      db.prepare(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status,
           created_at, updated_at)
         VALUES (?, ?, ?, 'Detail Recipient', ?, ?, ?, ?, ?)`,
      ).run(
        uuidFor(9_000 + deliveryIndex),
        uuidFor(9_500 + deliveryIndex),
        contactId,
        channel,
        `${channel === "email" ? "buyer" : "+1555"}@example.com`,
        status,
        createdAt,
        createdAt,
      );
    }

    it("projects lists, linked profile, commerce counts, and last sent email", () => {
      const { db, storage } = createFreshContext();
      const profileId = uuidFor(4_101);
      seedProfile(db, profileId, "Jane Singer");
      const contactId = uuidFor(4_102);
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        displayName: "Jane Smith",
        email: "jane@example.com",
        organizationId: ORG_ID,
        profileId,
        requestId: uuidFor(4_103),
      });
      for (const [index, name] of ["Newsletter", "Concert Audience"].entries()) {
        const listId = uuidFor(4_110 + index);
        createContactListInStore(storage, {
          actorUserId: ACTOR_ID,
          listId,
          name,
          organizationId: ORG_ID,
          requestId: uuidFor(4_120 + index),
        });
        expect(
          addContactsToListInStore(storage, {
            actorUserId: ACTOR_ID,
            contactIds: [contactId],
            listId,
            organizationId: ORG_ID,
            requestId: uuidFor(4_130 + index),
          }).added,
        ).toBe(1);
      }
      seedTicketPurchaseWithContact(db, 1, contactId);
      seedTicketPurchaseWithContact(db, 2, contactId);
      seedDonationWithContact(db, 1, contactId);
      seedDelivery(db, 1, contactId, "email", "sent", "2026-08-10T10:00:00.000Z");
      seedDelivery(db, 2, contactId, "email", "sent", "2026-08-12T10:00:00.000Z");
      seedDelivery(db, 3, contactId, "email", "failed", "2026-08-14T10:00:00.000Z");
      seedDelivery(db, 4, contactId, "sms", "sent", "2026-08-15T10:00:00.000Z");

      const detail = getContactFromStore(storage, ORG_ID, contactId);
      expect(detail.lists).toEqual([
        { id: uuidFor(4_111), name: "Concert Audience" },
        { id: uuidFor(4_110), name: "Newsletter" },
      ]);
      expect(detail.listIds.toSorted()).toEqual([uuidFor(4_110), uuidFor(4_111)].toSorted());
      expect(detail.linkedProfile).toEqual({ displayName: "Jane Singer", id: profileId });
      expect(detail.activity).toEqual({ donationCount: 1, ticketPurchaseCount: 2 });
      // Failed sends and SMS deliveries never move the last-email marker.
      expect(detail.lastEmailAt).toBe("2026-08-12T10:00:00.000Z");
    });

    it("returns empty relationships for a standalone contact", () => {
      const { storage } = createFreshContext();
      const contactId = uuidFor(4_201);
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        displayName: "Solo Contact",
        organizationId: ORG_ID,
        requestId: uuidFor(4_202),
      });
      const detail = getContactFromStore(storage, ORG_ID, contactId);
      expect(detail.lists).toEqual([]);
      expect(detail.linkedProfile).toBeNull();
      expect(detail.activity).toEqual({ donationCount: 0, ticketPurchaseCount: 0 });
      expect(detail.lastEmailAt).toBeNull();
    });

    it("isolates detail activity to the requested contact and organization", () => {
      const { db, storage } = createFreshContext();
      const first = uuidFor(4_301);
      const second = uuidFor(4_302);
      for (const [index, contactId] of [first, second].entries()) {
        createContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId,
          displayName: `Contact ${String(index)}`,
          organizationId: ORG_ID,
          requestId: uuidFor(4_310 + index),
        });
      }
      seedTicketPurchaseWithContact(db, 11, second);
      seedDelivery(db, 11, second, "email", "sent", "2026-08-11T10:00:00.000Z");
      const detail = getContactFromStore(storage, ORG_ID, first);
      expect(detail.activity).toEqual({ donationCount: 0, ticketPurchaseCount: 0 });
      expect(detail.lastEmailAt).toBeNull();
      expectContactStoreError(
        () => getContactFromStore(storage, "org-other", first),
        "organization_identity_conflict",
      );
    });

    it("reports no linked profile when the roster reference is dangling", () => {
      const { db, storage } = createFreshContext();
      const contactId = uuidFor(4_401);
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        displayName: "Dangling Link",
        organizationId: ORG_ID,
        requestId: uuidFor(4_402),
      });
      db.prepare("UPDATE contacts SET profile_id = ? WHERE id = ?").run(uuidFor(4_403), contactId);
      expect(getContactFromStore(storage, ORG_ID, contactId).linkedProfile).toBeNull();
    });
  });

  it("rolls back bulk membership writes when any contact is missing", () => {
    const { db, storage } = createFreshContext();
    const first = uuidFor(3301);
    const second = uuidFor(3302);
    for (const contactId of [first, second]) {
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        displayName: `Bulk ${contactId.slice(-4)}`,
        organizationId: ORG_ID,
        requestId: crypto.randomUUID(),
      });
    }
    const listId = uuidFor(3303);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Bulk List",
      organizationId: ORG_ID,
      requestId: crypto.randomUUID(),
    });
    expectContactStoreError(
      () =>
        addContactsToListInStore(storage, {
          actorUserId: ACTOR_ID,
          contactIds: [first, uuidFor(3304), second],
          listId,
          organizationId: ORG_ID,
          requestId: crypto.randomUUID(),
        }),
      "contact_not_found",
    );
    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM contact_list_memberships WHERE list_id = ?",
        listId,
      ),
    ).toBe(0);
  });

  it("enforces bounded bulk sizes", () => {
    const { storage } = createFreshContext();
    const listId = uuidFor(3401);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Bounded",
      organizationId: ORG_ID,
      requestId: uuidFor(3402),
    });
    const tooMany = Array.from({ length: 501 }, (_, index) => uuidFor(5000 + index));
    expectContactStoreError(
      () =>
        addContactsToListInStore(storage, {
          actorUserId: ACTOR_ID,
          contactIds: tooMany,
          listId,
          organizationId: ORG_ID,
          requestId: uuidFor(3403),
        }),
      "validation_failed",
    );
    expectContactStoreError(
      () =>
        removeContactsFromListInStore(storage, {
          actorUserId: ACTOR_ID,
          contactIds: [],
          listId,
          organizationId: ORG_ID,
          requestId: uuidFor(3404),
        }),
      "validation_failed",
    );
  });
});

describe("contact search, pagination, and bounded sizes", () => {
  it("paginates with opaque cursors and bounded limits", () => {
    const { storage } = createFreshContext();
    for (let index = 0; index < 5; index += 1) {
      const padded = String(index + 1).padStart(3, "0");
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId: uuidFor(4001 + index),
        displayName: `Contact ${padded}`,
        organizationId: ORG_ID,
        requestId: uuidFor(4101 + index),
      });
    }
    const first = listContactsFromStore(storage, { limit: 2, organizationId: ORG_ID });
    expect(first.contacts).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = listContactsFromStore(storage, {
      cursor: first.nextCursor,
      limit: 2,
      organizationId: ORG_ID,
    });
    expect(second.contacts).toHaveLength(2);
    expect(second.hasMore).toBe(true);

    const third = listContactsFromStore(storage, {
      cursor: second.nextCursor,
      limit: 2,
      organizationId: ORG_ID,
    });
    expect(third.contacts).toHaveLength(1);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();

    const bounded = listContactsFromStore(storage, { limit: 10_000, organizationId: ORG_ID });
    expect(bounded.contacts.length).toBeLessThanOrEqual(500);
  });

  it("searches by name, email, and phone fragments", () => {
    const { storage } = createFreshContext();
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(4201),
      displayName: "Jane Smith",
      email: "jane.smith@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(4202),
    });
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(4203),
      displayName: "Bob Jones",
      email: "bob@example.com",
      organizationId: ORG_ID,
      phone: "+15550001111",
      requestId: uuidFor(4204),
    });
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, query: "jane" }).contacts,
    ).toHaveLength(1);
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, query: "bob@example" }).contacts,
    ).toHaveLength(1);
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, query: "5550001111" }).contacts,
    ).toHaveLength(1);
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, query: "no-such-person" }).contacts,
    ).toHaveLength(0);
  });

  it("filters by source, list, and communication status", () => {
    const { storage } = createFreshContext();
    const subscribedId = uuidFor(4301);
    const unsubscribedId = uuidFor(4302);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: subscribedId,
      displayName: "Subscribed Import",
      email: "sub@example.com",
      emailStatus: "subscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(4303),
      source: "import",
    });
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: unsubscribedId,
      displayName: "Unsubscribed Manual",
      email: "unsub@example.com",
      emailStatus: "unsubscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(4304),
      source: "manual",
    });
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, source: "import" }).contacts.map(
        (contact) => contact.id,
      ),
    ).toEqual([subscribedId]);
    expect(
      listContactsFromStore(storage, {
        channel: "email",
        organizationId: ORG_ID,
        status: "subscribed",
      }).contacts.map((contact) => contact.id),
    ).toEqual([subscribedId]);

    const listId = uuidFor(4305);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Filtered",
      organizationId: ORG_ID,
      requestId: uuidFor(4306),
    });
    addContactsToListInStore(storage, {
      actorUserId: ACTOR_ID,
      contactIds: [subscribedId],
      listId,
      organizationId: ORG_ID,
      requestId: uuidFor(4307),
    });
    expect(
      listContactsFromStore(storage, { listId, organizationId: ORG_ID }).contacts.map(
        (contact) => contact.id,
      ),
    ).toEqual([subscribedId]);
  });
});

describe("contact consent precedence and audit safety", () => {
  it("keeps unsubscribed status when a later subscribed write arrives", () => {
    const { storage } = createFreshContext();
    const contactId = uuidFor(5001);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      email: "carol@example.com",
      emailStatus: "unsubscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(5002),
    });
    const updated = updateContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      emailStatus: "subscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(5003),
    });
    expect(updated.preferences.find((preference) => preference.channel === "email")?.status).toBe(
      "unsubscribed",
    );

    const promoted = updateContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      organizationId: ORG_ID,
      requestId: uuidFor(5004),
      smsStatus: "unsubscribed",
    });
    expect(promoted.preferences.find((preference) => preference.channel === "sms")?.status).toBe(
      "unsubscribed",
    );
  });

  it("writes append-only audit rows without sensitive contact values", () => {
    const { db, storage } = createFreshContext();
    const email = "audit-sensitive-999@example.com";
    const phone = "+15557654321";
    const contactId = uuidFor(5101);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Audit Subject",
      email,
      organizationId: ORG_ID,
      phone,
      requestId: uuidFor(5102),
    });
    updateContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Audit Subject Updated",
      organizationId: ORG_ID,
      requestId: uuidFor(5103),
    });
    const summaries: string[] = [];
    for (const row of dbAllUnknown(
      db,
      "SELECT change_summary AS changeSummary FROM audit_events WHERE target_id = ?",
      contactId,
    )) {
      if (isChangeSummaryRow(row)) summaries.push(row.changeSummary);
    }
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    for (const summary of summaries) {
      expect(summary).not.toContain(email);
      expect(summary).not.toContain(phone);
      expect(summary).not.toContain("audit-sensitive-999");
    }
  });
});

describe("contact persistence performance with real SQLite", () => {
  it("lists pages with a bounded query count and indexed email lookup", () => {
    const { db, queryCount, resetQueryCount, storage } = createFreshContext();
    const insertContact = db.prepare(
      `INSERT INTO contacts
        (id, first_name, last_name, display_name, email, normalized_email,
         phone, normalized_phone, profile_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertPreference = db.prepare(
      `INSERT INTO contact_communication_preferences
        (contact_id, channel, status, source, observed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (let index = 0; index < 2500; index += 1) {
      const padded = String(index).padStart(5, "0");
      const id = uuidFor(100_000 + index);
      const email = `perf-${padded}@example.com`;
      insertContact.run(
        id,
        `First${padded}`,
        `Last${padded}`,
        `Perf Contact ${padded}`,
        email,
        email,
        null,
        null,
        null,
        "perf-seed",
        now,
        now,
      );
      insertPreference.run(id, "email", "unknown", "perf-seed", now, now);
      insertPreference.run(id, "sms", "unknown", "perf-seed", now, now);
    }

    resetQueryCount();
    const page = listContactsFromStore(storage, { limit: 100, organizationId: ORG_ID });
    expect(page.contacts).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    // One indexed SELECT per page; regressions that fan out to N+1 fail here.
    expect(queryCount()).toBeLessThanOrEqual(3);

    resetQueryCount();
    const found = listContactsFromStore(storage, {
      limit: 5,
      organizationId: ORG_ID,
      query: "perf-01234@example.com",
    });
    expect(found.contacts).toHaveLength(1);
    expect(queryCount()).toBeLessThanOrEqual(3);

    const planDetails: string[] = [];
    for (const row of dbAllUnknown(
      db,
      "EXPLAIN QUERY PLAN SELECT id FROM contacts WHERE normalized_email = ?",
      "perf-00001@example.com",
    )) {
      if (isPlanDetailRow(row)) planDetails.push(row.detail);
    }
    expect(planDetails.some((detail) => /USING .*INDEX/i.test(detail))).toBe(true);
    expect(planDetails.some((detail) => /idx_contacts_normalized_email/i.test(detail))).toBe(true);
  });

  it("adds hundreds of memberships with bulk indexed checks instead of O(N^2) scans", () => {
    const { queryCount, resetQueryCount, storage } = createFreshContext();
    const contactIds: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      const contactId = uuidFor(6000 + index);
      contactIds.push(contactId);
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        displayName: `Bulk Perf ${String(index).padStart(4, "0")}`,
        organizationId: ORG_ID,
        requestId: uuidFor(7000 + index),
      });
    }
    const listId = uuidFor(7999);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Perf List",
      organizationId: ORG_ID,
      requestId: uuidFor(7998),
    });

    resetQueryCount();
    const result = addContactsToListInStore(storage, {
      actorUserId: ACTOR_ID,
      contactIds,
      listId,
      organizationId: ORG_ID,
      requestId: uuidFor(7997),
    });
    expect(result.added).toBe(400);
    // Bulk path uses a constant number of reads plus one bulk write and one
    // audit write; per-contact SELECTs would exceed this bound.
    expect(queryCount()).toBeLessThanOrEqual(12);

    resetQueryCount();
    const retry = addContactsToListInStore(storage, {
      actorUserId: ACTOR_ID,
      contactIds,
      listId,
      organizationId: ORG_ID,
      requestId: uuidFor(7996),
    });
    expect(retry.added).toBe(0);
    expect(queryCount()).toBeLessThanOrEqual(6);
  });
});

describe("contact list enrichment for the management UI (Phase 4)", () => {
  it("returns empty enrichment by default and batched details when opted in", () => {
    const { storage } = createFreshContext();
    const contactId = uuidFor(9001);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Enriched Contact",
      email: "enriched@example.com",
      emailStatus: "subscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(9002),
    });
    const listId = uuidFor(9003);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Newsletter",
      organizationId: ORG_ID,
      requestId: uuidFor(9004),
    });
    addContactsToListInStore(storage, {
      actorUserId: ACTOR_ID,
      contactIds: [contactId],
      listId,
      organizationId: ORG_ID,
      requestId: uuidFor(9005),
    });

    const plain = listContactsFromStore(storage, { organizationId: ORG_ID });
    expect(plain.contacts).toHaveLength(1);
    expect(plain.memberships).toEqual([]);
    expect(plain.preferences).toEqual([]);

    const enriched = listContactsFromStore(storage, {
      includeDetails: true,
      organizationId: ORG_ID,
    });
    expect(enriched.contacts).toHaveLength(1);
    expect(enriched.memberships).toHaveLength(1);
    expect(enriched.memberships[0]).toMatchObject({ contactId, listId });
    const emailPreference = enriched.preferences.find(
      (preference) => preference.contactId === contactId && preference.channel === "email",
    );
    expect(emailPreference?.status).toBe("subscribed");
  });
});
