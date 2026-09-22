/**
 * Backward-compatible facade for contact persistence.
 *
 * Implementation is modularized under `./contactStore/`:
 * - contracts.ts: types, interfaces, error definitions
 * - shared.ts: schemas, row parsers, audit logging, validation helpers
 * - contacts.ts: contact mutations (create, update, delete)
 * - queries.ts: contact queries (get, list, detail enrichment)
 * - lists.ts: list CRUD and bulk membership operations
 */

export {
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
  type BulkMembershipInput,
  type ContactDetailActivity,
  type ContactDetailLinkedProfile,
  type ContactDetailList,
  type ContactMutationContext,
  type ContactStoreErrorCode,
  type ContactStoreStorage,
  type CreateContactInput,
  type CreateContactListInput,
  type ListContactsInput,
  type UpdateContactInput,
  type UpdateContactListInput,
} from "./contactStore/index";
