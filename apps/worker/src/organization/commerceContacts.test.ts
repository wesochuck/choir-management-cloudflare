import type { SqlStorageValue } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  backfillCommerceContactLinks,
  linkPaidDonationContact,
  linkPaidTicketPurchaseContact,
  resolveOrCreateContactForCommerce,
} from "./commerceContacts";
import {
  createContactInStore,
  deleteContactInStore,
  type ContactStoreStorage,
} from "./contactStore";
import { createDonationCheckout } from "./donation/checkout";
import { createManualDonation } from "./donation/manual";
import { completeStripeDonation } from "./donation/stripeLifecycle";
import { organizationSchemaMigrations } from "./schema/migrations";
import { createFakeCheckout } from "./ticketingStore/checkout";
import { completeStripeTicketPurchase } from "./ticketingStore/payments";

const ORG_ID = "org-commerce-contacts-test";
const ACTOR_ID = "user-tester-001";
const NOW = "2026-03-01T12:00:00.000Z";

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

function isRecordWithKey(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

function isVersionRow(value: unknown): value is { readonly version: number } {
  return isRecordWithKey(value, "version") && typeof descriptorValue(value, "version") === "number";
}

function isNameRow(value: unknown): value is { readonly name: string } {
  return isRecordWithKey(value, "name") && typeof descriptorValue(value, "name") === "string";
}

function isContactIdRow(value: unknown): value is { readonly contactId: string | null } {
  if (!isRecordWithKey(value, "contactId")) return false;
  const contactId = descriptorValue(value, "contactId");
  return contactId === null || typeof contactId === "string";
}

function isBuyerSnapshotRow(value: unknown): value is { buyerEmail: string; buyerName: string } {
  return (
    isRecordWithKey(value, "buyerEmail") &&
    isRecordWithKey(value, "buyerName") &&
    typeof descriptorValue(value, "buyerEmail") === "string" &&
    typeof descriptorValue(value, "buyerName") === "string"
  );
}

function isContactDetailRow(
  value: unknown,
): value is { displayName: string | null; email: string | null; phone: string | null } {
  if (!isRecordWithKey(value, "displayName")) return false;
  if (!isRecordWithKey(value, "email")) return false;
  if (!isRecordWithKey(value, "phone")) return false;
  const displayName = descriptorValue(value, "displayName");
  const email = descriptorValue(value, "email");
  const phone = descriptorValue(value, "phone");
  return (
    (displayName === null || typeof displayName === "string") &&
    (email === null || typeof email === "string") &&
    (phone === null || typeof phone === "string")
  );
}

function isCountRow(value: unknown): value is { readonly count: number } {
  return isRecordWithKey(value, "count") && typeof descriptorValue(value, "count") === "number";
}

function isStatusRow(value: unknown): value is { readonly status: string } {
  return isRecordWithKey(value, "status") && typeof descriptorValue(value, "status") === "string";
}

interface TestContext {
  readonly db: DatabaseSync;
  readonly storage: ContactStoreStorage;
}

function createAdapter(db: DatabaseSync): ContactStoreStorage {
  let depth = 0;
  const exec = <T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: readonly unknown[]
  ): { readonly one: () => T; readonly toArray: () => T[] } & Iterable<T> => {
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
    // Execute the real forward-only DDL; data-only apply() backfills are out
    // of scope for commerce-linkage tests, matching contact persistence tests.
    for (const statement of migration.statements) {
      db.exec(statement);
    }
    db.prepare(
      "INSERT INTO organization_schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run(migration.version, NOW);
    applied.add(migration.version);
  }
}

function createFreshContext(): TestContext {
  const db = new DatabaseSync(":memory:");
  const storage = createAdapter(db);
  runMigrations(db);
  db.prepare(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, lifecycle_state, created_at, updated_at)
     VALUES (?, 'Commerce Test Org', 'commerce-test', 'active', ?, ?)`,
  ).run(ORG_ID, NOW, NOW);
  return { db, storage };
}

function uuidFor(index: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${index.toString(16).padStart(12, "0")}`;
}

/** Commerce store functions take DurableObjectStorage; the adapter serves the exercised surface. */
function asDurable(storage: ContactStoreStorage): DurableObjectStorage {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only structural adapter for the sql/transactionSync surface; call-site compatibility is verified by typecheck.
  return storage as unknown as DurableObjectStorage;
}

function tableHasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return dbAllUnknown(db, `PRAGMA table_info(${table})`).some(
    (row) => isNameRow(row) && row.name === column,
  );
}

function indexExists(db: DatabaseSync, name: string): boolean {
  return dbAllUnknown(db, "SELECT name FROM sqlite_master WHERE type = 'index'").some(
    (row) => isNameRow(row) && row.name === name,
  );
}

let purchaseSequence = 0;
let donationSequence = 0;

function insertTicketPurchase(
  db: DatabaseSync,
  args: {
    readonly buyerEmail: string;
    readonly buyerName?: string | undefined;
    readonly id?: string | undefined;
    readonly marketingOptIn?: boolean | undefined;
    readonly status?: string | undefined;
  },
): string {
  purchaseSequence += 1;
  const id = args.id ?? uuidFor(10_000 + purchaseSequence);
  db.prepare(
    `INSERT INTO ticket_purchases
      (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
       buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
       provider_session_id, provider_payment_id, status, marketing_opt_in,
       created_at, updated_at, contact_id)
     VALUES (?, ?, ?, 'Spring Concert', ?, 'UTC', ?, ?, 1, 500, 0, 500, ?, '', ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    uuidFor(20_000 + purchaseSequence),
    uuidFor(777),
    NOW,
    args.buyerName ?? "Buyer",
    args.buyerEmail,
    `seed_session_${id}`,
    args.status ?? "paid",
    args.marketingOptIn === false ? 0 : 1,
    NOW,
    NOW,
  );
  return id;
}

function insertDonation(
  db: DatabaseSync,
  args: {
    readonly buyerEmail: string;
    readonly buyerName?: string | undefined;
    readonly id?: string | undefined;
    readonly marketingConsent?: boolean | undefined;
    readonly status?: string | undefined;
  },
): string {
  donationSequence += 1;
  const id = args.id ?? uuidFor(30_000 + donationSequence);
  db.prepare(
    `INSERT INTO donations
      (id, checkout_request_id, status, amount_cents, buyer_name, buyer_email,
       provider_session_id, provider_payment_id, created_at, updated_at, marketing_consent, contact_id)
     VALUES (?, ?, ?, 1000, ?, ?, ?, '', ?, ?, ?, NULL)`,
  ).run(
    id,
    uuidFor(40_000 + donationSequence),
    args.status ?? "paid",
    args.buyerName ?? "Donor",
    args.buyerEmail,
    `seed_dsession_${id}`,
    NOW,
    NOW,
    args.marketingConsent === false ? 0 : 1,
  );
  return id;
}

function ticketContactId(db: DatabaseSync, purchaseId: string): string | null {
  for (const row of dbAllUnknown(
    db,
    "SELECT contact_id AS contactId FROM ticket_purchases WHERE id = ?",
    purchaseId,
  )) {
    if (isContactIdRow(row)) return row.contactId;
  }
  throw new Error(`Ticket purchase not found: ${purchaseId}`);
}

function donationContactId(db: DatabaseSync, donationId: string): string | null {
  for (const row of dbAllUnknown(
    db,
    "SELECT contact_id AS contactId FROM donations WHERE id = ?",
    donationId,
  )) {
    if (isContactIdRow(row)) return row.contactId;
  }
  throw new Error(`Donation not found: ${donationId}`);
}

function ticketSnapshot(
  db: DatabaseSync,
  purchaseId: string,
): { buyerEmail: string; buyerName: string } {
  for (const row of dbAllUnknown(
    db,
    "SELECT buyer_name AS buyerName, buyer_email AS buyerEmail FROM ticket_purchases WHERE id = ?",
    purchaseId,
  )) {
    if (isBuyerSnapshotRow(row)) return { buyerEmail: row.buyerEmail, buyerName: row.buyerName };
  }
  throw new Error(`Ticket purchase not found: ${purchaseId}`);
}

function countContacts(db: DatabaseSync): number {
  for (const row of dbAllUnknown(db, "SELECT COUNT(*) AS count FROM contacts")) {
    if (isCountRow(row)) return row.count;
  }
  throw new Error("Unable to count contacts.");
}

function contactRow(
  db: DatabaseSync,
  contactId: string,
): { displayName: string | null; email: string | null; phone: string | null } {
  for (const row of dbAllUnknown(
    db,
    "SELECT display_name AS displayName, email, phone FROM contacts WHERE id = ?",
    contactId,
  )) {
    if (isContactDetailRow(row))
      return { displayName: row.displayName, email: row.email, phone: row.phone };
  }
  throw new Error(`Contact not found: ${contactId}`);
}

function emailPreference(db: DatabaseSync, contactId: string): string | null {
  for (const row of dbAllUnknown(
    db,
    "SELECT status FROM contact_communication_preferences WHERE contact_id = ? AND channel = 'email'",
    contactId,
  )) {
    if (isStatusRow(row)) return row.status;
  }
  return null;
}

function seedTicketEvent(db: DatabaseSync): string {
  const eventId = uuidFor(777);
  const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  db.prepare(
    `INSERT INTO events
      (id, title, type, starts_at, created_at, updated_at,
       is_ticketing_enabled, advance_price_cents, day_of_price_cents)
     VALUES (?, 'Spring Concert', 'Performance', ?, ?, ?, 1, 2000, 2500)`,
  ).run(eventId, startsAt, NOW, NOW);
  return eventId;
}

describe("commerce contact migration with real SQLite", () => {
  it("adds nullable contact_id columns with indexes while keeping snapshots", () => {
    const { db } = createFreshContext();
    for (const table of ["ticket_purchases", "donations"] as const) {
      expect(tableHasColumn(db, table, "contact_id")).toBe(true);
      for (const snapshot of ["buyer_name", "buyer_email"]) {
        expect(tableHasColumn(db, table, snapshot)).toBe(true);
      }
    }
    expect(indexExists(db, "idx_ticket_purchases_contact_id")).toBe(true);
    expect(indexExists(db, "idx_donations_contact_id")).toBe(true);
    const purchaseId = insertTicketPurchase(db, {
      buyerEmail: "buyer@example.com",
      buyerName: "Buyer",
    });
    expect(ticketContactId(db, purchaseId)).toBeNull();
    expect(ticketSnapshot(db, purchaseId)).toEqual({
      buyerEmail: "buyer@example.com",
      buyerName: "Buyer",
    });
  });
});

describe("resolveOrCreateContactForCommerce", () => {
  it("reuses an existing linked contact without touching curated fields", () => {
    const { db, storage } = createFreshContext();
    const contactId = uuidFor(101);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Jane Smith",
      email: "jane@example.com",
      organizationId: ORG_ID,
      phone: "+15551234567",
      requestId: uuidFor(102),
      source: "admin",
    });
    const resolved = resolveOrCreateContactForCommerce(storage, {
      buyerEmail: "JANE@example.com",
      buyerName: "Jnae Smtih",
      existingContactId: contactId,
      marketingOptIn: true,
      occurredAt: NOW,
      source: "ticket_purchase",
    });
    expect(resolved).toBe(contactId);
    expect(countContacts(db)).toBe(1);
    expect(contactRow(db, contactId)).toEqual({
      displayName: "Jane Smith",
      email: "jane@example.com",
      phone: "+15551234567",
    });
  });

  it("matches by normalized email and never merges on name alone", () => {
    const { db, storage } = createFreshContext();
    const jane = uuidFor(111);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: jane,
      displayName: "Jane Smith",
      email: "jane@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(112),
      source: "admin",
    });
    const matched = resolveOrCreateContactForCommerce(storage, {
      buyerEmail: "  Jane@Example.COM ",
      buyerName: "Jnae Smtih",
      marketingOptIn: false,
      occurredAt: NOW,
      source: "donation",
    });
    expect(matched).toBe(jane);
    // Same display name but a different email is a different person.
    const other = resolveOrCreateContactForCommerce(storage, {
      buyerEmail: "jane.smith2@example.com",
      buyerName: "Jane Smith",
      marketingOptIn: true,
      occurredAt: NOW,
      source: "donation",
    });
    expect(other).not.toBe(jane);
    expect(countContacts(db)).toBe(2);
    expect(contactRow(db, jane).displayName).toBe("Jane Smith");
  });

  it("returns null without creating bogus contacts for missing or invalid email", () => {
    const { db, storage } = createFreshContext();
    for (const buyerEmail of ["", "   ", "not-an-email", "a@b", "x".repeat(400)]) {
      expect(
        resolveOrCreateContactForCommerce(storage, {
          buyerEmail,
          buyerName: "Mystery Buyer",
          marketingOptIn: true,
          occurredAt: NOW,
          source: "ticket_purchase",
        }),
      ).toBeNull();
    }
    expect(countContacts(db)).toBe(0);
  });

  it("falls back to phone only when no usable email exists", () => {
    const { db, storage } = createFreshContext();
    const byPhone = resolveOrCreateContactForCommerce(storage, {
      buyerEmail: "",
      buyerName: "Phone Buyer",
      marketingOptIn: false,
      occurredAt: NOW,
      phone: "+1 (555) 123-4567",
      source: "donation",
    });
    expect(byPhone).not.toBeNull();
    const again = resolveOrCreateContactForCommerce(storage, {
      buyerEmail: "",
      buyerName: "Different Name Same Phone",
      marketingOptIn: false,
      occurredAt: NOW,
      phone: "+15551234567",
      source: "donation",
    });
    expect(again).toBe(byPhone);
    expect(countContacts(db)).toBe(1);
    // A new email with someone else's phone does not merge via phone.
    const separate = resolveOrCreateContactForCommerce(storage, {
      buyerEmail: "stranger@example.com",
      buyerName: "Stranger",
      marketingOptIn: false,
      occurredAt: NOW,
      phone: "+15551234567",
      source: "donation",
    });
    expect(separate).not.toBe(byPhone);
    expect(countContacts(db)).toBe(2);
  });

  it("records subscribed only for opted-in commerce contacts", () => {
    const { db, storage } = createFreshContext();
    const optedIn = resolveOrCreateContactForCommerce(storage, {
      buyerEmail: "opted@example.com",
      buyerName: "Opted In",
      marketingOptIn: true,
      occurredAt: NOW,
      source: "ticket_purchase",
    });
    const silent = resolveOrCreateContactForCommerce(storage, {
      buyerEmail: "silent@example.com",
      buyerName: "Silent",
      marketingOptIn: false,
      occurredAt: NOW,
      source: "donation",
    });
    expect(optedIn).not.toBeNull();
    expect(silent).not.toBeNull();
    expect(emailPreference(db, optedIn ?? "")).toBe("subscribed");
    expect(emailPreference(db, silent ?? "")).toBe("unknown");
  });
});

describe("commerce contact backfill", () => {
  it("links donor and buyer sharing an email to one contact and is replay-safe", () => {
    const { db, storage } = createFreshContext();
    const purchaseId = insertTicketPurchase(db, {
      buyerEmail: "jane@example.com",
      buyerName: "Jane",
    });
    const donationId = insertDonation(db, {
      buyerEmail: "JANE@EXAMPLE.COM",
      buyerName: "Jane S",
    });
    const first = backfillCommerceContactLinks(storage, { batchSize: 50 });
    expect(first.completed).toBe(true);
    expect(first.contactsCreated).toBe(1);
    expect(first.contactsLinked).toBe(2);
    expect(first.skippedRows).toBe(0);
    expect(ticketContactId(db, purchaseId)).not.toBeNull();
    expect(ticketContactId(db, purchaseId)).toBe(donationContactId(db, donationId));

    const mapping = new Map([
      [purchaseId, ticketContactId(db, purchaseId)],
      [donationId, donationContactId(db, donationId)],
    ]);
    const second = backfillCommerceContactLinks(storage, { batchSize: 50 });
    expect(second.contactsCreated).toBe(0);
    expect(second.contactsLinked).toBe(0);
    expect(countContacts(db)).toBe(1);
    expect(ticketContactId(db, purchaseId)).toBe(mapping.get(purchaseId));
    expect(donationContactId(db, donationId)).toBe(mapping.get(donationId));
  });

  it("collapses ten purchases by one person into one contact", () => {
    const { db, storage } = createFreshContext();
    const ids = Array.from({ length: 10 }, (_, index) =>
      insertTicketPurchase(db, {
        buyerEmail: index % 2 === 0 ? "sam@example.com" : " Sam@Example.com ",
        buyerName: `Sam Variant ${String(index)}`,
      }),
    );
    const result = backfillCommerceContactLinks(storage, { batchSize: 3, maxBatches: 10 });
    expect(result.completed).toBe(true);
    expect(result.contactsCreated).toBe(1);
    expect(countContacts(db)).toBe(1);
    const linked = new Set(ids.map((id) => ticketContactId(db, id)));
    expect(linked.size).toBe(1);
    expect([...linked][0]).not.toBeNull();
    // Snapshots keep each transaction's own spelling.
    expect(ticketSnapshot(db, ids[0] ?? "").buyerName).toBe("Sam Variant 0");
  });

  it("keeps same-name different-email buyers separate and skips bad emails", () => {
    const { db, storage } = createFreshContext();
    const alexOne = insertTicketPurchase(db, {
      buyerEmail: "alex.one@example.com",
      buyerName: "Alex",
    });
    const alexTwo = insertDonation(db, { buyerEmail: "alex.two@example.com", buyerName: "Alex" });
    const missing = insertTicketPurchase(db, { buyerEmail: "   ", buyerName: "No Email" });
    const invalid = insertDonation(db, { buyerEmail: "not-an-email", buyerName: "Bad Email" });
    const result = backfillCommerceContactLinks(storage, { batchSize: 10 });
    expect(result.completed).toBe(true);
    expect(countContacts(db)).toBe(2);
    expect(ticketContactId(db, alexOne)).not.toBe(donationContactId(db, alexTwo));
    expect(ticketContactId(db, missing)).toBeNull();
    expect(donationContactId(db, invalid)).toBeNull();
    expect(result.skippedRows).toBe(1);
  });

  it("preserves pre-linked contacts and never overwrites curated fields", () => {
    const { db, storage } = createFreshContext();
    const curated = uuidFor(201);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: curated,
      displayName: "Curated Name",
      email: "curated@example.com",
      organizationId: ORG_ID,
      phone: "+15550001111",
      requestId: uuidFor(202),
      source: "admin",
    });
    const other = uuidFor(203);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: other,
      displayName: "Other",
      email: "other@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(204),
      source: "admin",
    });
    // Linked to curated even though the email now matches the other contact.
    const purchaseId = insertTicketPurchase(db, {
      buyerEmail: "other@example.com",
      buyerName: "Typo Nmae",
    });
    db.prepare("UPDATE ticket_purchases SET contact_id = ? WHERE id = ?").run(curated, purchaseId);
    const result = backfillCommerceContactLinks(storage, { batchSize: 10 });
    expect(result.contactsLinked).toBe(0);
    expect(ticketContactId(db, purchaseId)).toBe(curated);
    expect(contactRow(db, curated).displayName).toBe("Curated Name");
    expect(ticketSnapshot(db, purchaseId).buyerName).toBe("Typo Nmae");
  });

  it("ignores unpaid transactions and never creates contacts for them", () => {
    const { db, storage } = createFreshContext();
    const pending = insertTicketPurchase(db, {
      buyerEmail: "pending@example.com",
      status: "pending",
    });
    expect(linkPaidTicketPurchaseContact(storage, pending)).toBeNull();
    expect(linkPaidDonationContact(storage, "bbbbbbbb-bbbb-4bbb-8bbb-000000000000")).toBeNull();
    const result = backfillCommerceContactLinks(storage, { batchSize: 10 });
    expect(result.completed).toBe(true);
    expect(countContacts(db)).toBe(0);
    expect(ticketContactId(db, pending)).toBeNull();
  });
});

describe("new commerce transactions link contacts", () => {
  it("links a paid ticket purchase and leaves pending rows for fulfillment", () => {
    const { db, storage } = createFreshContext();
    const eventId = seedTicketEvent(db);
    const durable = asDurable(storage);
    const paid = createFakeCheckout(
      durable,
      {
        action: "create_fake_checkout",
        checkout: {
          buyerEmail: "newbuyer@example.com",
          buyerName: "New Buyer",
          checkoutRequestId: uuidFor(301),
          eventId,
          marketingOptIn: true,
          quantity: 2,
        },
        organizationId: ORG_ID,
        providerSessionId: `fake_session_${uuidFor(302)}`,
        purchaseId: uuidFor(303),
      },
      { organizationId: ORG_ID, timezone: "UTC" },
    );
    expect(paid.status).toBe(201);
    expect(ticketContactId(db, uuidFor(303))).not.toBeNull();
    expect(countContacts(db)).toBe(1);

    const pending = createFakeCheckout(
      durable,
      {
        action: "create_stripe_pending",
        checkout: {
          buyerEmail: "later@example.com",
          buyerName: "Later Buyer",
          checkoutRequestId: uuidFor(304),
          eventId,
          marketingOptIn: true,
          quantity: 1,
        },
        organizationId: ORG_ID,
        providerSessionId: "stripe_session_pending_1",
        purchaseId: uuidFor(305),
      },
      { organizationId: ORG_ID, timezone: "UTC" },
    );
    expect(pending.status).toBe(201);
    expect(ticketContactId(db, uuidFor(305))).toBeNull();

    const completed = completeStripeTicketPurchase(durable, {
      action: "stripe_ticket_completed",
      organizationId: ORG_ID,
      providerPaymentId: "pay_test_1",
      providerSessionId: "stripe_session_pending_1",
      stripeEventId: "evt_test_1",
    });
    expect(completed.response.status).toBe(200);
    expect(completed.schedulerWorkQueued).toBe(true);
    expect(ticketContactId(db, uuidFor(305))).not.toBeNull();
    expect(countContacts(db)).toBe(2);
  });

  it("links paid donations, manual gifts, and stripe completions", () => {
    const { db, storage } = createFreshContext();
    const durable = asDurable(storage);
    const paid = createDonationCheckout(durable, {
      action: "create_donation_checkout",
      checkout: {
        amountCents: 2500,
        anonymous: false,
        buyerEmail: "donor@example.com",
        buyerName: "Donor",
        checkoutRequestId: uuidFor(401),
        marketingConsent: true,
        tributeName: "",
        tributeNotifyEmail: "",
        tributeType: "none",
      },
      donationId: uuidFor(402),
      organizationId: ORG_ID,
      providerSessionId: `fake_dsession_${uuidFor(403)}`,
    });
    expect(paid.status).toBe(201);
    const donorContact = donationContactId(db, uuidFor(402));
    expect(donorContact).not.toBeNull();
    expect(emailPreference(db, donorContact ?? "")).toBe("subscribed");

    const manual = createManualDonation(durable, {
      action: "create_manual_donation",
      actorUserId: ACTOR_ID,
      donation: {
        amountCents: 500,
        anonymous: false,
        buyerEmail: "",
        buyerName: "Cash Donor",
        marketingConsent: false,
        paymentMethod: "cash",
        paymentReference: "",
        thankYouSent: false,
        tributeName: "",
        tributeNotifyEmail: "",
        tributeType: "none",
      },
      donationId: uuidFor(404),
      organizationId: ORG_ID,
      requestId: uuidFor(405),
    });
    expect(manual.status).toBe(201);
    expect(donationContactId(db, uuidFor(404))).toBeNull();

    const pending = createDonationCheckout(durable, {
      action: "create_stripe_pending_donation",
      checkout: {
        amountCents: 1000,
        anonymous: false,
        buyerEmail: "pending.donor@example.com",
        buyerName: "Pending Donor",
        checkoutRequestId: uuidFor(406),
        marketingConsent: false,
        tributeName: "",
        tributeNotifyEmail: "",
        tributeType: "none",
      },
      donationId: uuidFor(407),
      organizationId: ORG_ID,
      providerSessionId: "stripe_dsession_pending_1",
    });
    expect(pending.status).toBe(201);
    expect(donationContactId(db, uuidFor(407))).toBeNull();
    const completed = completeStripeDonation(durable, {
      action: "stripe_donation_completed",
      organizationId: ORG_ID,
      providerPaymentId: "pi_test_1",
      providerSessionId: "stripe_dsession_pending_1",
      stripeEventId: "evt_donation_1",
    });
    expect(completed.status).toBe(200);
    const pendingContact = donationContactId(db, uuidFor(407));
    expect(pendingContact).not.toBeNull();
    expect(emailPreference(db, pendingContact ?? "")).toBe("unknown");
    expect(countContacts(db)).toBe(2);
  });
});

describe("contact deletion nulls commerce links", () => {
  it("sets contact_id null while keeping transaction snapshots", () => {
    const { db, storage } = createFreshContext();
    const purchaseId = insertTicketPurchase(db, {
      buyerEmail: "bye@example.com",
      buyerName: "Bye Buyer",
    });
    const donationId = insertDonation(db, {
      buyerEmail: "bye@example.com",
      buyerName: "Bye Donor",
    });
    backfillCommerceContactLinks(storage, { batchSize: 10 });
    const contactId = ticketContactId(db, purchaseId);
    expect(contactId).not.toBeNull();
    expect(donationContactId(db, donationId)).toBe(contactId);
    deleteContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: contactId ?? "",
      organizationId: ORG_ID,
      requestId: uuidFor(501),
    });
    expect(ticketContactId(db, purchaseId)).toBeNull();
    expect(donationContactId(db, donationId)).toBeNull();
    expect(ticketSnapshot(db, purchaseId)).toEqual({
      buyerEmail: "bye@example.com",
      buyerName: "Bye Buyer",
    });
  });
});
