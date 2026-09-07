import { describe, expect, it } from "vitest";

import { relativeIsoDate } from "@choir/testkit";
import {
  addContactsToListRequestSchema,
  bulkAddContactListMembershipRequestSchema,
  contactCommunicationPreferenceSchema,
  contactCreateRequestSchema,
  contactDeleteArchiveRequestSchema,
  contactDetailActivitySchema,
  contactDetailLinkedProfileSchema,
  contactDetailListSchema,
  contactDetailResponseSchema,
  contactExportRequestSchema,
  contactExportResponseSchema,
  contactListCreateRequestSchema,
  contactListDeleteRequestSchema,
  contactListSchema,
  contactListUpdateRequestSchema,
  contactSchema,
  contactUpdateRequestSchema,
  contactsResponseSchema,
  removeContactsFromListRequestSchema,
} from "@choir/contracts";

const contactId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const listId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const createdAt = relativeIsoDate({ days: -1 });
const updatedAt = relativeIsoDate();

const validContact = {
  createdAt,
  displayName: "Jane Smith",
  email: "  Jane@Example.COM  ",
  firstName: "Jane",
  id: contactId,
  lastName: "Smith",
  normalizedEmail: "jane@example.com",
  normalizedPhone: "+15551234567",
  phone: "(555) 123-4567",
  profileId,
  source: "manual",
  updatedAt,
};

function uuidFor(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`;
}

describe("Contact contracts", () => {
  it("parses a Contact and preserves the entered email display value", () => {
    expect(contactSchema.parse(validContact)).toMatchObject({
      displayName: "Jane Smith",
      email: "  Jane@Example.COM  ",
      normalizedEmail: "jane@example.com",
    });
  });

  it("accepts a display-name-only Contact without requiring first and last names", () => {
    expect(
      contactSchema.safeParse({
        createdAt,
        displayName: "Choir Friends",
        id: contactId,
        updatedAt,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed Contacts and Contacts with no useful identity", () => {
    expect(contactSchema.safeParse({ ...validContact, id: "not-a-uuid" }).success).toBe(false);
    expect(
      contactSchema.safeParse({
        createdAt,
        displayName: null,
        email: null,
        firstName: null,
        id: contactId,
        lastName: null,
        normalizedEmail: null,
        normalizedPhone: null,
        phone: null,
        profileId: null,
        source: null,
        updatedAt,
      }).success,
    ).toBe(false);
    expect(contactSchema.safeParse({ ...validContact, email: "not-an-email" }).success).toBe(false);
    expect(
      contactSchema.safeParse({ ...validContact, normalizedPhone: "+0123456789" }).success,
    ).toBe(false);
  });

  it("accepts null, undefined, and omitted optional Contact fields", () => {
    const optionalFields = [
      "displayName",
      "email",
      "firstName",
      "lastName",
      "normalizedEmail",
      "normalizedPhone",
      "phone",
      "profileId",
      "source",
    ] as const;
    for (const field of optionalFields) {
      for (const variant of ["null", "undefined", "omitted"] as const) {
        const candidate: Record<string, unknown> =
          variant === "omitted"
            ? Object.fromEntries(Object.entries(validContact).filter(([key]) => key !== field))
            : { ...validContact, [field]: variant === "null" ? null : undefined };
        expect(contactSchema.safeParse(candidate).success, `${field} ${variant}`).toBe(true);
      }
    }
  });

  it("requires acceptable identity for creation but permits nullable update fields", () => {
    expect(
      contactCreateRequestSchema.safeParse({ displayName: "Only a display name" }).success,
    ).toBe(true);
    expect(contactCreateRequestSchema.safeParse({ email: "jane@example.com" }).success).toBe(true);
    expect(contactCreateRequestSchema.safeParse({ phone: "+15551234567" }).success).toBe(true);
    expect(contactCreateRequestSchema.safeParse({}).success).toBe(false);
    expect(contactUpdateRequestSchema.safeParse({ email: null }).success).toBe(true);
    expect(contactUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it("validates channel-specific communication statuses", () => {
    for (const channel of ["email", "sms"] as const) {
      for (const status of ["unknown", "subscribed", "unsubscribed"] as const) {
        expect(
          contactCommunicationPreferenceSchema.safeParse({
            channel,
            contactId,
            observedAt: updatedAt,
            status,
          }).success,
        ).toBe(true);
      }
    }
    expect(
      contactCommunicationPreferenceSchema.safeParse({
        channel: "push",
        contactId,
        observedAt: updatedAt,
        status: "subscribed",
      }).success,
    ).toBe(false);
    expect(
      contactCommunicationPreferenceSchema.safeParse({
        channel: "email",
        contactId,
        observedAt: updatedAt,
        status: "suppressed",
      }).success,
    ).toBe(false);
  });

  it("accepts the optional preference source as null, undefined, or omitted", () => {
    for (const variant of ["null", "undefined", "omitted"] as const) {
      const preference: Record<string, unknown> = {
        channel: "email",
        contactId,
        observedAt: updatedAt,
        status: "unknown",
      };
      if (variant !== "omitted") preference.source = variant === "null" ? null : undefined;
      expect(contactCommunicationPreferenceSchema.safeParse(preference).success, variant).toBe(
        true,
      );
    }
  });

  it("validates list names and optional list descriptions", () => {
    expect(contactListCreateRequestSchema.safeParse({ name: "Newsletter" }).success).toBe(true);
    expect(contactListCreateRequestSchema.safeParse({ name: "" }).success).toBe(false);
    expect(contactListCreateRequestSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(contactListCreateRequestSchema.safeParse({ name: "n".repeat(201) }).success).toBe(false);
    expect(contactListUpdateRequestSchema.safeParse({ description: null }).success).toBe(true);
    expect(contactListUpdateRequestSchema.safeParse({}).success).toBe(false);

    for (const variant of ["null", "undefined", "omitted"] as const) {
      const list: Record<string, unknown> = {
        createdAt,
        id: listId,
        name: "Newsletter",
        updatedAt,
      };
      if (variant !== "omitted") list.description = variant === "null" ? null : undefined;
      expect(contactListSchema.safeParse(list).success, variant).toBe(true);
    }
  });

  it("bounds list membership and export selections at 500 items", () => {
    const contactIds = Array.from({ length: 500 }, (_, index) => uuidFor(index));
    const tooManyContactIds = [...contactIds, uuidFor(500)];
    expect(addContactsToListRequestSchema.safeParse({ contactIds, listId }).success).toBe(true);
    expect(removeContactsFromListRequestSchema.safeParse({ contactIds, listId }).success).toBe(
      true,
    );
    expect(
      addContactsToListRequestSchema.safeParse({ contactIds: tooManyContactIds, listId }).success,
    ).toBe(false);
    expect(contactExportRequestSchema.safeParse({ contactIds }).success).toBe(true);
    expect(contactExportRequestSchema.safeParse({ contactIds: tooManyContactIds }).success).toBe(
      false,
    );

    const memberships = contactIds.map((id, index) => ({
      contactId: id,
      listId: uuidFor(index + 600),
    }));
    expect(bulkAddContactListMembershipRequestSchema.safeParse({ memberships }).success).toBe(true);
    expect(
      bulkAddContactListMembershipRequestSchema.safeParse({
        memberships: [...memberships, { contactId: uuidFor(501), listId }],
      }).success,
    ).toBe(false);
  });

  it("parses the unified contact detail projection without touching source records", () => {
    const parsed = contactDetailResponseSchema.parse({
      activity: { donationCount: 2, ticketPurchaseCount: 4 },
      contact: validContact,
      lastEmailAt: updatedAt,
      linkedProfile: { displayName: "Jane Smith", id: profileId },
      listIds: [listId],
      lists: [{ id: listId, name: "Newsletter" }],
      preferences: [{ channel: "email", contactId, observedAt: updatedAt, status: "subscribed" }],
      requestId,
    });
    expect(parsed.activity).toEqual({ donationCount: 2, ticketPurchaseCount: 4 });
    expect(parsed.linkedProfile).toEqual({ displayName: "Jane Smith", id: profileId });
    expect(parsed.lists).toEqual([{ id: listId, name: "Newsletter" }]);
    // Empty relationships stay explicit rather than omitted.
    const empty = contactDetailResponseSchema.parse({ contact: validContact, requestId });
    expect(empty.activity).toEqual({ donationCount: 0, ticketPurchaseCount: 0 });
    expect(empty.lastEmailAt).toBeNull();
    expect(empty.linkedProfile).toBeNull();
    expect(empty.listIds).toEqual([]);
    expect(empty.lists).toEqual([]);
    expect(empty.preferences).toEqual([]);
  });

  it("rejects malformed contact detail projections", () => {
    expect(
      contactDetailResponseSchema.safeParse({
        activity: { donationCount: -1, ticketPurchaseCount: 0 },
        contact: validContact,
        requestId,
      }).success,
    ).toBe(false);
    expect(
      contactDetailActivitySchema.safeParse({ donationCount: 1.5, ticketPurchaseCount: 0 }).success,
    ).toBe(false);
    expect(
      contactDetailLinkedProfileSchema.safeParse({ displayName: "Jane", id: "bad" }).success,
    ).toBe(false);
    expect(contactDetailListSchema.safeParse({ id: listId, name: "" }).success).toBe(false);
    expect(
      contactDetailResponseSchema.safeParse({
        contact: validContact,
        lastEmailAt: "not-a-date",
        requestId,
      }).success,
    ).toBe(false);
    expect(contactDetailResponseSchema.safeParse({ contact: validContact }).success).toBe(false);
  });

  it("exposes contact request and response schemas through the public package barrel", () => {
    expect(contactDeleteArchiveRequestSchema.safeParse({ contactId }).success).toBe(true);
    expect(contactListDeleteRequestSchema.safeParse({ listId }).success).toBe(true);
    expect(
      contactExportResponseSchema.safeParse({
        csv: "displayName,email\nJane Smith,jane@example.com\n",
        requestId,
        rowCount: 1,
      }).success,
    ).toBe(true);
    expect(contactsResponseSchema.safeParse({ contacts: [validContact], requestId }).success).toBe(
      true,
    );
  });
});
