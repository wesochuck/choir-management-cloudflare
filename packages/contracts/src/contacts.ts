import { z } from "zod";

import { requestIdSchema } from "./primitives";

/** Maximum number of IDs or membership pairs accepted by one bulk request. */
export const CONTACT_BULK_OPERATION_MAX = 500;

/** Maximum number of Contacts returned in one list/search response. */
export const CONTACT_RESPONSE_MAX = 500;

/** Maximum number of Contacts selected by an export request. */
export const CONTACT_EXPORT_SELECTION_MAX = 500;

export const contactCommunicationChannelSchema = z.enum(["email", "sms"]);
export const contactCommunicationStatusSchema = z.enum(["unknown", "subscribed", "unsubscribed"]);

const contactNameFieldSchema = z.string().max(200).nullable().optional();
const contactRequestNameFieldSchema = z.string().trim().max(200).nullable().optional();

/**
 * An entered email is retained as display data. Validation trims only for the
 * purpose of checking the address and does not transform the stored value.
 */
const contactEmailFieldSchema = z
  .string()
  .max(320)
  .refine(
    (value) => value.trim().length === 0 || z.email().safeParse(value.trim()).success,
    "A valid email address is required.",
  )
  .nullable()
  .optional();

const contactRequestEmailFieldSchema = z
  .string()
  .max(320)
  .refine(
    (value) => value.trim().length === 0 || z.email().safeParse(value.trim()).success,
    "A valid email address is required.",
  )
  .nullable()
  .optional();

const contactNormalizedEmailFieldSchema = z
  .string()
  .max(320)
  .refine(
    (value) => value.length === 0 || z.email().safeParse(value).success,
    "A valid normalized email address is required.",
  )
  .refine(
    (value) => value.length === 0 || value === value.trim().toLowerCase(),
    "A normalized email address must be trimmed and lowercase.",
  )
  .nullable()
  .optional();

const contactPhoneFieldSchema = z.string().max(50).nullable().optional();
const contactRequestPhoneFieldSchema = z.string().trim().max(50).nullable().optional();

const contactNormalizedPhoneFieldSchema = z
  .string()
  .max(16)
  .refine(
    (value) => value.length === 0 || /^\+[1-9]\d{1,14}$/.test(value),
    "A normalized phone number must use E.164 format.",
  )
  .nullable()
  .optional();

const contactSourceFieldSchema = z.string().max(200).nullable().optional();
const contactRequestSourceFieldSchema = z.string().trim().max(200).nullable().optional();

interface ContactIdentityFields {
  readonly displayName?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly normalizedEmail?: string | null | undefined;
  readonly normalizedPhone?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly profileId?: string | null | undefined;
}

function hasContactIdentityValue(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim().length > 0;
}

function requireContactIdentity(value: ContactIdentityFields, context: z.RefinementCtx): void {
  const hasIdentity = [
    value.displayName,
    value.email,
    value.firstName,
    value.lastName,
    value.normalizedEmail,
    value.normalizedPhone,
    value.phone,
    value.profileId,
  ].some((candidate) => hasContactIdentityValue(candidate));

  if (!hasIdentity) {
    context.addIssue({
      code: "custom",
      message: "A contact requires a name, contact method, or linked profile.",
      path: ["displayName"],
    });
  }
}

const contactRecordFieldsSchema = z.object({
  createdAt: z.iso.datetime(),
  displayName: contactNameFieldSchema,
  email: contactEmailFieldSchema,
  firstName: contactNameFieldSchema,
  id: z.uuid(),
  lastName: contactNameFieldSchema,
  normalizedEmail: contactNormalizedEmailFieldSchema,
  normalizedPhone: contactNormalizedPhoneFieldSchema,
  phone: contactPhoneFieldSchema,
  profileId: z.uuid().nullable().optional(),
  source: contactSourceFieldSchema,
  updatedAt: z.iso.datetime(),
});

export const contactSchema = contactRecordFieldsSchema.superRefine(requireContactIdentity);

const contactMutationFieldsSchema = z.object({
  displayName: contactRequestNameFieldSchema,
  email: contactRequestEmailFieldSchema,
  firstName: contactRequestNameFieldSchema,
  lastName: contactRequestNameFieldSchema,
  normalizedEmail: contactNormalizedEmailFieldSchema,
  normalizedPhone: contactNormalizedPhoneFieldSchema,
  phone: contactRequestPhoneFieldSchema,
  profileId: z.uuid().nullable().optional(),
  source: contactRequestSourceFieldSchema,
});

export const contactCreateRequestSchema =
  contactMutationFieldsSchema.superRefine(requireContactIdentity);

export const contactUpdateRequestSchema = contactMutationFieldsSchema.superRefine(
  (value, context) => {
    if (!Object.values(value).some((candidate) => candidate !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "At least one Contact field must be updated.",
      });
    }
  },
);

export const contactDeleteArchiveRequestSchema = z.object({
  action: z.enum(["archive", "delete"]).default("archive"),
  contactId: z.uuid(),
});

export const contactDeleteArchiveResponseSchema = z.object({
  contactId: z.uuid(),
  requestId: requestIdSchema,
  status: z.enum(["archived", "deleted"]),
});

export const contactResponseSchema = z.object({
  contact: contactSchema,
  requestId: requestIdSchema,
});

export const contactsResponseSchema = z.object({
  contacts: z.array(contactSchema).max(CONTACT_RESPONSE_MAX),
  hasMore: z.boolean().default(false),
  nextCursor: z.string().trim().min(1).max(256).nullable().default(null),
  requestId: requestIdSchema,
});

export const contactSearchRequestSchema = z.object({
  channel: contactCommunicationChannelSchema.optional(),
  cursor: z.string().trim().min(1).max(256).nullable().optional(),
  limit: z.number().int().min(1).max(CONTACT_RESPONSE_MAX).default(100),
  listId: z.uuid().nullable().optional(),
  query: z.string().trim().max(200).default(""),
  source: z.string().trim().max(200).nullable().optional(),
  status: contactCommunicationStatusSchema.optional(),
});

export const contactCommunicationPreferenceSchema = z.object({
  channel: contactCommunicationChannelSchema,
  contactId: z.uuid(),
  observedAt: z.iso.datetime(),
  source: contactSourceFieldSchema,
  status: contactCommunicationStatusSchema,
});

export const contactCommunicationPreferencesResponseSchema = z.object({
  contactId: z.uuid(),
  preferences: z.array(contactCommunicationPreferenceSchema).max(2),
  requestId: requestIdSchema,
});

const contactListDescriptionFieldSchema = z.string().max(2_000).nullable().optional();
const contactListRequestDescriptionFieldSchema = z.string().trim().max(2_000).nullable().optional();
const contactListNameFieldSchema = z.string().trim().min(1).max(200);

export const contactListSchema = z.object({
  createdAt: z.iso.datetime(),
  description: contactListDescriptionFieldSchema,
  id: z.uuid(),
  name: contactListNameFieldSchema,
  updatedAt: z.iso.datetime(),
});

export const contactListMembershipSchema = z.object({
  contactId: z.uuid(),
  createdAt: z.iso.datetime(),
  listId: z.uuid(),
});

export const contactListCreateRequestSchema = z.object({
  description: contactListRequestDescriptionFieldSchema,
  name: contactListNameFieldSchema,
});

const contactListUpdateFieldsSchema = z.object({
  description: contactListRequestDescriptionFieldSchema,
  name: contactListNameFieldSchema.optional(),
});

export const contactListUpdateRequestSchema = contactListUpdateFieldsSchema.superRefine(
  (value, context) => {
    if (!Object.values(value).some((candidate) => candidate !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "At least one Contact List field must be updated.",
      });
    }
  },
);

export const contactListDeleteRequestSchema = z.object({
  listId: z.uuid(),
});

export const contactListResponseSchema = z.object({
  list: contactListSchema,
  requestId: requestIdSchema,
});

export const contactListsResponseSchema = z.object({
  hasMore: z.boolean().default(false),
  lists: z.array(contactListSchema).max(CONTACT_RESPONSE_MAX),
  nextCursor: z.string().trim().min(1).max(256).nullable().default(null),
  requestId: requestIdSchema,
});

export const contactListDeleteResponseSchema = z.object({
  listId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("deleted"),
});

/**
 * Phase 10 unified Contact detail view.
 *
 * The Contact stays the relationship/communication identity; these shapes
 * only project related records. Commerce activity is counts (transaction
 * snapshots stay in their own tables), the linked profile is an identity
 * reference (roster data stays in `profiles`), and the last email is a
 * timestamp (delivery rows stay in `communication_deliveries`).
 */
export const contactDetailActivitySchema = z.object({
  donationCount: z.number().int().nonnegative(),
  ticketPurchaseCount: z.number().int().nonnegative(),
});

export const contactDetailLinkedProfileSchema = z.object({
  displayName: z.string().max(200),
  id: z.uuid(),
});

export const contactDetailListSchema = z.object({
  id: z.uuid(),
  name: contactListNameFieldSchema,
});

export const contactDetailResponseSchema = z.object({
  activity: contactDetailActivitySchema.default({ donationCount: 0, ticketPurchaseCount: 0 }),
  contact: contactSchema,
  lastEmailAt: z.iso.datetime().nullable().default(null),
  linkedProfile: contactDetailLinkedProfileSchema.nullable().default(null),
  listIds: z.array(z.uuid()).default([]),
  lists: z.array(contactDetailListSchema).max(CONTACT_RESPONSE_MAX).default([]),
  preferences: z.array(contactCommunicationPreferenceSchema).max(2).default([]),
  requestId: requestIdSchema,
});

const contactIdsForBulkOperationSchema = z
  .array(z.uuid())
  .min(1)
  .max(CONTACT_BULK_OPERATION_MAX)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Contact IDs must be unique." });
    }
  });

const contactIdsForExportSchema = z
  .array(z.uuid())
  .max(CONTACT_EXPORT_SELECTION_MAX)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Contact IDs must be unique." });
    }
  });

export const addContactsToListRequestSchema = z.object({
  contactIds: contactIdsForBulkOperationSchema,
  listId: z.uuid(),
});

export const removeContactsFromListRequestSchema = z.object({
  contactIds: contactIdsForBulkOperationSchema,
  listId: z.uuid(),
});

export const addContactsToListResponseSchema = z.object({
  added: z.number().int().nonnegative().max(CONTACT_BULK_OPERATION_MAX),
  listId: z.uuid(),
  requestId: requestIdSchema,
});

export const removeContactsFromListResponseSchema = z.object({
  listId: z.uuid(),
  removed: z.number().int().nonnegative().max(CONTACT_BULK_OPERATION_MAX),
  requestId: requestIdSchema,
});

const contactListMembershipInputSchema = z.object({
  contactId: z.uuid(),
  listId: z.uuid(),
});

const contactListMembershipInputsSchema = z
  .array(contactListMembershipInputSchema)
  .min(1)
  .max(CONTACT_BULK_OPERATION_MAX)
  .superRefine((memberships, context) => {
    const keys = memberships.map(({ contactId, listId }) => `${contactId}\0${listId}`);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "List memberships must be unique." });
    }
  });

export const bulkAddContactListMembershipRequestSchema = z.object({
  memberships: contactListMembershipInputsSchema,
});

export const bulkRemoveContactListMembershipRequestSchema = z.object({
  memberships: contactListMembershipInputsSchema,
});

export const bulkAddContactListMembershipResponseSchema = z.object({
  added: z.number().int().nonnegative().max(CONTACT_BULK_OPERATION_MAX),
  requestId: requestIdSchema,
});

export const bulkRemoveContactListMembershipResponseSchema = z.object({
  removed: z.number().int().nonnegative().max(CONTACT_BULK_OPERATION_MAX),
  requestId: requestIdSchema,
});

export const contactListMembershipsResponseSchema = z.object({
  memberships: z.array(contactListMembershipSchema).max(CONTACT_RESPONSE_MAX),
  requestId: requestIdSchema,
});

export const contactExportRequestSchema = z.object({
  contactIds: contactIdsForExportSchema.default([]),
  listId: z.uuid().nullable().default(null),
  query: z.string().trim().max(200).default(""),
});

export const contactExportResponseSchema = z.object({
  csv: z.string().max(20_000_000),
  downloadName: z.string().trim().min(1).max(255).default("contacts.csv"),
  requestId: requestIdSchema,
  rowCount: z.number().int().nonnegative().max(CONTACT_RESPONSE_MAX),
});

export type ContactCommunicationChannel = z.infer<typeof contactCommunicationChannelSchema>;
export type ContactCommunicationStatus = z.infer<typeof contactCommunicationStatusSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type ContactDetailActivity = z.infer<typeof contactDetailActivitySchema>;
export type ContactDetailLinkedProfile = z.infer<typeof contactDetailLinkedProfileSchema>;
export type ContactDetailList = z.infer<typeof contactDetailListSchema>;
export type ContactDetailResponse = z.infer<typeof contactDetailResponseSchema>;
export type ContactCommunicationPreference = z.infer<typeof contactCommunicationPreferenceSchema>;
export type ContactCommunicationPreferencesResponse = z.infer<
  typeof contactCommunicationPreferencesResponseSchema
>;
export type ContactCreateRequest = z.infer<typeof contactCreateRequestSchema>;
export type ContactUpdateRequest = z.infer<typeof contactUpdateRequestSchema>;
export type ContactDeleteArchiveRequest = z.infer<typeof contactDeleteArchiveRequestSchema>;
export type ContactDeleteArchiveResponse = z.infer<typeof contactDeleteArchiveResponseSchema>;
export type ContactResponse = z.infer<typeof contactResponseSchema>;
export type ContactsResponse = z.infer<typeof contactsResponseSchema>;
export type ContactSearchRequest = z.infer<typeof contactSearchRequestSchema>;
export type ContactList = z.infer<typeof contactListSchema>;
export type ContactListMembership = z.infer<typeof contactListMembershipSchema>;
export type ContactListCreateRequest = z.infer<typeof contactListCreateRequestSchema>;
export type ContactListUpdateRequest = z.infer<typeof contactListUpdateRequestSchema>;
export type ContactListDeleteRequest = z.infer<typeof contactListDeleteRequestSchema>;
export type ContactListResponse = z.infer<typeof contactListResponseSchema>;
export type ContactListsResponse = z.infer<typeof contactListsResponseSchema>;
export type ContactListDeleteResponse = z.infer<typeof contactListDeleteResponseSchema>;
export type AddContactsToListRequest = z.infer<typeof addContactsToListRequestSchema>;
export type RemoveContactsFromListRequest = z.infer<typeof removeContactsFromListRequestSchema>;
export type AddContactsToListResponse = z.infer<typeof addContactsToListResponseSchema>;
export type RemoveContactsFromListResponse = z.infer<typeof removeContactsFromListResponseSchema>;
export type BulkAddContactListMembershipRequest = z.infer<
  typeof bulkAddContactListMembershipRequestSchema
>;
export type BulkRemoveContactListMembershipRequest = z.infer<
  typeof bulkRemoveContactListMembershipRequestSchema
>;
export type BulkAddContactListMembershipResponse = z.infer<
  typeof bulkAddContactListMembershipResponseSchema
>;
export type BulkRemoveContactListMembershipResponse = z.infer<
  typeof bulkRemoveContactListMembershipResponseSchema
>;
export type ContactListMembershipsResponse = z.infer<typeof contactListMembershipsResponseSchema>;
export type ContactExportRequest = z.infer<typeof contactExportRequestSchema>;
export type ContactExportResponse = z.infer<typeof contactExportResponseSchema>;

export {
  addContactsToListRequestSchema as contactListAddMembersRequestSchema,
  addContactsToListResponseSchema as contactListAddMembersResponseSchema,
  bulkAddContactListMembershipRequestSchema as bulkAddMembershipRequestSchema,
  bulkAddContactListMembershipResponseSchema as bulkAddMembershipResponseSchema,
  bulkRemoveContactListMembershipRequestSchema as bulkRemoveMembershipRequestSchema,
  bulkRemoveContactListMembershipResponseSchema as bulkRemoveMembershipResponseSchema,
  contactCommunicationChannelSchema as contactChannelSchema,
  contactCommunicationStatusSchema as contactStatusSchema,
  contactCreateRequestSchema as createContactRequestSchema,
  contactDeleteArchiveRequestSchema as deleteArchiveContactRequestSchema,
  contactDeleteArchiveResponseSchema as deleteArchiveContactResponseSchema,
  contactDeleteArchiveRequestSchema as deleteContactRequestSchema,
  contactExportRequestSchema as exportContactsToCsvRequestSchema,
  contactExportResponseSchema as exportContactsToCsvResponseSchema,
  contactListCreateRequestSchema as createContactListRequestSchema,
  contactListDeleteRequestSchema as deleteContactListRequestSchema,
  contactListDeleteResponseSchema as deleteContactListResponseSchema,
  contactListUpdateRequestSchema as updateContactListRequestSchema,
  contactSearchRequestSchema as listContactsRequestSchema,
  contactSearchRequestSchema as searchContactsRequestSchema,
  contactsResponseSchema as contactSearchResponseSchema,
  contactsResponseSchema as listContactsResponseSchema,
  contactDeleteArchiveResponseSchema as archiveContactResponseSchema,
  removeContactsFromListRequestSchema as contactListRemoveMembersRequestSchema,
  removeContactsFromListResponseSchema as contactListRemoveMembersResponseSchema,
  removeContactsFromListRequestSchema as removeContactFromListRequestSchema,
};

export type {
  AddContactsToListRequest as ContactListAddMembersRequest,
  AddContactsToListResponse as ContactListAddMembersResponse,
  BulkAddContactListMembershipRequest as BulkAddMembershipRequest,
  BulkAddContactListMembershipResponse as BulkAddMembershipResponse,
  BulkRemoveContactListMembershipRequest as BulkRemoveMembershipRequest,
  BulkRemoveContactListMembershipResponse as BulkRemoveMembershipResponse,
  Contact as OrganizationContact,
  ContactCommunicationChannel as ContactChannel,
  ContactCommunicationPreference as OrganizationContactCommunicationPreference,
  ContactCommunicationStatus as ContactStatus,
  ContactCreateRequest as CreateContactRequest,
  ContactDeleteArchiveRequest as DeleteArchiveContactRequest,
  ContactDeleteArchiveResponse as DeleteArchiveContactResponse,
  ContactExportRequest as ExportContactsToCsvRequest,
  ContactExportResponse as ExportContactsToCsvResponse,
  ContactList as OrganizationContactList,
  ContactListCreateRequest as CreateContactListRequest,
  ContactListDeleteRequest as DeleteContactListRequest,
  ContactListDeleteResponse as DeleteContactListResponse,
  ContactListMembership as OrganizationContactListMembership,
  ContactListUpdateRequest as UpdateContactListRequest,
  ContactSearchRequest as ListContactsRequest,
  ContactSearchRequest as SearchContactsRequest,
  ContactsResponse as ContactSearchResponse,
  ContactsResponse as ListContactsResponse,
  ContactUpdateRequest as UpdateContactRequest,
  RemoveContactsFromListRequest as ContactListRemoveMembersRequest,
  RemoveContactsFromListResponse as ContactListRemoveMembersResponse,
};
