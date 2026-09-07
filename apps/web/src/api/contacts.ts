import {
  addContactsToListResponseSchema,
  CONTACT_BULK_OPERATION_MAX,
  CONTACT_RESPONSE_MAX,
  contactCommunicationPreferenceSchema,
  contactDetailActivitySchema,
  contactDetailLinkedProfileSchema,
  contactDetailListSchema,
  contactListDeleteResponseSchema,
  contactListMembershipSchema,
  contactListResponseSchema,
  contactListsResponseSchema,
  contactResponseSchema,
  contactsResponseSchema,
  removeContactsFromListResponseSchema,
  type AddContactsToListResponse,
  type Contact,
  type ContactCommunicationPreference,
  type ContactCommunicationStatus,
  type ContactCreateRequest,
  type ContactDetailActivity,
  type ContactDetailLinkedProfile,
  type ContactDetailList,
  type ContactList,
  type ContactListCreateRequest,
  type ContactListMembership,
  type ContactListUpdateRequest,
  type ContactUpdateRequest,
  type RemoveContactsFromListResponse,
} from "@choir/contracts";
import { z } from "zod";

import { AuthApiError, request, requestJson } from "./client";

/**
 * Phase 4 marketing-contacts browser client.
 *
 * Tenancy: every path below is organization-scoped without a client-supplied
 * Organization identifier. The server resolves the Organization from the
 * validated hostname before any storage access, so cross-Organization
 * navigation can never address another Organization's contacts through these
 * helpers (a reused contact or list ID on another hostname resolves to
 * not-found/unauthorized per the existing API policy).
 */

const CONTACTS_LIST_LIMIT = CONTACT_RESPONSE_MAX;
const CONTACTS_LIST_PAGE_CAP = 5;

export interface ContactSearchFilters {
  readonly listId?: string | undefined;
  readonly query?: string | undefined;
  readonly source?: string | undefined;
  readonly status?: ContactCommunicationStatus | undefined;
}

export interface ContactListInput {
  readonly description?: string | null | undefined;
  readonly name: string;
}

/** Preference fields accepted alongside create/update contact bodies. */
export interface ContactPreferenceInput {
  readonly emailStatus?: ContactCommunicationStatus | undefined;
  readonly preferenceSource?: string | null | undefined;
  readonly smsStatus?: ContactCommunicationStatus | undefined;
}

export type ContactCreateInput = ContactCreateRequest & ContactPreferenceInput;
export type ContactUpdateInput = ContactUpdateRequest & ContactPreferenceInput;

/**
 * Additive Phase 4 enrichment. The Worker returns `memberships` and
 * `preferences` alongside the Phase 3 list shape using batched store queries;
 * older parsers ignore the unknown keys, so this stays backward compatible.
 */
const contactsListEnrichmentSchema = z.object({
  memberships: z.array(contactListMembershipSchema).max(CONTACT_RESPONSE_MAX).default([]),
  preferences: z
    .array(contactCommunicationPreferenceSchema)
    .max(CONTACT_RESPONSE_MAX * 2)
    .default([]),
});

const contactsListPageSchema = contactsResponseSchema.and(contactsListEnrichmentSchema);

export type ContactsListPage = z.infer<typeof contactsListPageSchema>;

export interface ContactsListResult {
  readonly contacts: readonly Contact[];
  readonly memberships: readonly ContactListMembership[];
  readonly preferences: readonly ContactCommunicationPreference[];
  readonly truncated?: boolean;
}

/** Additive Phase 4 detail enrichment over the Phase 3 `{contact}` shape. */
const contactDetailEnrichmentSchema = z.object({
  activity: contactDetailActivitySchema.default({ donationCount: 0, ticketPurchaseCount: 0 }),
  lastEmailAt: z.iso.datetime().nullable().default(null),
  linkedProfile: contactDetailLinkedProfileSchema.nullable().default(null),
  listIds: z.array(z.uuid()).default([]),
  lists: z.array(contactDetailListSchema).max(CONTACT_RESPONSE_MAX).default([]),
  preferences: z.array(contactCommunicationPreferenceSchema).max(2).default([]),
});

const contactDetailResponseSchema = contactResponseSchema.and(contactDetailEnrichmentSchema);

export interface ContactDetail {
  readonly activity: ContactDetailActivity;
  readonly contact: Contact;
  readonly lastEmailAt: string | null;
  readonly linkedProfile: ContactDetailLinkedProfile | null;
  readonly listIds: readonly string[];
  readonly lists: readonly ContactDetailList[];
  readonly preferences: readonly ContactCommunicationPreference[];
}

function searchParams(filters: ContactSearchFilters, cursor: string | null): URLSearchParams {
  const params = new URLSearchParams();
  params.set("limit", String(CONTACTS_LIST_LIMIT));
  const query = filters.query?.trim() ?? "";
  if (query) params.set("query", query);
  if (filters.listId) params.set("listId", filters.listId);
  if (filters.source) params.set("source", filters.source);
  if (filters.status) {
    // Email-status filtering targets the email channel specifically; the
    // server matches the (channel, status) preference pair.
    params.set("channel", "email");
    params.set("status", filters.status);
  }
  if (cursor) params.set("cursor", cursor);
  return params;
}

async function fetchContactsPage(
  filters: ContactSearchFilters,
  cursor: string | null,
  signal: AbortSignal | null,
): Promise<ContactsListPage> {
  return requestJson(
    `/api/organization/contacts?${searchParams(filters, cursor).toString()}`,
    contactsListPageSchema,
    { signal },
  );
}

/**
 * Lists every contact matching the filters, following the server cursor.
 * Bounded: each page holds at most CONTACT_RESPONSE_MAX rows and at most
 * CONTACTS_LIST_PAGE_CAP pages are fetched, keeping management UI loads
 * predictable without N+1 detail requests.
 */
export async function listAllOrganizationContacts(
  filters: ContactSearchFilters,
  signal?: AbortSignal,
): Promise<ContactsListResult> {
  const contacts: Contact[] = [];
  const memberships: ContactListMembership[] = [];
  const preferences: ContactCommunicationPreference[] = [];
  let cursor: string | null = null;
  let truncated = false;
  for (let page = 0; page < CONTACTS_LIST_PAGE_CAP; page += 1) {
    const result = await fetchContactsPage(filters, cursor, signal ?? null);
    contacts.push(...result.contacts);
    memberships.push(...result.memberships);
    preferences.push(...result.preferences);
    if (!result.hasMore || result.nextCursor === null) break;
    if (page === CONTACTS_LIST_PAGE_CAP - 1) {
      truncated = true;
    }
    cursor = result.nextCursor;
  }
  return { contacts, memberships, preferences, truncated };
}

export async function getOrganizationContactDetail(
  contactId: string,
  signal?: AbortSignal,
): Promise<ContactDetail> {
  const result = await requestJson(
    `/api/organization/contacts/${encodeURIComponent(contactId)}`,
    contactDetailResponseSchema,
    { signal: signal ?? null },
  );
  return {
    activity: result.activity,
    contact: result.contact,
    lastEmailAt: result.lastEmailAt,
    linkedProfile: result.linkedProfile,
    listIds: result.listIds,
    lists: result.lists,
    preferences: result.preferences,
  };
}

export async function createOrganizationContact(input: ContactCreateInput): Promise<Contact> {
  const result = await requestJson("/api/organization/contacts", contactResponseSchema, {
    body: JSON.stringify(input),
    method: "POST",
  });
  return result.contact;
}

export async function updateOrganizationContact(
  contactId: string,
  input: ContactUpdateInput,
): Promise<Contact> {
  const result = await requestJson(
    `/api/organization/contacts/${encodeURIComponent(contactId)}`,
    contactResponseSchema,
    { body: JSON.stringify(input), method: "PATCH" },
  );
  return result.contact;
}

export async function deleteOrganizationContact(contactId: string): Promise<void> {
  await request(`/api/organization/contacts/${encodeURIComponent(contactId)}`, {
    method: "DELETE",
  });
}

export async function listOrganizationContactLists(
  signal?: AbortSignal,
): Promise<readonly ContactList[]> {
  const result = await requestJson("/api/organization/contact-lists", contactListsResponseSchema, {
    signal: signal ?? null,
  });
  return result.lists;
}

export async function createOrganizationContactList(input: ContactListInput): Promise<ContactList> {
  const body: ContactListCreateRequest = {
    ...(input.description === undefined ? {} : { description: input.description }),
    name: input.name,
  };
  const result = await requestJson("/api/organization/contact-lists", contactListResponseSchema, {
    body: JSON.stringify(body),
    method: "POST",
  });
  return result.list;
}

export async function updateOrganizationContactList(
  listId: string,
  input: {
    readonly description?: string | null | undefined;
    readonly name?: string | undefined;
  },
): Promise<ContactList> {
  const body: ContactListUpdateRequest = {
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.name === undefined ? {} : { name: input.name }),
  };
  const result = await requestJson(
    `/api/organization/contact-lists/${encodeURIComponent(listId)}`,
    contactListResponseSchema,
    { body: JSON.stringify(body), method: "PATCH" },
  );
  return result.list;
}

export async function deleteOrganizationContactList(listId: string): Promise<void> {
  const response = await request(`/api/organization/contact-lists/${encodeURIComponent(listId)}`, {
    method: "DELETE",
  });
  contactListDeleteResponseSchema.parse(await response.json());
}

function membershipPath(listId: string): string {
  return `/api/organization/contact-lists/${encodeURIComponent(listId)}/members`;
}

export async function addContactsToContactList(
  listId: string,
  contactIds: readonly string[],
): Promise<AddContactsToListResponse> {
  return requestJson(membershipPath(listId), addContactsToListResponseSchema, {
    body: JSON.stringify({ contactIds: [...contactIds] }),
    method: "POST",
  });
}

export async function removeContactsFromContactList(
  listId: string,
  contactIds: readonly string[],
): Promise<RemoveContactsFromListResponse> {
  return requestJson(membershipPath(listId), removeContactsFromListResponseSchema, {
    body: JSON.stringify({ contactIds: [...contactIds] }),
    method: "DELETE",
  });
}

export const CONTACTS_BULK_OPERATION_MAX = CONTACT_BULK_OPERATION_MAX;

/** Maps stable typed API error codes to actionable contact UI messages. */
export function contactErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AuthApiError) {
    switch (error.code) {
      case "contact_duplicate_email":
        return "A contact with this email address already exists in this Organization.";
      case "contact_not_found":
        return "The contact was not found in this Organization. It may have been deleted.";
      case "contact_list_not_found":
        return "The contact list was not found in this Organization. It may have been deleted.";
      case "contact_profile_not_found":
        return "The linked Organization Profile was not found in this Organization.";
      case "contact_missing_identity":
        return "A contact needs a name, email, phone, or linked Organization Profile.";
      case "validation_failed":
        return (
          error.message || "Some contact details were not valid. Review the form and try again."
        );
      case "forbidden":
        return "Only Organization Owners and Administrators can manage contacts.";
      default:
        return error.message || fallback;
    }
  }
  return fallback;
}
