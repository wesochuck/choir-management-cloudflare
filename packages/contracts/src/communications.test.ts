import { describe, expect, it } from "vitest";

import {
  COMMUNICATION_AUDIENCE_CONTACT_IDS_MAX,
  COMMUNICATION_AUDIENCE_CONTACT_LISTS_MAX,
  communicationAudienceRequestSchema,
  communicationDraftRequestSchema,
  communicationMessageSchema,
  communicationRecipientSubjectFromLegacy,
  communicationRecipientSubjectId,
  communicationRecipientSubjectSchema,
} from "./communications";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const PURCHASE_ID = "33333333-3333-4333-8333-333333333333";
const DONATION_ID = "44444444-4444-4444-8444-444444444444";
const LIST_NEWSLETTER = "55555555-5555-4555-8555-555555555555";
const LIST_AUDIENCE = "66666666-6666-4666-8666-666666666666";

function uuidFor(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`;
}

describe("Communication audience contracts", () => {
  it("parses a Contacts audience with lists, IDs, and source/status filters", () => {
    expect(
      communicationAudienceRequestSchema.parse({
        contactEmailStatus: "subscribed",
        contactIds: [CONTACT_ID],
        contactListIds: [LIST_NEWSLETTER, LIST_AUDIENCE],
        contactSmsStatus: null,
        contactSource: "2026 import",
        targetAudiences: ["Members", "Contacts", "Ticket Buyers", "Donors"],
      }),
    ).toMatchObject({
      contactEmailStatus: "subscribed",
      contactIds: [CONTACT_ID],
      contactListIds: [LIST_NEWSLETTER, LIST_AUDIENCE],
      contactSource: "2026 import",
      targetAudiences: ["Members", "Contacts", "Ticket Buyers", "Donors"],
    });
  });

  it("defaults Contact selection fields so historical audiences still parse", () => {
    // Pre-Contacts scheduled messages and history rows carry none of the new
    // keys; expand/contract requires them to parse with safe defaults.
    expect(
      communicationAudienceRequestSchema.parse({
        eventId: null,
        globalStatuses: ["Active"],
        profileIds: [],
        rsvp: "All",
        targetAudiences: ["Members"],
        voiceParts: [],
      }),
    ).toMatchObject({
      contactEmailStatus: null,
      contactIds: [],
      contactListIds: [],
      contactSmsStatus: null,
      contactSource: null,
      targetAudiences: ["Members"],
    });
    expect(communicationAudienceRequestSchema.parse({})).toMatchObject({
      contactIds: [],
      contactListIds: [],
      targetAudiences: ["Members"],
      ticketBuyerMode: "marketing",
    });
  });

  it("defaults old ticket-buyer audiences to marketing and validates service combinations", () => {
    expect(
      communicationAudienceRequestSchema.parse({ targetAudiences: ["Ticket Buyers"] })
        .ticketBuyerMode,
    ).toBe("marketing");
    const serviceAudience = {
      eventId: "77777777-7777-4777-8777-777777777777",
      targetAudiences: ["Ticket Buyers"],
      ticketBuyerMode: "ticket_service",
    };
    expect(communicationAudienceRequestSchema.safeParse(serviceAudience).success).toBe(true);
    expect(
      communicationAudienceRequestSchema.safeParse({
        ...serviceAudience,
        eventId: null,
      }).success,
    ).toBe(false);
    expect(
      communicationAudienceRequestSchema.safeParse({
        ...serviceAudience,
        targetAudiences: ["Ticket Buyers", "Contacts"],
      }).success,
    ).toBe(false);
    expect(
      communicationDraftRequestSchema.safeParse({
        audience: serviceAudience,
        channel: "Both",
        contentMarkdown: "Notice",
        subject: "Performance update",
      }).success,
    ).toBe(false);
  });

  it("parses historical message audiences and reach snapshots with safe defaults", () => {
    const historical = communicationMessageSchema.parse({
      audience: {
        eventId: "77777777-7777-4777-8777-777777777777",
        targetAudiences: ["Ticket Buyers"],
      },
      channel: "Email",
      contentMarkdown: "Historical message",
      createdAt: "2026-08-01T00:00:00.000Z",
      id: "88888888-8888-4888-8888-888888888888",
      reach: { both: 0, email: 0, sms: 0, total: 0, unreachable: 0 },
      sentAt: null,
      status: "Draft",
      subject: "Historical message",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(historical.audience.ticketBuyerMode).toBe("marketing");
    expect(historical.reach).toMatchObject({
      ticketBuyerPurchasesOverLimit: 0,
      undeliverableTicketBuyerPurchases: 0,
    });
  });

  it("accepts null, undefined, and omitted Contact filter fields", () => {
    for (const value of [null, undefined] as const) {
      expect(
        communicationAudienceRequestSchema.parse({
          contactEmailStatus: value,
          contactSmsStatus: value,
          contactSource: value,
          targetAudiences: ["Contacts"],
        }),
      ).toMatchObject({ contactEmailStatus: null, contactSmsStatus: null, contactSource: null });
    }
    expect(
      communicationAudienceRequestSchema.parse({ targetAudiences: ["Contacts"] }),
    ).toMatchObject({ contactEmailStatus: null, contactSmsStatus: null, contactSource: null });
  });

  it("rejects oversized or malformed Contact selections", () => {
    expect(
      communicationAudienceRequestSchema.safeParse({
        contactIds: Array.from({ length: COMMUNICATION_AUDIENCE_CONTACT_IDS_MAX + 1 }, (_, index) =>
          uuidFor(index),
        ),
        targetAudiences: ["Contacts"],
      }).success,
    ).toBe(false);
    expect(
      communicationAudienceRequestSchema.safeParse({
        contactListIds: Array.from(
          { length: COMMUNICATION_AUDIENCE_CONTACT_LISTS_MAX + 1 },
          (_, index) => uuidFor(index),
        ),
        targetAudiences: ["Contacts"],
      }).success,
    ).toBe(false);
    expect(
      communicationAudienceRequestSchema.safeParse({
        contactIds: ["not-a-uuid"],
        targetAudiences: ["Contacts"],
      }).success,
    ).toBe(false);
    expect(
      communicationAudienceRequestSchema.safeParse({
        contactListIds: ["not-a-uuid"],
        targetAudiences: ["Contacts"],
      }).success,
    ).toBe(false);
    // Foreign IDs stay well-formed UUIDs here; tenancy is enforced by
    // Organization-scoped storage, which matches nothing cross-tenant.
    expect(
      communicationAudienceRequestSchema.safeParse({
        contactIds: [CONTACT_ID],
        contactListIds: [LIST_NEWSLETTER],
        targetAudiences: ["Contacts"],
      }).success,
    ).toBe(true);
  });

  it("rejects empty or oversized audience selections", () => {
    expect(communicationAudienceRequestSchema.safeParse({ targetAudiences: [] }).success).toBe(
      false,
    );
    expect(
      communicationAudienceRequestSchema.safeParse({
        targetAudiences: ["Members", "Contacts", "Ticket Buyers", "Donors", "Members"],
      }).success,
    ).toBe(false);
  });
});

describe("Communication recipient subjects", () => {
  it("parses every recipient kind", () => {
    expect(
      communicationRecipientSubjectSchema.parse({ kind: "profile", profileId: PROFILE_ID }),
    ).toEqual({ kind: "profile", profileId: PROFILE_ID });
    expect(
      communicationRecipientSubjectSchema.parse({ kind: "contact", contactId: CONTACT_ID }),
    ).toEqual({ kind: "contact", contactId: CONTACT_ID });
    expect(
      communicationRecipientSubjectSchema.parse({
        kind: "ticket_purchase",
        purchaseId: PURCHASE_ID,
      }),
    ).toEqual({ kind: "ticket_purchase", purchaseId: PURCHASE_ID });
    expect(
      communicationRecipientSubjectSchema.parse({ kind: "donation", donationId: DONATION_ID }),
    ).toEqual({ kind: "donation", donationId: DONATION_ID });
  });

  it("rejects unknown kinds and malformed IDs", () => {
    expect(
      communicationRecipientSubjectSchema.safeParse({ kind: "household", id: PROFILE_ID }).success,
    ).toBe(false);
    expect(
      communicationRecipientSubjectSchema.safeParse({ kind: "contact", contactId: "bad" }).success,
    ).toBe(false);
    expect(
      communicationRecipientSubjectSchema.safeParse({ kind: "profile", profileId: CONTACT_ID })
        .success,
    ).toBe(true);
  });

  it("adapts legacy carrier IDs to profile subjects without breaking history", () => {
    expect(communicationRecipientSubjectFromLegacy(PROFILE_ID)).toEqual({
      kind: "profile",
      profileId: PROFILE_ID,
    });
    expect(communicationRecipientSubjectId({ kind: "profile", profileId: PROFILE_ID })).toBe(
      PROFILE_ID,
    );
    expect(communicationRecipientSubjectId({ kind: "contact", contactId: CONTACT_ID })).toBe(
      CONTACT_ID,
    );
    expect(
      communicationRecipientSubjectId({ kind: "ticket_purchase", purchaseId: PURCHASE_ID }),
    ).toBe(PURCHASE_ID);
    expect(communicationRecipientSubjectId({ kind: "donation", donationId: DONATION_ID })).toBe(
      DONATION_ID,
    );
  });
});
