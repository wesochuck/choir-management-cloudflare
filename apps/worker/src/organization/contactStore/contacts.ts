import {
  contactCreateRequestSchema,
  type Contact,
  type ContactCommunicationPreference,
  type ContactCommunicationStatus,
} from "@choir/contracts";
import { hasAcceptableContactIdentity, mergeContactCommunicationStatus } from "@choir/domain";

import {
  ContactStoreError,
  type ContactStoreStorage,
  type CreateContactInput,
  type UpdateContactInput,
} from "./contracts";
import {
  actorUserIdSchema,
  assertOrganization,
  contactStatusSchema,
  emptyToNull,
  findContactIdByNormalizedEmail,
  isUniqueViolation,
  normalizeEmailForStorage,
  normalizePhoneForStorage,
  organizationIdSchema,
  parseContactRow,
  profileExists,
  readContactRow,
  readPreferences,
  requireUuid,
  uuidSchema,
  writeAudit,
  type ContactRow,
} from "./shared";

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

export interface NextContactFields {
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

export interface MergedContactStatuses {
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
    storage.sql.exec("DELETE FROM contact_list_memberships WHERE contact_id = ?", input.contactId);
    storage.sql.exec(
      "DELETE FROM contact_communication_preferences WHERE contact_id = ?",
      input.contactId,
    );
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
