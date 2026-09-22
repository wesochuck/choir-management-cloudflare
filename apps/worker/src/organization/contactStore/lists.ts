import {
  CONTACT_BULK_OPERATION_MAX,
  contactListCreateRequestSchema,
  contactListUpdateRequestSchema,
  type ContactList,
} from "@choir/contracts";

import {
  ContactStoreError,
  type BulkMembershipInput,
  type ContactStoreStorage,
  type CreateContactListInput,
  type UpdateContactListInput,
} from "./contracts";
import {
  actorUserIdSchema,
  assertOrganization,
  organizationIdSchema,
  parseListRow,
  placeholders,
  requireUuid,
  writeAudit,
  type ContactListRow,
} from "./shared";

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
  return [...new Set(input.contactIds)];
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
