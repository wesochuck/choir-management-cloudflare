import { describe, expect, it } from "vitest";

import {
  platformHomeTicketListingSchema,
  platformHomeTicketListingsResponseSchema,
  platformInquiryRequestSchema,
  platformInquiryResponseSchema,
} from "./platformHome";

describe("Platform home contracts", () => {
  it("validates a platform ticket listing", () => {
    const listing = {
      eventId: "11111111-1111-4111-8111-111111111111",
      organizationName: "Lancaster Community Chorus",
      startsAt: "2026-11-15T19:30:00.000Z",
      ticketsUrl: "https://lancasterchorus.org/tickets/11111111-1111-4111-8111-111111111111",
      timezone: "America/New_York",
      title: "Winter Masterworks Concert",
      venueName: "Fairfield County Heritage Hall",
    };

    const parsed = platformHomeTicketListingSchema.parse(listing);
    expect(parsed).toEqual(listing);

    const response = platformHomeTicketListingsResponseSchema.parse({
      listings: [listing],
      requestId: "22222222-2222-4222-8222-222222222222",
    });
    expect(response.listings).toHaveLength(1);
  });

  it("rejects ticket listing with invalid URL scheme", () => {
    expect(() =>
      platformHomeTicketListingSchema.parse({
        eventId: "11111111-1111-4111-8111-111111111111",
        organizationName: "Lancaster Community Chorus",
        startsAt: "2026-11-15T19:30:00.000Z",
        ticketsUrl: "javascript:alert(1)",
        timezone: "America/New_York",
        title: "Concert",
        venueName: "Hall",
      }),
    ).toThrow();
  });

  it("validates and trims an inquiry request with defaults", () => {
    const raw = {
      contactName: "  Jane Doe  ",
      email: "jane@fairfieldarts.org",
      organizationName: "  Fairfield County Youth Arts  ",
    };

    const parsed = platformInquiryRequestSchema.parse(raw);
    expect(parsed).toEqual({
      contactName: "Jane Doe",
      email: "jane@fairfieldarts.org",
      location: "",
      message: "",
      organizationName: "Fairfield County Youth Arts",
      turnstileToken: undefined,
      website: "",
    });
  });

  it("validates full inquiry request and parses response", () => {
    const raw = {
      contactName: "John Smith",
      email: "john@nonprofit.org",
      location: "Lancaster, OH",
      message: "We are an all-volunteer community choir in Fairfield County.",
      organizationName: "Buckeye Choral Society",
      website: "",
    };

    const parsed = platformInquiryRequestSchema.parse(raw);
    expect(parsed.location).toBe("Lancaster, OH");
    expect(parsed.message).toBe("We are an all-volunteer community choir in Fairfield County.");

    const response = platformInquiryResponseSchema.parse({
      accepted: true,
      requestId: "33333333-3333-4333-8333-333333333333",
    });
    expect(response.accepted).toBe(true);
  });

  it("rejects inquiry with invalid control characters in single-line text", () => {
    expect(() =>
      platformInquiryRequestSchema.parse({
        contactName: "Jane\nDoe",
        email: "jane@example.com",
        organizationName: "Choir",
      }),
    ).toThrow();
  });
});
