import {
  CONTACT_RESPONSE_MAX,
  type Contact,
  type ContactCommunicationPreference,
  type ContactListMembership,
} from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import { z } from "zod";

import {
  ContactStoreError,
  type ContactDetailActivity,
  type ContactDetailLinkedProfile,
  type ContactDetailList,
  type ContactStoreStorage,
  type ListContactsInput,
} from "./contracts";
import {
  assertOrganization,
  CONTACT_COLUMNS,
  contactStatusSchema,
  parseContactRow,
  parsePreferenceRow,
  placeholders,
  readContactRow,
  readListIds,
  readPreferences,
  requireUuid,
  type ContactRow,
  type MembershipRow,
  type PreferenceRow,
} from "./shared";

function readContactLists(storage: ContactStoreStorage, contactId: string): ContactDetailList[] {
  return storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly id: string;
      readonly name: string;
    }>(
      `SELECT l.id, l.name FROM contact_lists l
       JOIN contact_list_memberships m ON m.list_id = l.id
       WHERE m.contact_id = ?
       ORDER BY l.name COLLATE NOCASE, l.id`,
      contactId,
    )
    .toArray()
    .map((row) => ({ id: row.id, name: row.name }));
}

function readLinkedProfile(
  storage: ContactStoreStorage,
  profileId: string | null,
): ContactDetailLinkedProfile | null {
  if (profileId === null || profileId === "") return null;
  const row = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly displayName: string;
      readonly id: string;
    }>("SELECT id, display_name AS displayName FROM profiles WHERE id = ? LIMIT 1", profileId)
    .toArray()
    .at(0);
  return row ? { displayName: row.displayName, id: row.id } : null;
}

function readContactActivity(
  storage: ContactStoreStorage,
  contactId: string,
): ContactDetailActivity {
  const ticketPurchaseCount =
    storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        "SELECT COUNT(*) AS count FROM ticket_purchases WHERE contact_id = ?",
        contactId,
      )
      .toArray()
      .at(0)?.count ?? 0;
  const donationCount =
    storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        "SELECT COUNT(*) AS count FROM donations WHERE contact_id = ?",
        contactId,
      )
      .toArray()
      .at(0)?.count ?? 0;
  return { donationCount, ticketPurchaseCount };
}

function readLastEmailAt(storage: ContactStoreStorage, contactId: string): string | null {
  const value = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly lastEmailAt: string | null }>(
      `SELECT MAX(created_at) AS lastEmailAt FROM communication_deliveries
       WHERE profile_id = ? AND channel = 'email' AND status = 'sent'`,
      contactId,
    )
    .toArray()
    .at(0)?.lastEmailAt;
  return typeof value === "string" && value !== "" ? value : null;
}

export function getContactFromStore(
  storage: ContactStoreStorage,
  organizationId: string | null,
  contactId: string,
): {
  readonly activity: ContactDetailActivity;
  readonly contact: Contact;
  readonly lastEmailAt: string | null;
  readonly linkedProfile: ContactDetailLinkedProfile | null;
  readonly listIds: readonly string[];
  readonly lists: readonly ContactDetailList[];
  readonly preferences: readonly ContactCommunicationPreference[];
} {
  assertOrganization(storage, organizationId);
  requireUuid(contactId, "contact_not_found");
  const row = readContactRow(storage, contactId);
  if (!row) throw new ContactStoreError("contact_not_found", "Contact not found.");
  return {
    activity: readContactActivity(storage, contactId),
    contact: parseContactRow(row),
    lastEmailAt: readLastEmailAt(storage, contactId),
    linkedProfile: readLinkedProfile(storage, row.profileId),
    listIds: readListIds(storage, contactId),
    lists: readContactLists(storage, contactId),
    preferences: readPreferences(storage, contactId),
  };
}

function parseCursor(cursor: string | null | undefined): number {
  if (cursor === null || cursor === undefined || cursor.trim() === "") return 0;
  if (cursor.length > 256) throw new ContactStoreError("validation_failed", "Invalid cursor.");
  const offset = Number.parseInt(cursor.trim(), 10);
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new ContactStoreError("validation_failed", "Invalid cursor.");
  }
  return offset;
}

export interface NormalizedListContactsOptions {
  readonly limit: number;
  readonly listId: string | null;
  readonly offset: number;
  readonly query: string;
  readonly source: string | null;
}

function assertListFilterExists(
  storage: ContactStoreStorage,
  listId: string | null | undefined,
): string | null {
  if (listId === undefined || listId === null) return null;
  requireUuid(listId);
  const listExists =
    storage.sql.exec("SELECT 1 FROM contact_lists WHERE id = ? LIMIT 1", listId).toArray().length >
    0;
  if (!listExists) throw new ContactStoreError("contact_list_not_found", "Contact list not found.");
  return listId;
}

function normalizeTextFilter(
  value: string | null | undefined,
  maxLength: number,
  code: string,
): string | null {
  const trimmed = value?.trim() ? value.trim() : null;
  if (trimmed !== null && trimmed.length > maxLength) {
    throw new ContactStoreError("validation_failed", code);
  }
  return trimmed;
}

function assertChannelStatusFilters(input: ListContactsInput): void {
  if (input.channel !== undefined && !z.enum(["email", "sms"]).safeParse(input.channel).success) {
    throw new ContactStoreError("validation_failed", "Invalid channel filter.");
  }
  if (input.status !== undefined && !contactStatusSchema.safeParse(input.status).success) {
    throw new ContactStoreError("validation_failed", "Invalid status filter.");
  }
}

function normalizeListContactsOptions(
  storage: ContactStoreStorage,
  input: ListContactsInput,
): NormalizedListContactsOptions {
  assertOrganization(storage, input.organizationId ?? null);
  const listId = assertListFilterExists(storage, input.listId);
  const query = normalizeTextFilter(input.query ?? "", 200, "Query is too long.") ?? "";
  const source = normalizeTextFilter(input.source, 200, "Source filter is too long.");
  assertChannelStatusFilters(input);
  return {
    limit: Math.min(Math.max(input.limit ?? 100, 1), CONTACT_RESPONSE_MAX),
    listId,
    offset: parseCursor(input.cursor),
    query,
    source,
  };
}

function buildContactWhereClause(
  options: NormalizedListContactsOptions,
  input: ListContactsInput,
): { readonly params: unknown[]; readonly whereSql: string } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.query !== "") {
    const pattern = `%${options.query}%`;
    where.push(
      `(display_name LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)`,
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (options.source !== null) {
    where.push(`source = ?`);
    params.push(options.source);
  }
  if (options.listId !== null) {
    where.push(`id IN (SELECT contact_id FROM contact_list_memberships WHERE list_id = ?)`);
    params.push(options.listId);
  }
  appendPreferenceFilter(where, params, input);
  return { params, whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "" };
}

function appendPreferenceFilter(
  where: string[],
  params: unknown[],
  input: ListContactsInput,
): void {
  if (input.channel !== undefined && input.status !== undefined) {
    where.push(
      `EXISTS (SELECT 1 FROM contact_communication_preferences p WHERE p.contact_id = contacts.id AND p.channel = ? AND p.status = ?)`,
    );
    params.push(input.channel, input.status);
  } else if (input.channel !== undefined) {
    where.push(
      `EXISTS (SELECT 1 FROM contact_communication_preferences p WHERE p.contact_id = contacts.id AND p.channel = ?)`,
    );
    params.push(input.channel);
  } else if (input.status !== undefined) {
    where.push(
      `EXISTS (SELECT 1 FROM contact_communication_preferences p WHERE p.contact_id = contacts.id AND p.status = ?)`,
    );
    params.push(input.status);
  }
}

function readMembershipsForContacts(
  storage: ContactStoreStorage,
  contactIds: readonly string[],
): ContactListMembership[] {
  if (contactIds.length === 0) return [];
  return storage.sql
    .exec<MembershipRow>(
      `SELECT contact_id AS contactId, list_id AS listId, created_at AS createdAt
        FROM contact_list_memberships WHERE contact_id IN (${placeholders(contactIds.length)})`,
      ...contactIds,
    )
    .toArray()
    .map((row) => ({ contactId: row.contactId, createdAt: row.createdAt, listId: row.listId }));
}

function readPreferencesForContacts(
  storage: ContactStoreStorage,
  contactIds: readonly string[],
): ContactCommunicationPreference[] {
  if (contactIds.length === 0) return [];
  const rows = storage.sql
    .exec<PreferenceRow>(
      `SELECT contact_id AS contactId, channel, status, source,
        observed_at AS observedAt, updated_at AS updatedAt
       FROM contact_communication_preferences WHERE contact_id IN (${placeholders(contactIds.length)})`,
      ...contactIds,
    )
    .toArray();
  return rows.map(parsePreferenceRow);
}

export function listContactsFromStore(
  storage: ContactStoreStorage,
  input: ListContactsInput,
): {
  readonly contacts: readonly Contact[];
  readonly hasMore: boolean;
  readonly memberships: readonly ContactListMembership[];
  readonly nextCursor: string | null;
  readonly preferences: readonly ContactCommunicationPreference[];
} {
  const options = normalizeListContactsOptions(storage, input);
  const { params, whereSql } = buildContactWhereClause(options, input);
  const rows = storage.sql
    .exec<ContactRow>(
      `SELECT ${CONTACT_COLUMNS} FROM contacts ${whereSql}
       ORDER BY display_name COLLATE NOCASE ASC, id ASC LIMIT ? OFFSET ?`,
      ...params,
      options.limit + 1,
      options.offset,
    )
    .toArray();
  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const pageContactIds = input.includeDetails === true ? page.map((row) => row.id) : [];
  return {
    contacts: page.map(parseContactRow),
    hasMore,
    memberships: readMembershipsForContacts(storage, pageContactIds),
    nextCursor: hasMore ? String(options.offset + options.limit) : null,
    preferences: readPreferencesForContacts(storage, pageContactIds),
  };
}
