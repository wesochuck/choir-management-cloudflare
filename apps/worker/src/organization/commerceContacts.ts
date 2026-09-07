import { normalizeEmail, normalizePhone } from "@choir/domain";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import { z } from "zod";

import type { ContactStoreStorage } from "./contactStore";

/**
 * Phase 8 commerce → Contact identity linkage.
 *
 * Ticket purchases and donations keep their buyer name/email snapshot columns
 * as immutable transaction history. This module adds the additive identity
 * layer on top: a nullable `contact_id` that points at the Organization's
 * Contact for the buyer/donor.
 *
 * Tenancy: every row read or written here lives in this Durable Object, which
 * owns exactly one Organization, so resolution can never cross Organizations.
 * There are no provider calls here; all work is bounded SQL plus UUID
 * generation, making every function safe to call from request handlers and
 * safe to retry.
 *
 * Matching priority (never merge on name alone):
 * 1. existing `contact_id` when it still references a Contact;
 * 2. normalized email through the indexed `contacts.normalized_email` lookup;
 * 3. normalized phone through the indexed `contacts.normalized_phone` lookup,
 *    but only when the transaction has no usable email, so a shared family
 *    number can never override an email identity;
 * 4. create a Contact.
 *
 * Update policy: a match links the transaction and preserves its raw
 * snapshot. Curated Contact fields (name, phone) and communication
 * preferences are never overwritten from transaction data, so a hurried
 * buyer's typo cannot clobber a curated marketing contact.
 *
 * Creation policy: a Contact is created only when the transaction carries a
 * valid normalized email or a valid E.164 phone. Missing/invalid contact
 * methods yield `null` (no bogus name-only Contact) and leave `contact_id`
 * NULL for a later backfill pass to reconsider.
 */

export const COMMERCE_CONTACT_BACKFILL_BATCH_SIZE = 100;
const COMMERCE_CONTACT_BACKFILL_BATCH_MAX = 500;
const COMMERCE_CONTACT_BACKFILL_RUN_MAX = 100;

const commerceEmailSchema = z.email().max(320);

export type CommerceContactSource = "donation" | "ticket_purchase";

export interface CommerceContactInput {
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly existingContactId?: string | null | undefined;
  readonly marketingOptIn: boolean;
  readonly occurredAt: string;
  readonly phone?: string | null | undefined;
  readonly source: CommerceContactSource;
}

export interface CommerceContactBackfillResult {
  readonly completed: boolean;
  readonly contactsCreated: number;
  readonly contactsLinked: number;
  readonly processedRows: number;
  readonly skippedRows: number;
}

interface ContactIdRow {
  readonly [column: string]: SqlStorageValue;
  readonly id: string;
}

function normalizeCommerceEmail(value: string | null | undefined): string | null {
  const normalized = normalizeEmail(value);
  if (normalized === null) return null;
  const trimmed = normalized.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 320) return null;
  return commerceEmailSchema.safeParse(trimmed).success ? trimmed : null;
}

function contactExists(storage: ContactStoreStorage, contactId: string): boolean {
  return (
    storage.sql.exec("SELECT 1 FROM contacts WHERE id = ? LIMIT 1", contactId).toArray().length > 0
  );
}

function findContactIdByNormalizedEmail(
  storage: ContactStoreStorage,
  normalizedEmail: string,
): string | undefined {
  return storage.sql
    .exec<ContactIdRow>(
      "SELECT id FROM contacts WHERE normalized_email = ? LIMIT 1",
      normalizedEmail,
    )
    .toArray()
    .at(0)?.id;
}

function findContactIdByNormalizedPhone(
  storage: ContactStoreStorage,
  normalizedPhone: string,
): string | undefined {
  return storage.sql
    .exec<ContactIdRow>(
      "SELECT id FROM contacts WHERE normalized_phone = ? LIMIT 1",
      normalizedPhone,
    )
    .toArray()
    .at(0)?.id;
}

function countContacts(storage: ContactStoreStorage): number {
  return (
    storage.sql
      .exec<{ readonly count: number }>("SELECT COUNT(*) AS count FROM contacts")
      .toArray()
      .at(0)?.count ?? 0
  );
}

function emptyToNull(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function createCommerceContact(
  storage: ContactStoreStorage,
  args: {
    readonly buyerEmail: string;
    readonly buyerName: string;
    readonly marketingOptIn: boolean;
    readonly normalizedEmail: string | null;
    readonly normalizedPhone: string | null;
    readonly occurredAt: string;
    readonly phone: string | null | undefined;
    readonly source: CommerceContactSource;
  },
): string {
  const contactId = crypto.randomUUID();
  // Transaction snapshots may predate contract length limits; truncate so the
  // Contact insert stays valid without touching the snapshot itself.
  const displayName = emptyToNull(args.buyerName, 200);
  const email = args.normalizedEmail === null ? null : emptyToNull(args.buyerEmail, 320);
  const phone = args.normalizedPhone === null ? null : emptyToNull(args.phone, 50);
  const source = emptyToNull(args.source, 200);
  const emailStatus =
    args.marketingOptIn && args.normalizedEmail !== null ? "subscribed" : "unknown";

  // Run creation in one transaction and return the winner: the re-check and
  // the unique-violation fallback let concurrent checkouts for the same
  // email converge on one Contact instead of duplicating.
  return storage.transactionSync((): string => {
    if (args.normalizedEmail !== null) {
      const raced = findContactIdByNormalizedEmail(storage, args.normalizedEmail);
      if (raced !== undefined) return raced;
    }
    try {
      storage.sql.exec(
        `INSERT INTO contacts
          (id, first_name, last_name, display_name, email, normalized_email,
           phone, normalized_phone, profile_id, source, created_at, updated_at)
         VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        contactId,
        displayName,
        email,
        args.normalizedEmail,
        phone,
        args.normalizedPhone,
        source,
        args.occurredAt,
        args.occurredAt,
      );
    } catch (error: unknown) {
      if (
        args.normalizedEmail !== null &&
        error instanceof Error &&
        /UNIQUE constraint failed|unique/i.test(error.message)
      ) {
        const raced = findContactIdByNormalizedEmail(storage, args.normalizedEmail);
        if (raced !== undefined) return raced;
      }
      throw error;
    }
    for (const [channel, status] of [
      ["email", emailStatus],
      ["sms", "unknown"],
    ] as const) {
      storage.sql.exec(
        `INSERT INTO contact_communication_preferences
           (contact_id, channel, status, source, observed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        contactId,
        channel,
        status,
        source,
        args.occurredAt,
        args.occurredAt,
      );
    }
    // Audit carries presence flags only, never the email/phone values.
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'system', 'commerce-contact-link', 'contact.created_from_commerce',
        'contact', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      contactId,
      crypto.randomUUID(),
      JSON.stringify({
        hasEmail: args.normalizedEmail !== null,
        hasPhone: args.normalizedPhone !== null,
        marketingOptIn: args.marketingOptIn,
        source,
      }),
      args.occurredAt,
    );
    return contactId;
  });
}

/**
 * Shared resolver for ticket purchases and donations. Returns the Contact ID
 * to store on the transaction, or `null` when the transaction carries no
 * usable contact method. An optional cache maps normalized destinations to
 * Contact IDs so one backfill run links a shared email once.
 */
export function resolveOrCreateContactForCommerce(
  storage: ContactStoreStorage,
  input: CommerceContactInput,
  cache?: Map<string, string>,
): string | null {
  const preserved = matchExistingContact(storage, input.existingContactId);
  if (preserved !== null) return preserved;
  const normalizedEmail = normalizeCommerceEmail(input.buyerEmail);
  if (normalizedEmail !== null) {
    const matched = matchCommerceContactByEmail(storage, normalizedEmail, cache);
    if (matched !== undefined) return matched;
  }
  // Phone matching applies only when email matching is unavailable, so a
  // shared number never merges identities that email already distinguishes.
  const normalizedPhone = normalizedEmail === null ? normalizePhone(input.phone ?? null) : null;
  if (normalizedPhone !== null) {
    const matched = matchCommerceContactByPhone(storage, normalizedPhone, cache);
    if (matched !== undefined) return matched;
  }
  if (normalizedEmail === null && normalizedPhone === null) return null;
  const created = createCommerceContact(storage, {
    buyerEmail: input.buyerEmail,
    buyerName: input.buyerName,
    marketingOptIn: input.marketingOptIn,
    normalizedEmail,
    normalizedPhone,
    occurredAt: input.occurredAt,
    phone: input.phone,
    source: input.source,
  });
  if (normalizedEmail !== null) cache?.set(`email:${normalizedEmail}`, created);
  if (normalizedPhone !== null) cache?.set(`phone:${normalizedPhone}`, created);
  return created;
}

function matchExistingContact(
  storage: ContactStoreStorage,
  existingContactId: string | null | undefined,
): string | null {
  const existing = existingContactId?.trim() ? existingContactId.trim() : null;
  if (existing === null) return null;
  // A dangling link (Contact deleted before SET NULL coverage) falls through
  // to identity resolution instead of blocking the transaction.
  return contactExists(storage, existing) ? existing : null;
}

function matchCommerceContactByEmail(
  storage: ContactStoreStorage,
  normalizedEmail: string,
  cache: Map<string, string> | undefined,
): string | undefined {
  const cached = cache?.get(`email:${normalizedEmail}`);
  if (cached !== undefined) return cached;
  const matched = findContactIdByNormalizedEmail(storage, normalizedEmail);
  if (matched !== undefined) cache?.set(`email:${normalizedEmail}`, matched);
  return matched;
}

function matchCommerceContactByPhone(
  storage: ContactStoreStorage,
  normalizedPhone: string,
  cache: Map<string, string> | undefined,
): string | undefined {
  const cached = cache?.get(`phone:${normalizedPhone}`);
  if (cached !== undefined) return cached;
  const matched = findContactIdByNormalizedPhone(storage, normalizedPhone);
  if (matched !== undefined) cache?.set(`phone:${normalizedPhone}`, matched);
  return matched;
}

interface CommerceLinkRow {
  readonly [column: string]: SqlStorageValue;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly contactId: string | null;
  readonly id: string;
  readonly marketingOptIn: number;
  readonly status: string;
}

function readTicketLinkRow(
  storage: ContactStoreStorage,
  purchaseId: string,
): CommerceLinkRow | undefined {
  return storage.sql
    .exec<CommerceLinkRow>(
      `SELECT id, buyer_name AS buyerName, buyer_email AS buyerEmail,
        contact_id AS contactId, status, marketing_opt_in AS marketingOptIn
       FROM ticket_purchases WHERE id = ? LIMIT 1`,
      purchaseId,
    )
    .toArray()
    .at(0);
}

function readDonationLinkRow(
  storage: ContactStoreStorage,
  donationId: string,
): CommerceLinkRow | undefined {
  return storage.sql
    .exec<CommerceLinkRow>(
      `SELECT id, buyer_name AS buyerName, buyer_email AS buyerEmail,
        contact_id AS contactId, status, marketing_consent AS marketingOptIn
       FROM donations WHERE id = ? LIMIT 1`,
      donationId,
    )
    .toArray()
    .at(0);
}

/**
 * Links one paid ticket purchase to its Contact. Unpaid purchases never
 * create Contacts; a preserved link is returned untouched.
 */
export function linkPaidTicketPurchaseContact(
  storage: ContactStoreStorage,
  purchaseId: string,
): string | null {
  const row = readTicketLinkRow(storage, purchaseId);
  if (!row) return null;
  if (row.contactId !== null && contactExists(storage, row.contactId)) return row.contactId;
  if (row.status !== "paid") return null;
  const contactId = resolveOrCreateContactForCommerce(storage, {
    buyerEmail: row.buyerEmail,
    buyerName: row.buyerName,
    existingContactId: null,
    marketingOptIn: row.marketingOptIn === 1,
    occurredAt: new Date().toISOString(),
    source: "ticket_purchase",
  });
  if (contactId !== null) {
    storage.sql.exec(
      "UPDATE ticket_purchases SET contact_id = ? WHERE id = ? AND contact_id IS NULL",
      contactId,
      row.id,
    );
  }
  return contactId;
}

/**
 * Links one paid donation to its Contact. Unpaid donations never create
 * Contacts; a preserved link is returned untouched.
 */
export function linkPaidDonationContact(
  storage: ContactStoreStorage,
  donationId: string,
): string | null {
  const row = readDonationLinkRow(storage, donationId);
  if (!row) return null;
  if (row.contactId !== null && contactExists(storage, row.contactId)) return row.contactId;
  if (row.status !== "paid") return null;
  const contactId = resolveOrCreateContactForCommerce(storage, {
    buyerEmail: row.buyerEmail,
    buyerName: row.buyerName,
    existingContactId: null,
    marketingOptIn: row.marketingOptIn === 1,
    occurredAt: new Date().toISOString(),
    source: "donation",
  });
  if (contactId !== null) {
    storage.sql.exec(
      "UPDATE donations SET contact_id = ? WHERE id = ? AND contact_id IS NULL",
      contactId,
      row.id,
    );
  }
  return contactId;
}

interface BackfillCandidate {
  readonly [column: string]: SqlStorageValue;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly createdAt: string;
  readonly id: string;
  readonly marketingOptIn: number;
}

function readUnlinkedPaidTickets(
  storage: ContactStoreStorage,
  limit: number,
  cursor: { readonly createdAt: string; readonly id: string } | null,
): BackfillCandidate[] {
  const params: unknown[] = cursor ? [cursor.createdAt, cursor.id, limit] : [limit];
  return storage.sql
    .exec<BackfillCandidate>(
      `SELECT id, buyer_name AS buyerName, buyer_email AS buyerEmail,
        marketing_opt_in AS marketingOptIn, created_at AS createdAt
       FROM ticket_purchases
       WHERE contact_id IS NULL AND status = 'paid' AND TRIM(buyer_email) <> ''
        ${cursor ? "AND (created_at, id) > (?, ?)" : ""}
       ORDER BY created_at ASC, id ASC LIMIT ?`,
      ...params,
    )
    .toArray();
}

function readUnlinkedPaidDonations(
  storage: ContactStoreStorage,
  limit: number,
  cursor: { readonly createdAt: string; readonly id: string } | null,
): BackfillCandidate[] {
  const params: unknown[] = cursor ? [cursor.createdAt, cursor.id, limit] : [limit];
  return storage.sql
    .exec<BackfillCandidate>(
      `SELECT id, buyer_name AS buyerName, buyer_email AS buyerEmail,
        marketing_consent AS marketingOptIn, created_at AS createdAt
       FROM donations
       WHERE contact_id IS NULL AND status = 'paid' AND TRIM(buyer_email) <> ''
        ${cursor ? "AND (created_at, id) > (?, ?)" : ""}
       ORDER BY created_at ASC, id ASC LIMIT ?`,
      ...params,
    )
    .toArray();
}

function clampBackfillOption(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, 1), max);
}

/**
 * Bounded, restartable backfill linking historical paid transactions to
 * Contacts. Keyset pagination visits each candidate exactly once per run, so
 * malformed emails are counted as skipped without blocking completion, and a
 * rerun converges: already-linked rows are excluded by the NULL filter and
 * resolve to the same Contact IDs without creating duplicates.
 */
export function backfillCommerceContactLinks(
  storage: ContactStoreStorage,
  options?: { readonly batchSize?: number | undefined; readonly maxBatches?: number | undefined },
): CommerceContactBackfillResult {
  const batchSize = clampBackfillOption(
    options?.batchSize,
    COMMERCE_CONTACT_BACKFILL_BATCH_SIZE,
    COMMERCE_CONTACT_BACKFILL_BATCH_MAX,
  );
  const maxBatches = clampBackfillOption(
    options?.maxBatches,
    COMMERCE_CONTACT_BACKFILL_RUN_MAX,
    100,
  );
  const contactsBefore = countContacts(storage);
  const cache = new Map<string, string>();
  let completed = false;
  let contactsLinked = 0;
  let processedRows = 0;
  let skippedRows = 0;
  let ticketCursor: { readonly createdAt: string; readonly id: string } | null = null;
  let donationCursor: { readonly createdAt: string; readonly id: string } | null = null;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const tickets = readUnlinkedPaidTickets(storage, batchSize, ticketCursor);
    const donations = readUnlinkedPaidDonations(storage, batchSize, donationCursor);
    if (tickets.length === 0 && donations.length === 0) {
      completed = true;
      break;
    }
    const ticketWork = tickets.map((row) => ({
      ...row,
      source: "ticket_purchase" as const,
      table: "ticket_purchases" as const,
    }));
    const donationWork = donations.map((row) => ({
      ...row,
      source: "donation" as const,
      table: "donations" as const,
    }));
    for (const row of [...ticketWork, ...donationWork]) {
      processedRows += 1;
      const contactId = resolveOrCreateContactForCommerce(
        storage,
        {
          buyerEmail: row.buyerEmail,
          buyerName: row.buyerName,
          existingContactId: null,
          marketingOptIn: row.marketingOptIn === 1,
          occurredAt: new Date().toISOString(),
          source: row.source,
        },
        cache,
      );
      if (contactId === null) {
        skippedRows += 1;
      } else {
        storage.sql.exec(
          `UPDATE ${row.table} SET contact_id = ? WHERE id = ? AND contact_id IS NULL`,
          contactId,
          row.id,
        );
        contactsLinked += 1;
      }
    }
    const lastTicket = tickets.at(-1);
    const lastDonation = donations.at(-1);
    if (lastTicket) ticketCursor = { createdAt: lastTicket.createdAt, id: lastTicket.id };
    if (lastDonation) donationCursor = { createdAt: lastDonation.createdAt, id: lastDonation.id };
  }

  return {
    completed,
    contactsCreated: Math.max(0, countContacts(storage) - contactsBefore),
    contactsLinked,
    processedRows,
    skippedRows,
  };
}
