import {
  CONTACT_BULK_OPERATION_MAX,
  CONTACT_RESPONSE_MAX,
  contactCommunicationStatusSchema,
  contactCreateRequestSchema,
  contactListCreateRequestSchema,
  contactListSchema,
  contactListUpdateRequestSchema,
  contactSchema,
  type Contact,
  type ContactCommunicationPreference,
  type ContactCommunicationStatus,
  type ContactList,
  type ContactListMembership,
} from "@choir/contracts";
import {
  hasAcceptableContactIdentity,
  mergeContactCommunicationStatus,
  normalizeEmail,
  normalizePhone,
} from "@choir/domain";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import { z } from "zod";

/**
 * Phase 2 marketing-contacts persistence layer.
 *
 * Tenancy: every method requires an explicit `organizationId` that must match
 * the single `organization_metadata` row in this Durable Object. The DO owns
 * exactly one Organization, so all contact/list rows are implicitly scoped.
 *
 * Deletion choice: `deleteContact` performs a hard delete that explicitly
 * removes memberships and communication preferences inside one transaction
 * while preserving append-only `audit_events` rows. Future commerce linkage
 * (ticket purchases / donations `contact_id`, Phase 8) must use nullable
 * `contact_id ... REFERENCES contacts(id) ON DELETE SET NULL` so historical
 * transaction snapshots survive contact deletion. No commerce `contact_id`
 * columns are touched in Phase 2.
 */

export interface ContactStoreStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: readonly unknown[]
    ): {
      toArray(): T[];
    };
  };
  transactionSync<T>(fn: () => T): T;
}

export type ContactStoreErrorCode =
  | "organization_identity_conflict"
  | "contact_not_found"
  | "contact_duplicate_email"
  | "contact_missing_identity"
  | "contact_profile_not_found"
  | "contact_list_not_found"
  | "contact_import_not_found"
  | "contact_import_conflict"
  | "validation_failed";

export class ContactStoreError extends Error {
  readonly code: ContactStoreErrorCode;

  constructor(code: ContactStoreErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "ContactStoreError";
    this.code = code;
  }
}

const uuidSchema = z.uuid();
const organizationIdSchema = z.string().min(1).max(128);
const actorUserIdSchema = z.string().min(1).max(128);
const contactStatusSchema = contactCommunicationStatusSchema;

const CONTACT_COLUMNS = `id, first_name AS firstName, last_name AS lastName,
  display_name AS displayName, email, normalized_email AS normalizedEmail,
  phone, normalized_phone AS normalizedPhone, profile_id AS profileId,
  source, created_at AS createdAt, updated_at AS updatedAt`;

interface ContactRow {
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

interface PreferenceRow {
  readonly [column: string]: SqlStorageValue;
  readonly channel: string;
  readonly contactId: string;
  readonly observedAt: string;
  readonly source: string | null;
  readonly status: string;
  readonly updatedAt: string;
}

interface ContactListRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly description: string | null;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

interface MembershipRow {
  readonly [column: string]: SqlStorageValue;
  readonly contactId: string;
  readonly createdAt: string;
  readonly listId: string;
}

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export interface CreateContactInput {
  readonly actorUserId: string;
  readonly contactId: string;
  readonly displayName?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly emailStatus?: ContactCommunicationStatus | undefined;
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly organizationId: string;
  readonly phone?: string | null | undefined;
  readonly preferenceSource?: string | null | undefined;
  readonly profileId?: string | null | undefined;
  readonly requestId: string;
  readonly smsStatus?: ContactCommunicationStatus | undefined;
  readonly source?: string | null | undefined;
}

export interface UpdateContactInput {
  readonly actorUserId: string;
  readonly contactId: string;
  readonly displayName?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly emailStatus?: ContactCommunicationStatus | undefined;
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly organizationId: string;
  readonly phone?: string | null | undefined;
  readonly preferenceSource?: string | null | undefined;
  readonly profileId?: string | null | undefined;
  readonly requestId: string;
  readonly smsStatus?: ContactCommunicationStatus | undefined;
  readonly source?: string | null | undefined;
}

export interface ListContactsInput {
  readonly channel?: "email" | "sms" | undefined;
  readonly cursor?: string | null | undefined;
  readonly includeDetails?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly listId?: string | null | undefined;
  readonly organizationId: string | null;
  readonly query?: string | undefined;
  readonly source?: string | null | undefined;
  readonly status?: ContactCommunicationStatus | undefined;
}

export interface CreateContactListInput {
  readonly actorUserId: string;
  readonly description?: string | null | undefined;
  readonly listId: string;
  readonly name: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export interface UpdateContactListInput {
  readonly actorUserId: string;
  readonly description?: string | null | undefined;
  readonly listId: string;
  readonly name?: string | undefined;
  readonly organizationId: string;
  readonly requestId: string;
}

export interface ContactMutationContext {
  readonly actorUserId: string;
  readonly listId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export interface BulkMembershipInput extends ContactMutationContext {
  readonly contactIds: readonly string[];
}

function storedOrganizationId(storage: ContactStoreStorage): string | undefined {
  return storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
}

function assertOrganization(
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

function requireUuid(value: string, code: ContactStoreErrorCode = "validation_failed"): void {
  if (!uuidSchema.safeParse(value).success) {
    throw new ContactStoreError(code, "Expected a UUID.");
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmailForStorage(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  if (normalized === null) return null;
  const trimmed = normalized.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePhoneForStorage(phone: string | null | undefined): string | null {
  return normalizePhone(phone);
}

function profileExists(storage: ContactStoreStorage, profileId: string): boolean {
  return (
    storage.sql.exec("SELECT 1 FROM profiles WHERE id = ? LIMIT 1", profileId).toArray().length > 0
  );
}

function findContactIdByNormalizedEmail(
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

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Error) {
    return /UNIQUE constraint failed|unique/i.test(error.message);
  }
  return false;
}

function parseContactRow(row: ContactRow): Contact {
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

function parsePreferenceRow(row: PreferenceRow): ContactCommunicationPreference {
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

function parseListRow(row: ContactListRow): ContactList {
  return contactListSchema.parse({
    createdAt: row.createdAt,
    description: row.description,
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
  });
}

function readContactRow(storage: ContactStoreStorage, contactId: string): ContactRow | undefined {
  return storage.sql
    .exec<ContactRow>(`SELECT ${CONTACT_COLUMNS} FROM contacts WHERE id = ? LIMIT 1`, contactId)
    .toArray()
    .at(0);
}

function readPreferences(
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

function readListIds(storage: ContactStoreStorage, contactId: string): string[] {
  return storage.sql
    .exec<MembershipRow>(
      "SELECT contact_id AS contactId, list_id AS listId, created_at AS createdAt FROM contact_list_memberships WHERE contact_id = ?",
      contactId,
    )
    .toArray()
    .map((row) => row.listId);
}

export interface ContactDetailList {
  readonly id: string;
  readonly name: string;
}

export interface ContactDetailLinkedProfile {
  readonly displayName: string;
  readonly id: string;
}

export interface ContactDetailActivity {
  readonly donationCount: number;
  readonly ticketPurchaseCount: number;
}

/**
 * Phase 10 unified Contact detail enrichment.
 *
 * The Contact remains the relationship/communication identity while every
 * source-of-truth record stays where it belongs: list names resolve from
 * `contact_lists`, the linked roster name from `profiles`, commerce counts
 * from the indexed `contact_id` columns (snapshots untouched), and the last
 * sent email from the delivery carrier that Phase 9 contact sends populate.
 * All reads are bounded single-row aggregates inside this Organization's
 * store, so cross-Organization detail IDs still resolve to not-found.
 */
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

function writeAudit(
  storage: ContactStoreStorage,
  params: {
    readonly actorUserId: string;
    readonly action: string;
    readonly requestId: string;
    readonly summary: unknown;
    readonly targetId: string;
    readonly targetType: string;
    readonly occurredAt: string;
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

function validateCreateInput(input: CreateContactInput): void {
  if (!organizationIdSchema.safeParse(input.organizationId).success) {
    throw new ContactStoreError("validation_failed", "Invalid organizationId.");
  }
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.contactId);
  requireUuid(input.requestId);
  if (
    input.profileId !== undefined &&
    input.profileId !== null &&
    !uuidSchema.safeParse(input.profileId).success
  ) {
    throw new ContactStoreError("validation_failed", "Invalid profileId.");
  }
  if (
    input.emailStatus !== undefined &&
    !contactStatusSchema.safeParse(input.emailStatus).success
  ) {
    throw new ContactStoreError("validation_failed", "Invalid emailStatus.");
  }
  if (input.smsStatus !== undefined && !contactStatusSchema.safeParse(input.smsStatus).success) {
    throw new ContactStoreError("validation_failed", "Invalid smsStatus.");
  }
}

function contactFieldsForValidation(value: {
  readonly displayName?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly profileId?: string | null | undefined;
  readonly source?: string | null | undefined;
}): Record<string, unknown> {
  return {
    displayName: value.displayName ?? null,
    email: value.email ?? null,
    firstName: value.firstName ?? null,
    lastName: value.lastName ?? null,
    phone: value.phone ?? null,
    profileId: value.profileId ?? null,
    source: value.source ?? null,
  };
}

export function createContactInStore(
  storage: ContactStoreStorage,
  input: CreateContactInput,
): { readonly contact: Contact; readonly preferences: readonly ContactCommunicationPreference[] } {
  validateCreateInput(input);
  assertOrganization(storage, input.organizationId);

  const firstName = emptyToNull(input.firstName);
  const lastName = emptyToNull(input.lastName);
  const displayName = emptyToNull(input.displayName);
  const source = emptyToNull(input.source);
  const email = input.email ?? null;
  const phone = input.phone ?? null;
  const profileId = emptyToNull(input.profileId);
  const preferenceSource = emptyToNull(input.preferenceSource);

  const candidate = contactFieldsForValidation({
    displayName,
    email,
    firstName,
    lastName,
    phone,
    profileId,
    source,
  });
  // Reuse Phase 1 contract validation (email shape, field lengths, identity).
  const parsed = contactCreateRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    if (!hasAcceptableContactIdentity(candidate)) {
      throw new ContactStoreError(
        "contact_missing_identity",
        "A contact requires a name, contact method, or linked profile.",
      );
    }
    throw new ContactStoreError("validation_failed", "Invalid contact fields.");
  }

  const normalizedEmail = normalizeEmailForStorage(email);
  const normalizedPhone = normalizePhoneForStorage(phone);

  if (profileId !== null && !profileExists(storage, profileId)) {
    throw new ContactStoreError("contact_profile_not_found", "Linked profile does not exist.");
  }
  if (
    normalizedEmail !== null &&
    findContactIdByNormalizedEmail(storage, normalizedEmail) !== undefined
  ) {
    throw new ContactStoreError(
      "contact_duplicate_email",
      "A contact with this email already exists.",
    );
  }

  const emailStatus = input.emailStatus ?? "unknown";
  const smsStatus = input.smsStatus ?? "unknown";
  const now = new Date().toISOString();

  try {
    storage.transactionSync(() => {
      storage.sql.exec(
        `INSERT INTO contacts
          (id, first_name, last_name, display_name, email, normalized_email,
           phone, normalized_phone, profile_id, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.contactId,
        firstName,
        lastName,
        displayName,
        email,
        normalizedEmail,
        phone,
        normalizedPhone,
        profileId,
        source,
        now,
        now,
      );
      for (const [channel, status] of [
        ["email", emailStatus],
        ["sms", smsStatus],
      ] as const) {
        storage.sql.exec(
          `INSERT INTO contact_communication_preferences
            (contact_id, channel, status, source, observed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          input.contactId,
          channel,
          status,
          preferenceSource ?? source,
          now,
          now,
        );
      }
      // Audit carries no email/phone values, only presence flags.
      writeAudit(storage, {
        action: "contact.created",
        actorUserId: input.actorUserId,
        occurredAt: now,
        requestId: input.requestId,
        summary: {
          displayName,
          hasEmail: email !== null,
          hasPhone: phone !== null,
          profileLinked: profileId !== null,
          source,
        },
        targetId: input.contactId,
        targetType: "contact",
      });
    });
  } catch (error: unknown) {
    if (error instanceof ContactStoreError) throw error;
    if (isUniqueViolation(error)) {
      throw new ContactStoreError(
        "contact_duplicate_email",
        "A contact with this email already exists.",
      );
    }
    throw error;
  }

  const row = readContactRow(storage, input.contactId);
  if (!row) throw new ContactStoreError("contact_not_found", "Contact was not created.");
  return { contact: parseContactRow(row), preferences: readPreferences(storage, input.contactId) };
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

interface NextContactFields {
  readonly nextDisplayName: string | null;
  readonly nextEmail: string | null;
  readonly nextFirstName: string | null;
  readonly nextLastName: string | null;
  readonly nextNormalizedEmail: string | null;
  readonly nextNormalizedPhone: string | null;
  readonly nextPhone: string | null;
  readonly nextProfileId: string | null;
  readonly nextSource: string | null;
}

function validateUpdateContactShape(input: UpdateContactInput): void {
  if (!organizationIdSchema.safeParse(input.organizationId).success) {
    throw new ContactStoreError("validation_failed", "Invalid organizationId.");
  }
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.contactId, "contact_not_found");
  requireUuid(input.requestId);
  const hasPatch = [
    input.displayName,
    input.email,
    input.firstName,
    input.lastName,
    input.phone,
    input.profileId,
    input.source,
    input.emailStatus,
    input.smsStatus,
    input.preferenceSource,
  ].some((value) => value !== undefined);
  if (!hasPatch) {
    throw new ContactStoreError("validation_failed", "At least one Contact field must be updated.");
  }
  if (
    input.emailStatus !== undefined &&
    !contactStatusSchema.safeParse(input.emailStatus).success
  ) {
    throw new ContactStoreError("validation_failed", "Invalid emailStatus.");
  }
  if (input.smsStatus !== undefined && !contactStatusSchema.safeParse(input.smsStatus).success) {
    throw new ContactStoreError("validation_failed", "Invalid smsStatus.");
  }
  if (
    input.profileId !== undefined &&
    input.profileId !== null &&
    !uuidSchema.safeParse(input.profileId).success
  ) {
    throw new ContactStoreError("validation_failed", "Invalid profileId.");
  }
}

function resolveNextContactFields(
  existing: ContactRow,
  input: UpdateContactInput,
): NextContactFields {
  const nextFirstName =
    input.firstName === undefined ? existing.firstName : emptyToNull(input.firstName);
  const nextLastName =
    input.lastName === undefined ? existing.lastName : emptyToNull(input.lastName);
  const nextDisplayName =
    input.displayName === undefined ? existing.displayName : emptyToNull(input.displayName);
  const nextEmail = input.email === undefined ? existing.email : input.email;
  const nextPhone = input.phone === undefined ? existing.phone : input.phone;
  const nextProfileId =
    input.profileId === undefined ? existing.profileId : emptyToNull(input.profileId);
  const nextSource = input.source === undefined ? existing.source : emptyToNull(input.source);
  // Resulting-identity rule: an update must not leave the contact without identity.
  const nextNormalizedEmail = normalizeEmailForStorage(nextEmail);
  const nextNormalizedPhone = normalizePhoneForStorage(nextPhone);
  if (
    !hasAcceptableContactIdentity({
      displayName: nextDisplayName,
      email: nextEmail,
      firstName: nextFirstName,
      lastName: nextLastName,
      normalizedEmail: nextNormalizedEmail,
      normalizedPhone: nextNormalizedPhone,
      phone: nextPhone,
      profileId: nextProfileId,
    })
  ) {
    throw new ContactStoreError(
      "contact_missing_identity",
      "An update must not leave a contact without identity.",
    );
  }
  return {
    nextDisplayName,
    nextEmail,
    nextFirstName,
    nextLastName,
    nextNormalizedEmail,
    nextNormalizedPhone,
    nextPhone,
    nextProfileId,
    nextSource,
  };
}

function assertUpdateReferentialIntegrity(
  storage: ContactStoreStorage,
  existing: ContactRow,
  next: NextContactFields,
  contactId: string,
): void {
  if (
    next.nextProfileId !== null &&
    next.nextProfileId !== existing.profileId &&
    !profileExists(storage, next.nextProfileId)
  ) {
    throw new ContactStoreError("contact_profile_not_found", "Linked profile does not exist.");
  }
  if (
    next.nextNormalizedEmail !== null &&
    next.nextNormalizedEmail !== existing.normalizedEmail &&
    findContactIdByNormalizedEmail(storage, next.nextNormalizedEmail, contactId) !== undefined
  ) {
    throw new ContactStoreError(
      "contact_duplicate_email",
      "A contact with this email already exists.",
    );
  }
}

interface MergedContactStatuses {
  readonly existingEmailStatus: ContactCommunicationStatus;
  readonly existingSmsStatus: ContactCommunicationStatus;
  readonly nextEmailStatus: string;
  readonly nextSmsStatus: string;
  readonly preferenceByChannel: ReadonlyMap<string, ContactCommunicationPreference>;
  readonly preferenceSource: string | null;
}

function resolveMergedContactStatuses(
  storage: ContactStoreStorage,
  contactId: string,
  input: UpdateContactInput,
): MergedContactStatuses {
  const existingPreferences = readPreferences(storage, contactId);
  const preferenceByChannel = new Map(
    existingPreferences.map((preference) => [preference.channel, preference]),
  );
  const existingEmailStatus = preferenceByChannel.get("email")?.status ?? "unknown";
  const existingSmsStatus = preferenceByChannel.get("sms")?.status ?? "unknown";
  // Consent precedence: existing unsubscribe/suppression always wins (Phase 1 helper).
  const nextEmailStatus =
    input.emailStatus === undefined
      ? existingEmailStatus
      : mergeContactCommunicationStatus(existingEmailStatus, input.emailStatus);
  const nextSmsStatus =
    input.smsStatus === undefined
      ? existingSmsStatus
      : mergeContactCommunicationStatus(existingSmsStatus, input.smsStatus);
  return {
    existingEmailStatus,
    existingSmsStatus,
    nextEmailStatus,
    nextSmsStatus,
    preferenceByChannel,
    preferenceSource:
      input.preferenceSource === undefined ? null : emptyToNull(input.preferenceSource),
  };
}

function persistContactUpdate(
  storage: ContactStoreStorage,
  input: UpdateContactInput,
  next: NextContactFields,
  statuses: MergedContactStatuses,
  now: string,
): void {
  storage.sql.exec(
    `UPDATE contacts SET first_name = ?, last_name = ?, display_name = ?,
      email = ?, normalized_email = ?, phone = ?, normalized_phone = ?,
      profile_id = ?, source = ?, updated_at = ? WHERE id = ?`,
    next.nextFirstName,
    next.nextLastName,
    next.nextDisplayName,
    next.nextEmail,
    next.nextNormalizedEmail,
    next.nextPhone,
    next.nextNormalizedPhone,
    next.nextProfileId,
    next.nextSource,
    now,
    input.contactId,
  );
  persistPreferenceUpdate(
    storage,
    input,
    next,
    statuses,
    now,
    "email",
    statuses.nextEmailStatus,
    statuses.existingEmailStatus,
  );
  persistPreferenceUpdate(
    storage,
    input,
    next,
    statuses,
    now,
    "sms",
    statuses.nextSmsStatus,
    statuses.existingSmsStatus,
  );
  writeAudit(storage, {
    action: "contact.updated",
    actorUserId: input.actorUserId,
    occurredAt: now,
    requestId: input.requestId,
    summary: {
      displayName: next.nextDisplayName,
      emailStatusChanged: statuses.nextEmailStatus !== statuses.existingEmailStatus,
      hasEmail: next.nextEmail !== null,
      hasPhone: next.nextPhone !== null,
      profileLinked: next.nextProfileId !== null,
      smsStatusChanged: statuses.nextSmsStatus !== statuses.existingSmsStatus,
    },
    targetId: input.contactId,
    targetType: "contact",
  });
}

function persistPreferenceUpdate(
  storage: ContactStoreStorage,
  input: UpdateContactInput,
  next: NextContactFields,
  statuses: MergedContactStatuses,
  now: string,
  channel: "email" | "sms",
  status: string,
  previous: string,
): void {
  if (status === previous && statuses.preferenceSource === null) return;
  const previousRow = statuses.preferenceByChannel.get(channel);
  storage.sql.exec(
    `INSERT INTO contact_communication_preferences
      (contact_id, channel, status, source, observed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(contact_id, channel) DO UPDATE SET
       status = excluded.status,
       source = COALESCE(excluded.source, contact_communication_preferences.source),
       observed_at = CASE WHEN contact_communication_preferences.status != excluded.status
         THEN excluded.observed_at ELSE contact_communication_preferences.observed_at END,
       updated_at = excluded.updated_at`,
    input.contactId,
    channel,
    status,
    statuses.preferenceSource ?? previousRow?.source ?? next.nextSource,
    now,
    now,
  );
}

export function updateContactInStore(
  storage: ContactStoreStorage,
  input: UpdateContactInput,
): { readonly contact: Contact; readonly preferences: readonly ContactCommunicationPreference[] } {
  validateUpdateContactShape(input);
  assertOrganization(storage, input.organizationId);
  const existing = readContactRow(storage, input.contactId);
  if (!existing) throw new ContactStoreError("contact_not_found", "Contact not found.");
  const next = resolveNextContactFields(existing, input);
  assertUpdateReferentialIntegrity(storage, existing, next, input.contactId);
  const statuses = resolveMergedContactStatuses(storage, input.contactId, input);
  const now = new Date().toISOString();
  try {
    storage.transactionSync(() => {
      persistContactUpdate(storage, input, next, statuses, now);
    });
  } catch (error: unknown) {
    if (error instanceof ContactStoreError) throw error;
    if (isUniqueViolation(error)) {
      throw new ContactStoreError(
        "contact_duplicate_email",
        "A contact with this email already exists.",
      );
    }
    throw error;
  }
  const row = readContactRow(storage, input.contactId);
  if (!row) throw new ContactStoreError("contact_not_found", "Contact not found.");
  return { contact: parseContactRow(row), preferences: readPreferences(storage, input.contactId) };
}

export function deleteContactInStore(
  storage: ContactStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly contactId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
): { readonly contactId: string; readonly deleted: true } {
  if (!organizationIdSchema.safeParse(input.organizationId).success) {
    throw new ContactStoreError("validation_failed", "Invalid organizationId.");
  }
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.contactId, "contact_not_found");
  requireUuid(input.requestId);
  assertOrganization(storage, input.organizationId);

  const existing = readContactRow(storage, input.contactId);
  if (!existing) throw new ContactStoreError("contact_not_found", "Contact not found.");
  const membershipCount =
    storage.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM contact_list_memberships WHERE contact_id = ?",
        input.contactId,
      )
      .toArray()
      .at(0)?.count ?? 0;

  const now = new Date().toISOString();
  storage.transactionSync(() => {
    // Explicit deletes keep behavior correct even when SQLite foreign_keys is off;
    // the ON DELETE CASCADE clauses remain as a safety net when enforcement is on.
    storage.sql.exec("DELETE FROM contact_list_memberships WHERE contact_id = ?", input.contactId);
    storage.sql.exec(
      "DELETE FROM contact_communication_preferences WHERE contact_id = ?",
      input.contactId,
    );
    // Phase 8 commerce links use ON DELETE SET NULL semantics. Enforcement is
    // off, so null them explicitly; snapshots on the transaction rows survive.
    // The PRAGMA guard keeps deletion working on pre-81 schemas during rollout.
    for (const table of ["ticket_purchases", "donations"] as const) {
      const hasContactColumn = storage.sql
        .exec<{ readonly name: string }>(`PRAGMA table_info(${table})`)
        .toArray()
        .some((column) => column.name === "contact_id");
      if (hasContactColumn) {
        storage.sql.exec(
          `UPDATE ${table} SET contact_id = NULL WHERE contact_id = ?`,
          input.contactId,
        );
      }
    }
    storage.sql.exec("DELETE FROM contacts WHERE id = ?", input.contactId);
    writeAudit(storage, {
      action: "contact.deleted",
      actorUserId: input.actorUserId,
      occurredAt: now,
      requestId: input.requestId,
      summary: { membershipsRemoved: membershipCount },
      targetId: input.contactId,
      targetType: "contact",
    });
  });
  return { contactId: input.contactId, deleted: true as const };
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

interface NormalizedListContactsOptions {
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
  // Single indexed query (no N+1): fetch one extra row to derive hasMore.
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
  // Phase 4 browser enrichment is opt-in so the default list path keeps its
  // bounded query budget: two batched IN queries resolve preferences and list
  // memberships for exactly the returned page (never per-row N+1).
  const pageContactIds = input.includeDetails === true ? page.map((row) => row.id) : [];
  return {
    contacts: page.map(parseContactRow),
    hasMore,
    memberships: readMembershipsForContacts(storage, pageContactIds),
    nextCursor: hasMore ? String(options.offset + options.limit) : null,
    preferences: readPreferencesForContacts(storage, pageContactIds),
  };
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

export function listContactListsFromStore(
  storage: ContactStoreStorage,
  organizationId: string | null,
): { readonly lists: readonly ContactList[] } {
  assertOrganization(storage, organizationId);
  const rows = storage.sql
    .exec<ContactListRow>(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt
       FROM contact_lists ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT 500`,
    )
    .toArray();
  return { lists: rows.map(parseListRow) };
}

export function createContactListInStore(
  storage: ContactStoreStorage,
  input: CreateContactListInput,
): { readonly list: ContactList } {
  if (!organizationIdSchema.safeParse(input.organizationId).success) {
    throw new ContactStoreError("validation_failed", "Invalid organizationId.");
  }
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.listId);
  requireUuid(input.requestId);
  assertOrganization(storage, input.organizationId);
  const parsed = contactListCreateRequestSchema.safeParse({
    description: input.description ?? null,
    name: input.name,
  });
  if (!parsed.success)
    throw new ContactStoreError("validation_failed", "Invalid contact list fields.");

  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO contact_lists (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      input.listId,
      parsed.data.name,
      parsed.data.description ?? null,
      now,
      now,
    );
    writeAudit(storage, {
      action: "contact_list.created",
      actorUserId: input.actorUserId,
      occurredAt: now,
      requestId: input.requestId,
      summary: { name: parsed.data.name },
      targetId: input.listId,
      targetType: "contact_list",
    });
  });
  const row = storage.sql
    .exec<ContactListRow>(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM contact_lists WHERE id = ? LIMIT 1`,
      input.listId,
    )
    .toArray()
    .at(0);
  if (!row) throw new ContactStoreError("contact_list_not_found", "Contact list was not created.");
  return { list: parseListRow(row) };
}

export function updateContactListInStore(
  storage: ContactStoreStorage,
  input: UpdateContactListInput,
): { readonly list: ContactList } {
  if (!organizationIdSchema.safeParse(input.organizationId).success) {
    throw new ContactStoreError("validation_failed", "Invalid organizationId.");
  }
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.listId, "contact_list_not_found");
  requireUuid(input.requestId);
  assertOrganization(storage, input.organizationId);
  if (input.name === undefined && input.description === undefined) {
    throw new ContactStoreError(
      "validation_failed",
      "At least one Contact List field must be updated.",
    );
  }
  const parsed = contactListUpdateRequestSchema.safeParse({
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: input.description }),
  });
  if (!parsed.success)
    throw new ContactStoreError("validation_failed", "Invalid contact list fields.");

  const existing = storage.sql
    .exec<ContactListRow>(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM contact_lists WHERE id = ? LIMIT 1`,
      input.listId,
    )
    .toArray()
    .at(0);
  if (!existing) throw new ContactStoreError("contact_list_not_found", "Contact list not found.");

  const now = new Date().toISOString();
  const nextName = parsed.data.name ?? existing.name;
  const nextDescription =
    input.description === undefined ? existing.description : (parsed.data.description ?? null);
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE contact_lists SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
      nextName,
      nextDescription,
      now,
      input.listId,
    );
    writeAudit(storage, {
      action: "contact_list.updated",
      actorUserId: input.actorUserId,
      occurredAt: now,
      requestId: input.requestId,
      summary: { name: nextName },
      targetId: input.listId,
      targetType: "contact_list",
    });
  });
  const row = storage.sql
    .exec<ContactListRow>(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM contact_lists WHERE id = ? LIMIT 1`,
      input.listId,
    )
    .toArray()
    .at(0);
  if (!row) throw new ContactStoreError("contact_list_not_found", "Contact list not found.");
  return { list: parseListRow(row) };
}

export function deleteContactListInStore(
  storage: ContactStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly listId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
): { readonly deleted: true; readonly listId: string } {
  if (!organizationIdSchema.safeParse(input.organizationId).success) {
    throw new ContactStoreError("validation_failed", "Invalid organizationId.");
  }
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.listId, "contact_list_not_found");
  requireUuid(input.requestId);
  assertOrganization(storage, input.organizationId);
  const existing = storage.sql
    .exec("SELECT 1 FROM contact_lists WHERE id = ? LIMIT 1", input.listId)
    .toArray();
  if (existing.length === 0)
    throw new ContactStoreError("contact_list_not_found", "Contact list not found.");
  const membershipCount =
    storage.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM contact_list_memberships WHERE list_id = ?",
        input.listId,
      )
      .toArray()
      .at(0)?.count ?? 0;
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    // Deleting a list must not delete its contacts, only memberships.
    storage.sql.exec("DELETE FROM contact_list_memberships WHERE list_id = ?", input.listId);
    storage.sql.exec("DELETE FROM contact_lists WHERE id = ?", input.listId);
    writeAudit(storage, {
      action: "contact_list.deleted",
      actorUserId: input.actorUserId,
      occurredAt: now,
      requestId: input.requestId,
      summary: { membershipsRemoved: membershipCount },
      targetId: input.listId,
      targetType: "contact_list",
    });
  });
  return { deleted: true as const, listId: input.listId };
}

function validateBulkMembershipInput(input: BulkMembershipInput): string[] {
  if (!organizationIdSchema.safeParse(input.organizationId).success) {
    throw new ContactStoreError("validation_failed", "Invalid organizationId.");
  }
  if (!actorUserIdSchema.safeParse(input.actorUserId).success) {
    throw new ContactStoreError("validation_failed", "Invalid actorUserId.");
  }
  requireUuid(input.listId, "contact_list_not_found");
  requireUuid(input.requestId);
  if (input.contactIds.length === 0 || input.contactIds.length > CONTACT_BULK_OPERATION_MAX) {
    throw new ContactStoreError(
      "validation_failed",
      `Contact IDs must contain 1-${String(CONTACT_BULK_OPERATION_MAX)} items.`,
    );
  }
  for (const contactId of input.contactIds) {
    requireUuid(contactId, "contact_not_found");
  }
  // Deduplicate request IDs with a Set (O(N), never O(N^2) .find in a growing loop).
  return [...new Set(input.contactIds)];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function addContactsToListInStore(
  storage: ContactStoreStorage,
  input: BulkMembershipInput,
): { readonly added: number; readonly listId: string } {
  const contactIds = validateBulkMembershipInput(input);
  assertOrganization(storage, input.organizationId);
  const listExists =
    storage.sql.exec("SELECT 1 FROM contact_lists WHERE id = ? LIMIT 1", input.listId).toArray()
      .length > 0;
  if (!listExists) throw new ContactStoreError("contact_list_not_found", "Contact list not found.");

  // Single indexed existence check (no N+1 per-contact SELECTs).
  const found = new Set(
    storage.sql
      .exec<{ readonly id: string }>(
        `SELECT id FROM contacts WHERE id IN (${placeholders(contactIds.length)})`,
        ...contactIds,
      )
      .toArray()
      .map((row) => row.id),
  );
  if (found.size !== contactIds.length) {
    throw new ContactStoreError("contact_not_found", "One or more contacts were not found.");
  }
  const alreadyMember = new Set(
    storage.sql
      .exec<{ readonly contactId: string }>(
        `SELECT contact_id AS contactId FROM contact_list_memberships WHERE list_id = ? AND contact_id IN (${placeholders(contactIds.length)})`,
        input.listId,
        ...contactIds,
      )
      .toArray()
      .map((row) => row.contactId),
  );
  const toInsert = contactIds.filter((contactId) => !alreadyMember.has(contactId));
  if (toInsert.length === 0) return { added: 0, listId: input.listId };

  const now = new Date().toISOString();
  storage.transactionSync(() => {
    // Single bulk INSERT (not per-row SELECTs or O(N^2) scans); membership
    // existence was already resolved with indexed IN queries + Set lookups.
    const valuesSql = toInsert.map(() => "(?, ?, ?)").join(", ");
    const bindings: unknown[] = [];
    for (const contactId of toInsert) {
      bindings.push(contactId, input.listId, now);
    }
    storage.sql.exec(
      `INSERT OR IGNORE INTO contact_list_memberships (contact_id, list_id, created_at) VALUES ${valuesSql}`,
      ...bindings,
    );
    writeAudit(storage, {
      action: "contact_list.membership_added",
      actorUserId: input.actorUserId,
      occurredAt: now,
      requestId: input.requestId,
      summary: { added: toInsert.length, listId: input.listId },
      targetId: input.listId,
      targetType: "contact_list",
    });
  });
  return { added: toInsert.length, listId: input.listId };
}

export function removeContactsFromListInStore(
  storage: ContactStoreStorage,
  input: BulkMembershipInput,
): { readonly listId: string; readonly removed: number } {
  const contactIds = validateBulkMembershipInput(input);
  assertOrganization(storage, input.organizationId);
  const listExists =
    storage.sql.exec("SELECT 1 FROM contact_lists WHERE id = ? LIMIT 1", input.listId).toArray()
      .length > 0;
  if (!listExists) throw new ContactStoreError("contact_list_not_found", "Contact list not found.");

  const existing = new Set(
    storage.sql
      .exec<{ readonly contactId: string }>(
        `SELECT contact_id AS contactId FROM contact_list_memberships WHERE list_id = ? AND contact_id IN (${placeholders(contactIds.length)})`,
        input.listId,
        ...contactIds,
      )
      .toArray()
      .map((row) => row.contactId),
  );
  const toRemove = contactIds.filter((contactId) => existing.has(contactId));
  if (toRemove.length === 0) return { listId: input.listId, removed: 0 };

  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `DELETE FROM contact_list_memberships WHERE list_id = ? AND contact_id IN (${placeholders(toRemove.length)})`,
      input.listId,
      ...toRemove,
    );
    writeAudit(storage, {
      action: "contact_list.membership_removed",
      actorUserId: input.actorUserId,
      occurredAt: now,
      requestId: input.requestId,
      summary: { listId: input.listId, removed: toRemove.length },
      targetId: input.listId,
      targetType: "contact_list",
    });
  });
  return { listId: input.listId, removed: toRemove.length };
}
