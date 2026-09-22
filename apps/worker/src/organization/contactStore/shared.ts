import {
  contactCommunicationStatusSchema,
  contactListSchema,
  contactSchema,
  type Contact,
  type ContactCommunicationPreference,
  type ContactList,
} from "@choir/contracts";
import { normalizeEmail, normalizePhone } from "@choir/domain";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import { z } from "zod";

import {
  ContactStoreError,
  type ContactStoreErrorCode,
  type ContactStoreStorage,
} from "./contracts";

export const uuidSchema = z.uuid();
export const organizationIdSchema = z.string().min(1).max(128);
export const actorUserIdSchema = z.string().min(1).max(128);
export const contactStatusSchema = contactCommunicationStatusSchema;

export const CONTACT_COLUMNS = `id, first_name AS firstName, last_name AS lastName,
  display_name AS displayName, email, normalized_email AS normalizedEmail,
  phone, normalized_phone AS normalizedPhone, profile_id AS profileId,
  source, created_at AS createdAt, updated_at AS updatedAt`;

export interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export interface ContactRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly id: string;
  readonly lastName: string | null;
  readonly normalizedEmail: string | null;
  readonly normalizedPhone: string | null;
  readonly phone: string | null;
  readonly profileId: string | null;
  readonly source: string | null;
  readonly updatedAt: string;
}

export interface PreferenceRow {
  readonly [column: string]: SqlStorageValue;
  readonly channel: string;
  readonly contactId: string;
  readonly observedAt: string;
  readonly source: string | null;
  readonly status: string;
  readonly updatedAt: string;
}

export interface ContactListRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly description: string | null;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

export interface MembershipRow {
  readonly [column: string]: SqlStorageValue;
  readonly contactId: string;
  readonly createdAt: string;
  readonly listId: string;
}

export function storedOrganizationId(storage: ContactStoreStorage): string | undefined {
  return storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
}

export function assertOrganization(
  storage: ContactStoreStorage,
  organizationId: string | null | undefined,
): void {
  if (!organizationId || storedOrganizationId(storage) !== organizationId) {
    throw new ContactStoreError(
      "organization_identity_conflict",
      "Organization identity mismatch.",
    );
  }
}

export function requireUuid(
  value: string,
  code: ContactStoreErrorCode = "validation_failed",
): void {
  if (!uuidSchema.safeParse(value).success) {
    throw new ContactStoreError(code, "Expected a UUID.");
  }
}

export function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeEmailForStorage(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  if (normalized === null) return null;
  const trimmed = normalized.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePhoneForStorage(phone: string | null | undefined): string | null {
  return normalizePhone(phone);
}

export function profileExists(storage: ContactStoreStorage, profileId: string): boolean {
  return (
    storage.sql.exec("SELECT 1 FROM profiles WHERE id = ? LIMIT 1", profileId).toArray().length > 0
  );
}

export function findContactIdByNormalizedEmail(
  storage: ContactStoreStorage,
  normalizedEmail: string,
  excludeContactId?: string,
): string | undefined {
  const rows =
    excludeContactId === undefined
      ? storage.sql
          .exec<{ readonly id: string }>(
            "SELECT id FROM contacts WHERE normalized_email = ? LIMIT 1",
            normalizedEmail,
          )
          .toArray()
      : storage.sql
          .exec<{ readonly id: string }>(
            "SELECT id FROM contacts WHERE normalized_email = ? AND id <> ? LIMIT 1",
            normalizedEmail,
            excludeContactId,
          )
          .toArray();
  return rows.at(0)?.id;
}

export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Error) {
    return /UNIQUE constraint failed|unique/i.test(error.message);
  }
  return false;
}

export function parseContactRow(row: ContactRow): Contact {
  return contactSchema.parse({
    createdAt: row.createdAt,
    displayName: row.displayName,
    email: row.email,
    firstName: row.firstName,
    id: row.id,
    lastName: row.lastName,
    normalizedEmail: row.normalizedEmail,
    normalizedPhone: row.normalizedPhone,
    phone: row.phone,
    profileId: row.profileId,
    source: row.source,
    updatedAt: row.updatedAt,
  });
}

export function parsePreferenceRow(row: PreferenceRow): ContactCommunicationPreference {
  return {
    channel: row.channel === "sms" ? "sms" : "email",
    contactId: row.contactId,
    observedAt: row.observedAt,
    source: row.source,
    status:
      row.status === "subscribed"
        ? "subscribed"
        : row.status === "unsubscribed"
          ? "unsubscribed"
          : "unknown",
  };
}

export function parseListRow(row: ContactListRow): ContactList {
  return contactListSchema.parse({
    createdAt: row.createdAt,
    description: row.description,
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
  });
}

export function readContactRow(
  storage: ContactStoreStorage,
  contactId: string,
): ContactRow | undefined {
  return storage.sql
    .exec<ContactRow>(`SELECT ${CONTACT_COLUMNS} FROM contacts WHERE id = ? LIMIT 1`, contactId)
    .toArray()
    .at(0);
}

export function readPreferences(
  storage: ContactStoreStorage,
  contactId: string,
): ContactCommunicationPreference[] {
  const rows = storage.sql
    .exec<PreferenceRow>(
      `SELECT contact_id AS contactId, channel, status, source,
        observed_at AS observedAt, updated_at AS updatedAt
       FROM contact_communication_preferences WHERE contact_id = ? ORDER BY channel ASC`,
      contactId,
    )
    .toArray();
  const byChannel = new Map(rows.map((row) => [row.channel, row]));
  const result: ContactCommunicationPreference[] = [];
  for (const channel of ["email", "sms"] as const) {
    const row = byChannel.get(channel);
    if (row) {
      result.push(parsePreferenceRow(row));
    } else {
      // Defensive default for rows predating preference backfill; never writes here.
      result.push({
        channel,
        contactId,
        observedAt: new Date(0).toISOString(),
        source: null,
        status: "unknown",
      });
    }
  }
  return result;
}

export function readListIds(storage: ContactStoreStorage, contactId: string): string[] {
  return storage.sql
    .exec<MembershipRow>(
      "SELECT contact_id AS contactId, list_id AS listId, created_at AS createdAt FROM contact_list_memberships WHERE contact_id = ?",
      contactId,
    )
    .toArray()
    .map((row) => row.listId);
}

export function writeAudit(
  storage: ContactStoreStorage,
  params: {
    readonly action: string;
    readonly actorUserId: string;
    readonly occurredAt: string;
    readonly requestId: string;
    readonly summary: unknown;
    readonly targetId: string;
    readonly targetType: string;
  },
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    params.actorUserId,
    params.action,
    params.targetType,
    params.targetId,
    params.requestId,
    JSON.stringify(params.summary),
    params.occurredAt,
  );
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
