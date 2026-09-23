import type { SqlStorageValue } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import type { CommunicationAudienceRequest } from "@choir/contracts";
import { communicationRecipientSubjectSchema } from "@choir/contracts";
import { dedupeCommunicationCandidates, type CommunicationRecipientCandidate } from "@choir/domain";
import { organizationSchemaMigrations } from "../schema/migrations";
import { resolveCommunicationAudienceFromStore } from "./audience";
import { sendOperationSchema, type CommunicationAudienceStorage } from "./contracts";

const ORG_ID = "org-audience-test";

interface AudienceRecipient {
  readonly displayName: string;
  readonly doNotEmail: boolean;
  readonly email: string | null;
  readonly emailSuppressed: boolean;
  readonly emailUnsubscribed: boolean;
  readonly phone: string | null;
  readonly profileId: string;
  readonly providerBounced: boolean;
  readonly smsSuppressed: boolean;
  readonly smsUnsubscribed: boolean;
  readonly subject?: { readonly kind: string };
  readonly voicePart: string;
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

function isRowArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

function createStorage(db: DatabaseSync): CommunicationAudienceStorage {
  const exec = <T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: readonly unknown[]
  ): { readonly toArray: () => T[] } => {
    const statement = db.prepare(query);
    const params = bindings.map(toSupportedValue);
    if (/^\s*(SELECT|PRAGMA|EXPLAIN|WITH)/i.test(query)) {
      const raw: unknown = statement.all(...params);
      if (!isRowArray<T>(raw)) throw new Error("Expected query rows.");
      return { toArray: () => raw };
    }
    statement.run(...params);
    return { toArray: () => [] };
  };
  return { sql: { exec } };
}

function seedDatabase(): {
  readonly db: DatabaseSync;
  readonly storage: CommunicationAudienceStorage;
} {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE IF NOT EXISTS organization_schema_migrations (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT`);
  for (const migration of organizationSchemaMigrations) {
    for (const statement of migration.statements) {
      db.exec(statement);
    }
  }
  // organization_metadata defaults (roster config, timezone) apply here.
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, lifecycle_state, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(ORG_ID, "Audience Test Org", "audience-test", now, now);
  return { db, storage: createStorage(db) };
}

let idCounter = 0;
function uuidFor(tag: string): string {
  idCounter += 1;
  const tagHash = Array.from(tag).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  const suffix = `${tagHash.toString(16).padStart(4, "0")}${idCounter.toString(16).padStart(8, "0")}`;
  return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix.slice(-12)}`;
}

function seedProfile(
  db: DatabaseSync,
  input: { readonly displayName: string; readonly id?: string; readonly voicePart?: string },
): string {
  const id = input.id ?? uuidFor("profile");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profiles (id, display_name, voice_part, global_status, created_at, updated_at)
     VALUES (?, ?, ?, 'Active', ?, ?)`,
  ).run(id, input.displayName, input.voicePart ?? "S1", now, now);
  return id;
}

function seedContact(
  db: DatabaseSync,
  input: {
    readonly displayName: string;
    readonly email?: string | null;
    readonly emailSource?: string | null;
    readonly emailStatus?: "unknown" | "subscribed" | "unsubscribed";
    readonly id?: string;
    readonly phone?: string | null;
    readonly profileId?: string | null;
    readonly smsStatus?: "unknown" | "subscribed" | "unsubscribed";
    readonly source?: string | null;
  },
): string {
  const id = input.id ?? uuidFor("contact");
  const now = new Date().toISOString();
  const email = input.email ?? null;
  const phone = input.phone ?? null;
  db.prepare(
    `INSERT INTO contacts
      (id, first_name, last_name, display_name, email, normalized_email,
       phone, normalized_phone, profile_id, source, created_at, updated_at)
     VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.displayName,
    email,
    email === null ? null : email.trim().toLowerCase(),
    phone,
    phone,
    input.profileId ?? null,
    input.source ?? null,
    now,
    now,
  );
  const preferences: readonly (readonly ["email" | "sms", string])[] = [
    ["email", input.emailStatus ?? "unknown"],
    ["sms", input.smsStatus ?? "unknown"],
  ];
  for (const [channel, status] of preferences) {
    db.prepare(
      `INSERT INTO contact_communication_preferences
        (contact_id, channel, status, source, observed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, channel, status, channel === "email" ? (input.emailSource ?? null) : null, now, now);
  }
  return id;
}

function seedList(db: DatabaseSync, name: string): string {
  const id = uuidFor("list");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO contact_lists (id, name, description, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?)`,
  ).run(id, name, now, now);
  return id;
}

function addToList(db: DatabaseSync, contactId: string, listId: string): void {
  db.prepare(
    `INSERT INTO contact_list_memberships (contact_id, list_id, created_at) VALUES (?, ?, ?)`,
  ).run(contactId, listId, new Date().toISOString());
}

function suppressProfile(db: DatabaseSync, profileId: string, channel = "email"): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO communication_suppressions
      (id, profile_id, channel, reason, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user_unsubscribe', 1, ?, ?)`,
  ).run(uuidFor("supp"), profileId, channel, now, now);
}

function seedTicketPurchase(
  db: DatabaseSync,
  buyerName: string,
  buyerEmail: string,
  options: {
    readonly eventId?: string;
    readonly marketingOptIn?: boolean;
    readonly status?: "expired" | "paid" | "pending" | "refunded";
  } = {},
): string {
  const id = uuidFor("purchase");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ticket_purchases
      (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
       buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
       currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
       created_at, updated_at, included_events_json, bundle_title)
     VALUES (?, ?, ?, 'Spring concert', ?, 'America/New_York', ?, ?, 1, 2000, 100, 2100,
       'usd', ?, '', ?, ?, ?, ?, '[]', '')`,
  ).run(
    id,
    uuidFor("checkout"),
    options.eventId ?? uuidFor("event"),
    new Date(Date.now() + 86_400_000).toISOString(),
    buyerName,
    buyerEmail,
    uuidFor("session"),
    options.status ?? "paid",
    options.marketingOptIn === false ? 0 : 1,
    now,
    now,
  );
  return id;
}

function seedDonation(db: DatabaseSync, buyerName: string, buyerEmail: string): string {
  const id = uuidFor("donation");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO donations
      (id, checkout_request_id, status, amount_cents, buyer_name, buyer_email,
       provider_session_id, created_at, updated_at, marketing_consent)
     VALUES (?, ?, 'paid', 5000, ?, ?, ?, ?, ?, 1)`,
  ).run(id, uuidFor("checkout"), buyerName, buyerEmail, uuidFor("session"), now, now);
  return id;
}

function seedCanceledEvent(db: DatabaseSync): string {
  const id = uuidFor("canceled-event");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
     VALUES (?, 'Canceled performance', 'Performance', ?, ?, ?)`,
  ).run(id, now, now, now);
  db.prepare("UPDATE events SET is_canceled = 1 WHERE id = ?").run(id);
  return id;
}

function addBundleAllocation(db: DatabaseSync, purchaseId: string, eventId: string): void {
  db.prepare(
    `INSERT INTO ticket_bundle_allocations (purchase_id, event_id, quantity)
     VALUES (?, ?, 1)`,
  ).run(purchaseId, eventId);
}

/**
 * Phase 9 production linkage: checkout and the commerce backfill write
 * `contact_id` on paid transactions. Tests mirror that instead of leaving
 * legacy unlinked rows, which the audience now skips rather than minting
 * as pseudo-profile recipients.
 */
function linkTransactionContact(
  db: DatabaseSync,
  table: "donations" | "ticket_purchases",
  transactionId: string,
  contactId: string,
): void {
  db.prepare(`UPDATE ${table} SET contact_id = ? WHERE id = ?`).run(contactId, transactionId);
}

function isRecipient(value: unknown): value is AudienceRecipient {
  if (typeof value !== "object" || value === null) return false;
  return "profileId" in value && "displayName" in value;
}

async function resolveAudience(
  storage: CommunicationAudienceStorage,
  audience: CommunicationAudienceRequest,
  organizationId: string = ORG_ID,
): Promise<{
  readonly recipients: AudienceRecipient[];
  readonly status: number;
  readonly ticketBuyerPurchasesOverLimit: number;
  readonly undeliverableTicketBuyerPurchases: number;
}> {
  const request = new Request("https://organization.internal/internal/communications/audience", {
    body: JSON.stringify({ audience, organizationId }),
    method: "POST",
  });
  const response = await resolveCommunicationAudienceFromStore(storage, request);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("recipients" in body)) {
    return {
      recipients: [],
      status: response.status,
      ticketBuyerPurchasesOverLimit: 0,
      undeliverableTicketBuyerPurchases: 0,
    };
  }
  const recipients = body.recipients;
  const list = Array.isArray(recipients) ? recipients.filter(isRecipient) : [];
  const undeliverableTicketBuyerPurchases =
    "undeliverableTicketBuyerPurchases" in body &&
    typeof body.undeliverableTicketBuyerPurchases === "number"
      ? body.undeliverableTicketBuyerPurchases
      : 0;
  const ticketBuyerPurchasesOverLimit =
    "ticketBuyerPurchasesOverLimit" in body &&
    typeof body.ticketBuyerPurchasesOverLimit === "number"
      ? body.ticketBuyerPurchasesOverLimit
      : 0;
  return {
    recipients: list,
    status: response.status,
    ticketBuyerPurchasesOverLimit,
    undeliverableTicketBuyerPurchases,
  };
}

function audienceFor(
  targetAudiences: CommunicationAudienceRequest["targetAudiences"],
  overrides: Partial<CommunicationAudienceRequest> = {},
): CommunicationAudienceRequest {
  return {
    contactEmailStatus: null,
    contactIds: [],
    contactListIds: [],
    contactSmsStatus: null,
    contactSource: null,
    eventId: null,
    globalStatuses: ["Active"],
    profileIds: [],
    rsvp: "All",
    targetAudiences,
    ticketBuyerMode: "marketing",
    voiceParts: [],
    ...overrides,
  };
}

describe("resolveCommunicationAudienceFromStore", () => {
  it("rejects malformed audiences and foreign Organization identities", async () => {
    const { storage } = seedDatabase();
    const malformed = new Request(
      "https://organization.internal/internal/communications/audience",
      {
        body: JSON.stringify({
          audience: { targetAudiences: ["Contacts"], contactIds: ["bad"] },
          organizationId: ORG_ID,
        }),
        method: "POST",
      },
    );
    expect((await resolveCommunicationAudienceFromStore(storage, malformed)).status).toBe(400);
    const foreign = await resolveAudience(storage, audienceFor(["Contacts"]), "org-other");
    expect(foreign.status).toBe(404);
  });

  it("returns member candidates with profile subjects", async () => {
    const { db, storage } = seedDatabase();
    seedProfile(db, { displayName: "Jane Member" });
    const { recipients, status } = await resolveAudience(storage, audienceFor(["Members"]));
    expect(status).toBe(200);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.subject).toEqual({
      kind: "profile",
      profileId: recipients[0]?.profileId,
    });
  });

  it("returns contact candidates for all eligible contacts by default", async () => {
    const { db, storage } = seedDatabase();
    seedContact(db, { displayName: "Jane Contact", email: "jane@example.com" });
    const { recipients } = await resolveAudience(storage, audienceFor(["Contacts"]));
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      email: "jane@example.com",
      subject: { kind: "contact", contactId: recipients[0]?.profileId },
    });
  });

  it("selects contacts by list and by ID as a union", async () => {
    const { db, storage } = seedDatabase();
    const newsletter = seedList(db, "Newsletter");
    const audience2026 = seedList(db, "2026 Audience");
    const inNewsletter = seedContact(db, { displayName: "In Newsletter", email: "a@example.com" });
    const inAudience = seedContact(db, { displayName: "In Audience", email: "b@example.com" });
    const inBoth = seedContact(db, { displayName: "In Both", email: "c@example.com" });
    const inNeither = seedContact(db, { displayName: "In Neither", email: "d@example.com" });
    addToList(db, inNewsletter, newsletter);
    addToList(db, inAudience, audience2026);
    addToList(db, inBoth, newsletter);
    addToList(db, inBoth, audience2026);
    addToList(db, inNeither, seedList(db, "Other"));

    const byLists = await resolveAudience(
      storage,
      audienceFor(["Contacts"], { contactListIds: [newsletter, audience2026] }),
    );
    // Contact in both lists appears once (single candidate row, no fan-out).
    expect(byLists.recipients.map((recipient) => recipient.email).sort()).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);

    const byId = await resolveAudience(
      storage,
      audienceFor(["Contacts"], { contactIds: [inNeither] }),
    );
    expect(byId.recipients.map((recipient) => recipient.email)).toEqual(["d@example.com"]);

    const union = await resolveAudience(
      storage,
      audienceFor(["Contacts"], { contactIds: [inNeither], contactListIds: [newsletter] }),
    );
    expect(union.recipients.map((recipient) => recipient.email).sort()).toEqual([
      "a@example.com",
      "c@example.com",
      "d@example.com",
    ]);
  });

  it("returns no contacts for an empty list or a foreign list ID", async () => {
    const { db, storage } = seedDatabase();
    const empty = seedList(db, "Empty");
    seedContact(db, { displayName: "Jane", email: "jane@example.com" });
    const emptyResult = await resolveAudience(
      storage,
      audienceFor(["Contacts"], { contactListIds: [empty] }),
    );
    expect(emptyResult.recipients).toEqual([]);
    // A list ID minted by another Organization matches nothing: storage is
    // Organization-scoped, so cross-tenant audience IDs cannot leak rows.
    const foreignResult = await resolveAudience(
      storage,
      audienceFor(["Contacts"], { contactListIds: ["99999999-9999-4999-8999-999999999999"] }),
    );
    expect(foreignResult.recipients).toEqual([]);
  });

  it("applies source and status filters to contacts", async () => {
    const { db, storage } = seedDatabase();
    seedContact(db, {
      displayName: "Imported",
      email: "a@example.com",
      emailStatus: "subscribed",
      source: "2026 import",
    });
    seedContact(db, {
      displayName: "Manual",
      email: "b@example.com",
      emailStatus: "subscribed",
      source: "manual",
    });
    seedContact(db, { displayName: "Unknown", email: "c@example.com", source: "2026 import" });
    const bySource = await resolveAudience(
      storage,
      audienceFor(["Contacts"], { contactSource: "2026 import" }),
    );
    expect(bySource.recipients.map((recipient) => recipient.email).sort()).toEqual([
      "a@example.com",
      "c@example.com",
    ]);
    const byStatus = await resolveAudience(
      storage,
      audienceFor(["Contacts"], { contactEmailStatus: "subscribed" }),
    );
    expect(byStatus.recipients.map((recipient) => recipient.email).sort()).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("flags unsubscribed contacts and suppressed members for precedence", async () => {
    const { db, storage } = seedDatabase();
    const memberId = seedProfile(db, { displayName: "Suppressed Member" });
    suppressProfile(db, memberId);
    seedContact(db, {
      displayName: "Unsubscribed",
      email: "unsub@example.com",
      emailStatus: "unsubscribed",
    });
    const members = await resolveAudience(storage, audienceFor(["Members"]));
    expect(members.recipients[0]).toMatchObject({ emailSuppressed: true });
    const contacts = await resolveAudience(storage, audienceFor(["Contacts"]));
    expect(contacts.recipients[0]).toMatchObject({ emailUnsubscribed: true });
  });

  it("propagates linked-profile suppression onto contact candidates", async () => {
    const { db, storage } = seedDatabase();
    const memberId = seedProfile(db, { displayName: "Jane Member" });
    suppressProfile(db, memberId);
    seedContact(db, {
      displayName: "Jane Contact",
      email: "jane@example.com",
      profileId: memberId,
    });
    const { recipients } = await resolveAudience(storage, audienceFor(["Contacts"]));
    expect(recipients[0]).toMatchObject({ emailSuppressed: true });
  });

  it("resolves ticket buyers and donors through contacts, never transaction IDs", async () => {
    const { db, storage } = seedDatabase();
    const buyerContact = seedContact(db, {
      displayName: "Ticket Buyer",
      email: "buyer@example.com",
    });
    const donorContact = seedContact(db, { displayName: "Donor", email: "donor@example.com" });
    const purchaseId = seedTicketPurchase(db, "Ticket Buyer", "buyer@example.com");
    const donationId = seedDonation(db, "Donor", "donor@example.com");
    linkTransactionContact(db, "ticket_purchases", purchaseId, buyerContact);
    linkTransactionContact(db, "donations", donationId, donorContact);
    const buyers = await resolveAudience(storage, audienceFor(["Ticket Buyers"]));
    expect(buyers.recipients).toHaveLength(1);
    expect(buyers.recipients[0]).toMatchObject({
      email: "buyer@example.com",
      profileId: buyerContact,
      subject: { kind: "contact", contactId: buyerContact },
      voicePart: "Ticket Buyer",
    });
    const donors = await resolveAudience(storage, audienceFor(["Donors"]));
    expect(donors.recipients).toHaveLength(1);
    expect(donors.recipients[0]).toMatchObject({
      email: "donor@example.com",
      profileId: donorContact,
      subject: { kind: "contact", contactId: donorContact },
      voicePart: "Donor",
    });
  });

  it("keeps Ticket Buyer marketing audiences consent-aware with or without an event", async () => {
    const { db, storage } = seedDatabase();
    const selectedEventId = uuidFor("marketing-selected-event");
    const otherEventId = uuidFor("marketing-other-event");
    const subscribedContact = seedContact(db, {
      displayName: "Opted-in buyer",
      email: "opted-in@example.com",
      emailStatus: "unsubscribed",
      emailSource: "user_unsubscribe",
    });
    const optedOutContact = seedContact(db, {
      displayName: "Opted-out buyer",
      email: "opted-out@example.com",
    });
    const otherEventContact = seedContact(db, {
      displayName: "Other-event buyer",
      email: "other-event@example.com",
    });
    const selectedPurchase = seedTicketPurchase(db, "Opted-in buyer", "opted-in@example.com", {
      eventId: selectedEventId,
    });
    const optedOutPurchase = seedTicketPurchase(db, "Opted-out buyer", "opted-out@example.com", {
      eventId: selectedEventId,
      marketingOptIn: false,
    });
    const otherEventPurchase = seedTicketPurchase(
      db,
      "Other-event buyer",
      "other-event@example.com",
      { eventId: otherEventId },
    );
    linkTransactionContact(db, "ticket_purchases", selectedPurchase, subscribedContact);
    linkTransactionContact(db, "ticket_purchases", optedOutPurchase, optedOutContact);
    linkTransactionContact(db, "ticket_purchases", otherEventPurchase, otherEventContact);

    const eventMarketing = await resolveAudience(
      storage,
      audienceFor(["Ticket Buyers"], { eventId: selectedEventId }),
    );
    expect(eventMarketing.recipients.map(({ email }) => email)).toEqual(["opted-in@example.com"]);
    expect(eventMarketing.recipients[0]).toMatchObject({ emailUnsubscribed: true });

    const generalMarketing = await resolveAudience(storage, audienceFor(["Ticket Buyers"]));
    expect(generalMarketing.recipients.map(({ email }) => email).sort()).toEqual([
      "opted-in@example.com",
      "other-event@example.com",
    ]);
  });

  it("includes paid direct and bundle tickets for a canceled service performance only", async () => {
    const { db, storage } = seedDatabase();
    const canceledEventId = seedCanceledEvent(db);
    const directContact = seedContact(db, {
      displayName: "Unsubscribed direct buyer",
      email: "direct@example.com",
      emailStatus: "unsubscribed",
      emailSource: "user_unsubscribe",
    });
    const bundleContact = seedContact(db, {
      displayName: "Bundle buyer",
      email: "bundle@example.com",
    });
    const unrelatedContact = seedContact(db, {
      displayName: "Unrelated bundle buyer",
      email: "unrelated@example.com",
    });
    const directPurchase = seedTicketPurchase(
      db,
      "Unsubscribed direct buyer",
      "direct@example.com",
      {
        eventId: canceledEventId,
        marketingOptIn: false,
      },
    );
    const duplicateDirectPurchase = seedTicketPurchase(
      db,
      "Unsubscribed direct buyer",
      "direct@example.com",
      { eventId: canceledEventId, marketingOptIn: false },
    );
    const bundlePurchase = seedTicketPurchase(db, "Bundle buyer", "bundle@example.com", {
      eventId: uuidFor("bundle-parent-event"),
      marketingOptIn: false,
    });
    const unrelatedBundlePurchase = seedTicketPurchase(
      db,
      "Unrelated bundle buyer",
      "unrelated@example.com",
      {
        eventId: uuidFor("unrelated-parent-event"),
        marketingOptIn: false,
      },
    );
    linkTransactionContact(db, "ticket_purchases", directPurchase, directContact);
    linkTransactionContact(db, "ticket_purchases", duplicateDirectPurchase, directContact);
    linkTransactionContact(db, "ticket_purchases", bundlePurchase, bundleContact);
    linkTransactionContact(db, "ticket_purchases", unrelatedBundlePurchase, unrelatedContact);
    addBundleAllocation(db, bundlePurchase, canceledEventId);
    addBundleAllocation(db, unrelatedBundlePurchase, uuidFor("different-bundle-event"));

    const nonPaidRows = ["pending", "expired", "refunded"] as const;
    for (const status of nonPaidRows) {
      const email = `${status}@example.com`;
      const contactId = seedContact(db, { displayName: status, email });
      const purchaseId = seedTicketPurchase(db, status, email, {
        eventId: canceledEventId,
        marketingOptIn: false,
        status,
      });
      linkTransactionContact(db, "ticket_purchases", purchaseId, contactId);
    }

    const result = await resolveAudience(
      storage,
      audienceFor(["Ticket Buyers"], {
        eventId: canceledEventId,
        ticketBuyerMode: "ticket_service",
      }),
    );
    expect(result.recipients.map(({ email }) => email)).toEqual([
      "bundle@example.com",
      "direct@example.com",
      "direct@example.com",
    ]);
    expect(result.recipients.filter(({ email }) => email === "direct@example.com")).toEqual([
      expect.objectContaining({ emailUnsubscribed: false }),
      expect.objectContaining({ emailUnsubscribed: false }),
    ]);
    const dedupeCandidates: CommunicationRecipientCandidate[] = result.recipients.map(
      (recipient) => ({
        displayName: recipient.displayName,
        doNotEmail: recipient.doNotEmail,
        email: recipient.email,
        emailSuppressed: recipient.emailSuppressed,
        emailUnsubscribed: recipient.emailUnsubscribed,
        phone: recipient.phone,
        providerBounced: recipient.providerBounced,
        smsSuppressed: recipient.smsSuppressed,
        smsUnsubscribed: recipient.smsUnsubscribed,
        subjectId: recipient.profileId,
        subjectKind: "contact",
      }),
    );
    expect(
      dedupeCommunicationCandidates(dedupeCandidates)
        .map(({ email }) => email)
        .sort(),
    ).toEqual(["bundle@example.com", "direct@example.com"]);
  });

  it("keeps ticket-service marketing opt-outs bypassed while preserving technical and global suppressions", async () => {
    const { db, storage } = seedDatabase();
    const eventId = uuidFor("suppression-event");
    const marketingUnsubscribed = seedContact(db, {
      displayName: "Marketing unsubscribe",
      email: "marketing-unsubscribe@example.com",
      emailStatus: "unsubscribed",
      emailSource: "user_unsubscribe",
    });
    const providerBounced = seedContact(db, {
      displayName: "Provider bounce",
      email: "provider-bounce@example.com",
      emailStatus: "unsubscribed",
      emailSource: "provider_bounce",
    });
    const doNotEmailProfile = seedProfile(db, { displayName: "Do not email" });
    db.prepare("UPDATE profiles SET do_not_email = 1 WHERE id = ?").run(doNotEmailProfile);
    const doNotEmail = seedContact(db, {
      displayName: "Do not email",
      email: "do-not-email@example.com",
      profileId: doNotEmailProfile,
    });
    const technicalProfile = seedProfile(db, { displayName: "Technical suppression" });
    suppressProfile(db, technicalProfile);
    const technical = seedContact(db, {
      displayName: "Technical suppression",
      email: "technical-suppression@example.com",
      profileId: technicalProfile,
    });
    const profileBounce = seedProfile(db, { displayName: "Profile bounce" });
    db.prepare(
      "UPDATE profiles SET provider_email_suppressed = 1, last_bounce_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), profileBounce);
    const profileBounced = seedContact(db, {
      displayName: "Profile bounce",
      email: "profile-bounce@example.com",
      profileId: profileBounce,
    });

    for (const [contactId, name, email] of [
      [marketingUnsubscribed, "Marketing unsubscribe", "marketing-unsubscribe@example.com"],
      [providerBounced, "Provider bounce", "provider-bounce@example.com"],
      [doNotEmail, "Do not email", "do-not-email@example.com"],
      [technical, "Technical suppression", "technical-suppression@example.com"],
      [profileBounced, "Profile bounce", "profile-bounce@example.com"],
    ] as const) {
      const purchaseId = seedTicketPurchase(db, name, email, {
        eventId,
        marketingOptIn: false,
      });
      linkTransactionContact(db, "ticket_purchases", purchaseId, contactId);
    }

    const result = await resolveAudience(
      storage,
      audienceFor(["Ticket Buyers"], { eventId, ticketBuyerMode: "ticket_service" }),
    );
    const byContactId = new Map(
      result.recipients.map((recipient) => [recipient.profileId, recipient]),
    );
    expect(byContactId.get(marketingUnsubscribed)).toMatchObject({
      emailUnsubscribed: false,
      providerBounced: false,
    });
    expect(byContactId.get(providerBounced)).toMatchObject({
      emailUnsubscribed: false,
      providerBounced: true,
    });
    expect(byContactId.get(doNotEmail)?.doNotEmail).toBe(true);
    expect(byContactId.get(technical)?.emailSuppressed).toBe(true);
    expect(byContactId.get(profileBounced)?.providerBounced).toBe(true);
  });

  it("counts paid service orders that have no resolvable Contact or valid email", async () => {
    const { db, storage } = seedDatabase();
    const eventId = uuidFor("unresolved-service-event");
    seedTicketPurchase(db, "Unlinked buyer", "unlinked@example.com", {
      eventId,
      marketingOptIn: false,
    });
    const invalidContact = seedContact(db, {
      displayName: "Invalid email buyer",
      email: "not-an-email",
    });
    const invalidPurchase = seedTicketPurchase(db, "Invalid email buyer", "not-an-email", {
      eventId,
      marketingOptIn: false,
    });
    linkTransactionContact(db, "ticket_purchases", invalidPurchase, invalidContact);

    const result = await resolveAudience(
      storage,
      audienceFor(["Ticket Buyers"], { eventId, ticketBuyerMode: "ticket_service" }),
    );
    expect(result.recipients).toEqual([]);
    expect(result.undeliverableTicketBuyerPurchases).toBe(2);
  });

  it("never interprets a purchase or donation ID as a profile ID", async () => {
    const { db, storage } = seedDatabase();
    const buyerContact = seedContact(db, {
      displayName: "Ticket Buyer",
      email: "buyer@example.com",
    });
    const donorContact = seedContact(db, { displayName: "Donor", email: "donor@example.com" });
    const purchaseId = seedTicketPurchase(db, "Ticket Buyer", "buyer@example.com");
    const donationId = seedDonation(db, "Donor", "donor@example.com");
    linkTransactionContact(db, "ticket_purchases", purchaseId, buyerContact);
    linkTransactionContact(db, "donations", donationId, donorContact);
    const { recipients } = await resolveAudience(storage, audienceFor(["Ticket Buyers", "Donors"]));
    expect(recipients).toHaveLength(2);
    for (const recipient of recipients) {
      expect(recipient.profileId).not.toBe(purchaseId);
      expect(recipient.profileId).not.toBe(donationId);
      expect(recipient.subject?.kind).toBe("contact");
      expect(recipient.subject?.kind).not.toBe("ticket_purchase");
      expect(recipient.subject?.kind).not.toBe("donation");
    }
  });

  it("falls back to normalized-email contacts for pre-link transactions", async () => {
    const { db, storage } = seedDatabase();
    const contactId = seedContact(db, { displayName: "Legacy Buyer", email: "legacy@example.com" });
    // No contact_id written: mirrors a row that predates the Section 8 link.
    seedTicketPurchase(db, "Legacy Buyer", "  LEGACY@example.com  ");
    const { recipients } = await resolveAudience(storage, audienceFor(["Ticket Buyers"]));
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      profileId: contactId,
      subject: { kind: "contact", contactId },
    });
  });

  it("skips commerce rows with no resolvable contact instead of minting pseudo-profiles", async () => {
    const { db, storage } = seedDatabase();
    seedTicketPurchase(db, "Ghost Buyer", "ghost-buyer@example.com");
    seedDonation(db, "Ghost Donor", "ghost-donor@example.com");
    const buyers = await resolveAudience(storage, audienceFor(["Ticket Buyers"]));
    const donors = await resolveAudience(storage, audienceFor(["Donors"]));
    expect(buyers.recipients).toEqual([]);
    expect(donors.recipients).toEqual([]);
  });

  it("propagates contact unsubscribe and linked-profile suppression onto commerce candidates", async () => {
    const { db, storage } = seedDatabase();
    const unsubContact = seedContact(db, {
      displayName: "Unsub Buyer",
      email: "unsub-buyer@example.com",
      emailStatus: "unsubscribed",
    });
    const memberId = seedProfile(db, { displayName: "Suppressed Donor" });
    suppressProfile(db, memberId);
    const linkedContact = seedContact(db, {
      displayName: "Linked Donor",
      email: "linked-donor@example.com",
      profileId: memberId,
    });
    const purchaseId = seedTicketPurchase(db, "Unsub Buyer", "unsub-buyer@example.com");
    const donationId = seedDonation(db, "Linked Donor", "linked-donor@example.com");
    linkTransactionContact(db, "ticket_purchases", purchaseId, unsubContact);
    linkTransactionContact(db, "donations", donationId, linkedContact);
    const buyers = await resolveAudience(storage, audienceFor(["Ticket Buyers"]));
    expect(buyers.recipients[0]).toMatchObject({ emailUnsubscribed: true });
    const donors = await resolveAudience(storage, audienceFor(["Donors"]));
    expect(donors.recipients[0]).toMatchObject({ emailSuppressed: true });
  });

  it("keeps historical commerce subjects readable while minting contacts", async () => {
    // Pre-Phase-9 deliveries stored ticket_purchase/donation subjects; the
    // contract still parses them so history stays displayable.
    expect(
      communicationRecipientSubjectSchema.safeParse({
        kind: "ticket_purchase",
        purchaseId: uuidFor("historic"),
      }).success,
    ).toBe(true);
    expect(
      communicationRecipientSubjectSchema.safeParse({
        kind: "donation",
        donationId: uuidFor("historic"),
      }).success,
    ).toBe(true);
    const { db, storage } = seedDatabase();
    const contactId = seedContact(db, {
      displayName: "Current Buyer",
      email: "current@example.com",
    });
    const purchaseId = seedTicketPurchase(db, "Current Buyer", "current@example.com");
    linkTransactionContact(db, "ticket_purchases", purchaseId, contactId);
    const { recipients } = await resolveAudience(storage, audienceFor(["Ticket Buyers"]));
    expect(recipients[0]?.subject).toEqual({ kind: "contact", contactId });
  });

  it("builds every selected audience independently for caller-side dedupe", async () => {
    const { db, storage } = seedDatabase();
    seedProfile(db, { displayName: "Jane Member" });
    const sharedContact = seedContact(db, {
      displayName: "Jane Contact",
      email: "shared@example.com",
    });
    const purchaseId = seedTicketPurchase(db, "Jane Buyer", "shared@example.com");
    const donationId = seedDonation(db, "Jane Donor", "shared@example.com");
    linkTransactionContact(db, "ticket_purchases", purchaseId, sharedContact);
    linkTransactionContact(db, "donations", donationId, sharedContact);
    const { recipients } = await resolveAudience(
      storage,
      audienceFor(["Members", "Contacts", "Ticket Buyers", "Donors"]),
    );
    // One candidate per audience (member email resolves later from D1); the
    // caller merge collapses the shared destination to a single delivery.
    // Commerce audiences now resolve to the same Contact identity.
    expect(recipients).toHaveLength(4);
    expect(recipients.map((recipient) => recipient.subject?.kind).sort()).toEqual([
      "contact",
      "contact",
      "contact",
      "profile",
    ]);
  });

  it("bounds each contact audience to 500 recipients", async () => {
    const { db, storage } = seedDatabase();
    for (let index = 0; index < 505; index += 1) {
      seedContact(db, {
        displayName: `Contact ${String(index)}`,
        email: `bulk${String(index)}@example.com`,
      });
    }
    const { recipients } = await resolveAudience(storage, audienceFor(["Contacts"]));
    expect(recipients).toHaveLength(500);
  });

  it("reports paid ticket orders beyond the bounded service-notice audience", async () => {
    const { db, storage } = seedDatabase();
    const eventId = uuidFor("service-limit-event");
    for (let index = 0; index < 1_001; index += 1) {
      seedTicketPurchase(
        db,
        `Unlinked buyer ${String(index)}`,
        `buyer${String(index)}@example.com`,
        {
          eventId,
          marketingOptIn: false,
        },
      );
    }
    const result = await resolveAudience(
      storage,
      audienceFor(["Ticket Buyers"], { eventId, ticketBuyerMode: "ticket_service" }),
    );
    expect(result.recipients).toEqual([]);
    expect(result.ticketBuyerPurchasesOverLimit).toBe(1);
    expect(result.undeliverableTicketBuyerPurchases).toBe(1_000);
  });

  it("carries the v80 recipient subject column through fresh migrations", () => {
    const { db } = seedDatabase();
    const raw: unknown = db.prepare(`PRAGMA table_info(communication_deliveries)`).all();
    if (!Array.isArray(raw)) throw new Error("Expected table columns.");
    const names: string[] = [];
    for (const row of raw) {
      if (typeof row === "object" && row !== null && "name" in row) {
        const name: unknown = row.name;
        if (typeof name === "string") names.push(name);
      }
    }
    expect(names).toContain("recipient_subject_json");
  });
});

describe("communication send boundaries", () => {
  function sendOperation(
    recipientCount: number,
    channel: "Email" | "Both" = "Email",
    ticketService = false,
  ) {
    return {
      action: "send",
      actorUserId: "user-tester-001",
      jobId: uuidFor("job"),
      message: {
        audience: ticketService
          ? audienceFor(["Ticket Buyers"], {
              eventId: uuidFor("service-send-event"),
              ticketBuyerMode: "ticket_service",
            })
          : audienceFor(["Members", "Contacts"]),
        channel,
        contentMarkdown: "Boundary probe",
        subject: "Boundary probe",
      },
      messageId: uuidFor("message"),
      organizationId: ORG_ID,
      recipients: Array.from({ length: recipientCount }, (_, index) => ({
        email: `boundary${String(index)}@example.com`,
        name: `Boundary ${String(index)}`,
        phone: channel === "Both" ? "+15551234567" : "",
        profileId: uuidFor(`recipient-${String(index)}`),
        unsubscribeUrl: null,
      })),
      requestId: uuidFor("request"),
    };
  }

  it("rejects more than 500 recipients overall", () => {
    expect(sendOperationSchema.safeParse(sendOperation(500)).success).toBe(true);
    expect(sendOperationSchema.safeParse(sendOperation(501)).success).toBe(false);
  });

  it("allows up to 1,000 email-only ticket-service recipients and rejects overflow", () => {
    expect(sendOperationSchema.safeParse(sendOperation(1_000, "Email", true)).success).toBe(true);
    expect(sendOperationSchema.safeParse(sendOperation(1_001, "Email", true)).success).toBe(false);
    expect(
      sendOperationSchema.safeParse({
        ...sendOperation(1, "Email", true),
        ticketBuyerPurchasesOverLimit: 1,
      }).success,
    ).toBe(false);
  });

  it("holds 500 dual-channel recipients within the 1,000-delivery maximum", () => {
    // 500 recipients × (email + sms) = exactly 1,000 deliveries: accepted.
    expect(sendOperationSchema.safeParse(sendOperation(500, "Both")).success).toBe(true);
  });
});
