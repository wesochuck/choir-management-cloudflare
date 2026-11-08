import { organizationEventSchema } from "@choir/contracts";
import { describe, expect, it } from "vitest";

import { formatTicketBundleEventList } from "../src/jobs/deliveries/ticketEventList";
import { renderTestEmailPayload } from "../src/organization/organizationCommunications";
import {
  formatEventDate as formatRsvpDeclineEventDate,
  formatEventShortDate as formatRsvpDeclineShortDate,
} from "../src/organization/rsvpDeclineNotifications";
import {
  buildAlertContent,
  formatEventDate as formatTicketAlertEventDate,
} from "../src/organization/ticketSaleAlerts";

describe("Cross-worker timezone formatting guardrails", () => {
  // 2026-12-13T20:00:00.000Z is Sunday, December 13, 2026 at 3:00 PM EST (America/New_York).
  // In UTC, it would wrongly render as 8:00 PM.
  const CONCERT_STARTS_AT_UTC = "2026-12-13T20:00:00.000Z"; // historic-fixture
  // 2026-12-14T00:30:00.000Z is Sunday, December 13, 2026 at 7:30 PM EST (America/New_York).
  // In UTC, it would wrongly shift to Monday, December 14, 2026 at 12:30 AM.
  const EVENING_CONCERT_STARTS_AT_UTC = "2026-12-14T00:30:00.000Z"; // historic-fixture
  const ORG_TIMEZONE = "America/New_York";

  it("formats ticket sale alert dates in the Organization timezone (3:00 PM EST, never 8:00 PM UTC)", () => {
    const formatted = formatTicketAlertEventDate(CONCERT_STARTS_AT_UTC, ORG_TIMEZONE);
    expect(formatted).toBe("Sunday, December 13, 2026 at 3:00 PM");
    expect(formatted).not.toContain("8:00 PM");

    const alert = buildAlertContent(
      {
        amountPaidCents: 2091,
        buyerEmail: "buyer@example.test",
        buyerName: "Test Buyer",
        currency: "USD",
        eventId: "event-1",
        orderUrl: "https://example.test/admin/tickets",
        organizationId: "org-1",
        purchaseId: "purchase-1",
        quantity: 2,
        requestId: "req-1",
      },
      "2026 Christmas Concert",
      CONCERT_STARTS_AT_UTC,
      ORG_TIMEZONE,
    );
    expect(alert.contentMarkdown).toContain("- **Date:** Sunday, December 13, 2026 at 3:00 PM");
    expect(alert.contentMarkdown).not.toContain("8:00 PM");
  });

  it("formats Communication Center [Test] emails in the Organization timezone instead of UTC", () => {
    const rendered = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: {
        logoFileId: null,
        organizationName: "Alpha Choir",
      },
      contentMarkdown: "Join us on {eventDate} at {eventLocation}.",
      event: organizationEventSchema.parse({
        advancePriceCents: 2000,
        callTime: "14:00",
        createdAt: "2026-10-01T00:00:00.000Z", // historic-fixture
        dayOfPriceCents: 2500,
        details: "Concert details",
        doorsOpenTime: "14:30",
        durationMinutes: 90,
        id: "11111111-1111-4111-8111-111111111111",
        isCanceled: false,
        isTicketingEnabled: true,
        location: "Symphony Hall",
        parentPerformanceId: null,
        publicDetails: "",
        publicGraphicFileId: null,
        publishOnWebsite: true,
        rsvpDeadlineDate: "2026-12-01", // historic-fixture
        rsvpFollowUpLeadHours: null,
        rsvpFollowUpMode: "inherit",
        setList: [],
        setListApproved: false,
        setListDefaultTransitionSeconds: 0,
        startsAt: CONCERT_STARTS_AT_UTC,
        ticketCapacity: 100,
        title: "2026 Christmas Concert",
        type: "Performance",
        updatedAt: "2026-10-01T00:00:00.000Z", // historic-fixture
        venueId: null,
      }),
      fromName: "Alpha Choir",
      subject: "Reminder for {eventTitle}",
      timezone: ORG_TIMEZONE,
    });

    expect(rendered.templatedSubject).toBe("Reminder for 2026 Christmas Concert");
    expect(rendered.templatedContent).toContain("December 13, 2026 at 3:00 PM");
    expect(rendered.templatedContent).not.toContain("8:00 PM");
  });

  it("formats ticket bundle event lists in the Organization timezone", () => {
    const markdown = formatTicketBundleEventList(
      [
        {
          doorsOpenTime: "2:30 PM",
          id: "event-1",
          location: "Downtown",
          startsAt: CONCERT_STARTS_AT_UTC,
          title: "2026 Christmas Concert",
          venueAddress: "1 Main St",
          venueName: "Symphony Hall",
        },
      ],
      ORG_TIMEZONE,
    );

    expect(markdown).toContain("Sunday, December 13, 2026 at 3:00 PM");
    expect(markdown).not.toContain("8:00 PM");
  });

  it("formats RSVP decline notification full and short dates in the Organization timezone without shifting evening concerts to the next UTC day", () => {
    const full = formatRsvpDeclineEventDate(EVENING_CONCERT_STARTS_AT_UTC, ORG_TIMEZONE);
    expect(full).toBe("Sunday, December 13, 2026 at 7:30 PM");
    expect(full).not.toContain("December 14");

    const short = formatRsvpDeclineShortDate(EVENING_CONCERT_STARTS_AT_UTC, ORG_TIMEZONE);
    expect(short).toBe("Dec 13");
    expect(short).not.toBe("Dec 14");
  });
});
