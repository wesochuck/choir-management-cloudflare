import { describe, expect, it } from "vitest";

import {
  CommunicationRenderLimitError,
  communicationDeliveryIssueGuidance,
  communicationDeliveryIssueKind,
  communicationDeliveryIssueLabel,
  communicationFailureCategory,
  communicationReach,
  formatCommunicationEventLocation,
  formatCommunicationSetList,
  maskCommunicationDestination,
  renderCommunicationTemplate,
  renderOrganizationLogoPlaceholder,
  summarizeCommunicationDeliveries,
} from "./communications";
import { replaceUpcomingPerformancesPlaceholder } from "./upcomingPerformances";

describe("Organization communications", () => {
  it("calculates channel-specific reach without counting unreachable recipients", () => {
    const recipients = [
      { email: "email@example.test", phone: "" },
      { email: "", phone: "+1 555 123 4567" },
      { email: "both@example.test", phone: "+1 555 987 6543" },
      { email: "", phone: "" },
    ];
    expect(communicationReach(recipients, "Email")).toEqual({
      audienceOverLimit: false,
      both: 1,
      email: 2,
      sms: 2,
      ticketBuyerPurchasesOverLimit: 0,
      total: 2,
      undeliverableTicketBuyerPurchases: 0,
      unreachable: 2,
    });
    expect(communicationReach(recipients, "Both").total).toBe(3);
    expect(communicationReach(recipients, "Email", 2, 3).ticketBuyerPurchasesOverLimit).toBe(3);
  });

  it("masks destinations and categorizes raw provider failures", () => {
    expect(maskCommunicationDestination("person@example.test", "email")).toBe("p***@example.test");
    expect(maskCommunicationDestination("+1 (555) 123-4567", "sms")).toBe("***4567");
    expect(communicationFailureCategory("429 provider rate limit")).toBe("rate-limit");
    expect(communicationFailureCategory("credential unauthorized")).toBe("authentication");
  });

  it("renders canonical recipient names literally without replacement-token interpretation", () => {
    expect(renderCommunicationTemplate("Hello {recipientName}", "$& $1 $$")).toBe("Hello $& $1 $$");
    expect(renderCommunicationTemplate("Hello {recipientName}", "{buyerName}")).toBe(
      "Hello {buyerName}",
    );
  });

  it("supports both scalar placeholder styles", () => {
    expect(
      renderCommunicationTemplate(
        "Hello {recipientName}; {{recipientName}}; {{eventTitle}}",
        "Ada Alto",
        {
          eventTitle: "Spring Concert",
        },
      ),
    ).toBe("Hello Ada Alto; Ada Alto; Spring Concert");
  });

  it("supports both legacy recipient aliases in both brace styles", () => {
    expect(
      renderCommunicationTemplate(
        "Hi {singerName}, {{singerName}}; thank you {buyerName}, {{buyerName}}.",
        "Jane Buyer",
      ),
    ).toBe("Hi Jane Buyer, Jane Buyer; thank you Jane Buyer, Jane Buyer.");
  });

  it("renders organization logo placeholder with image, fallback text, or plain text for SMS", () => {
    expect(
      renderOrganizationLogoPlaceholder({
        channel: "email",
        logoUrl: "https://example.com/logo.png",
        organizationName: "Seattle Chorale",
      }),
    ).toContain('<img src="https://example.com/logo.png" alt="Seattle Chorale"');

    expect(
      renderOrganizationLogoPlaceholder({
        channel: "email",
        logoUrl: null,
        organizationName: "Seattle Chorale",
      }),
    ).toContain(
      '<span style="font-size:18px;font-weight:bold;color:#1b4d3e;">Seattle Chorale</span>',
    );

    expect(
      renderOrganizationLogoPlaceholder({
        channel: "sms",
        logoUrl: "https://example.com/logo.png",
        organizationName: "Seattle Chorale",
      }),
    ).toBe("Seattle Chorale");
  });

  it("summarizes delivery state without exposing raw errors or destinations", () => {
    const summary = summarizeCommunicationDeliveries("message-1", [
      {
        attempts: 1,
        channel: "email",
        destination: "person@example.test",
        failureDetail: "provider rejected secret payload",
        status: "failed",
        updatedAt: "2026-07-22T12:00:00.000Z",
      },
      {
        attempts: 1,
        channel: "sms",
        destination: "+15551234567",
        failureDetail: "",
        status: "sent",
        updatedAt: "2026-07-22T12:01:00.000Z",
      },
    ]);
    expect(summary.state).toBe("partial");
    expect(summary.failures[0]).toMatchObject({
      category: "provider-rejected",
      maskedDestination: "p***@example.test",
    });
    expect(JSON.stringify(summary)).not.toContain("secret payload");
    expect(JSON.stringify(summary)).not.toContain("person@example.test");
  });

  it("classifies delivery issue kinds, labels, and plain-English guidance", () => {
    expect(communicationDeliveryIssueKind("sent", "bounced")).toBe("bounced");
    expect(communicationDeliveryIssueKind("sent", "complained")).toBe("complained");
    expect(communicationDeliveryIssueKind("sent", "rejected")).toBe("rejected");
    expect(communicationDeliveryIssueKind("sent", "failed")).toBe("provider_failed");
    expect(communicationDeliveryIssueKind("failed", null)).toBe("failed");
    expect(communicationDeliveryIssueKind("sent", "delivered")).toBeNull();
    expect(communicationDeliveryIssueKind("sent", "deferred")).toBeNull();
    expect(communicationDeliveryIssueKind("suppressed", null)).toBeNull();

    expect(communicationDeliveryIssueLabel("bounced")).toBe("Bounced");
    expect(communicationDeliveryIssueLabel("complained")).toBe("Complained");
    expect(communicationDeliveryIssueLabel("rejected")).toBe("Rejected");
    expect(communicationDeliveryIssueLabel("provider_failed")).toBe("Provider failed");
    expect(communicationDeliveryIssueLabel("failed")).toBe("Failed");

    expect(
      communicationDeliveryIssueGuidance({ category: "invalid-destination", issueKind: "bounced" }),
    ).toContain("bounced");
    expect(
      communicationDeliveryIssueGuidance({
        category: "provider-rejected",
        issueKind: "complained",
      }),
    ).toContain("automatically suppressed");
    expect(
      communicationDeliveryIssueGuidance({ category: "rate-limit", issueKind: "failed" }),
    ).toContain("retry");
  });

  it("formats communication set lists as Markdown bullet items with empty fallback", () => {
    expect(
      formatCommunicationSetList([
        { title: " Adeste Fideles " },
        { title: "" },
        { title: 123 },
        { title: "God Rest You Merry, Gentlemen" },
      ]),
    ).toBe("- Adeste Fideles\n- God Rest You Merry, Gentlemen");

    expect(formatCommunicationSetList([])).toBe("- Set list not published");
    expect(formatCommunicationSetList(null)).toBe("- Set list not published");
    expect(formatCommunicationSetList(undefined)).toBe("- Set list not published");
    expect(formatCommunicationSetList([{ title: "   " }])).toBe("- Set list not published");
    expect(formatCommunicationSetList([], "")).toBe("");
  });

  it("enforces rendered-size budgets for body, subject, and upcoming performance expansions (SEC-01)", () => {
    const exactBody = renderCommunicationTemplate(
      "Hi {recipientName}: {setlist}",
      "Ada",
      { setlist: "- Song A\n- Song B" },
      { field: "body", maxLength: 25 },
    );
    expect(exactBody).toBe("Hi Ada: - Song A\n- Song B");
    expect(exactBody.length).toBe(25);

    expect(() =>
      renderCommunicationTemplate(
        "Hi {recipientName}: {setlist}!",
        "Ada",
        { setlist: "- Song A\n- Song B" },
        { field: "body", maxLength: 25 },
      ),
    ).toThrow(CommunicationRenderLimitError);

    try {
      renderCommunicationTemplate(
        "{setlist}".repeat(500),
        "Ada",
        { setlist: "X".repeat(100) },
        { field: "body", maxLength: 250 },
      );
      expect.unreachable("Expected repeated placeholder expansion to throw");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(CommunicationRenderLimitError);
      if (error instanceof CommunicationRenderLimitError) {
        expect(error.code).toBe("communication_render_limit_exceeded");
        expect(error.field).toBe("body");
        expect(error.limit).toBe(250);
      }
    }

    const exactSubject = renderCommunicationTemplate(
      "Re: {eventTitle}",
      "Ada",
      { eventTitle: "Spring Gala" },
      { field: "subject", maxLength: 15 },
    );
    expect(exactSubject).toBe("Re: Spring Gala");
    expect(exactSubject.length).toBe(15);

    expect(() =>
      renderCommunicationTemplate(
        "Re: {eventTitle}!",
        "Ada",
        { eventTitle: "Spring Gala" },
        { field: "subject", maxLength: 15 },
      ),
    ).toThrow(CommunicationRenderLimitError);

    const exactUpcoming = replaceUpcomingPerformancesPlaceholder(
      "Shows:\n{{UPCOMING_PERFORMANCES}}",
      "- Gala",
      13,
    );
    expect(exactUpcoming).toBe("Shows:\n- Gala");
    expect(() =>
      replaceUpcomingPerformancesPlaceholder("Shows:\n{{UPCOMING_PERFORMANCES}}!", "- Gala", 13),
    ).toThrow(CommunicationRenderLimitError);
  });

  it("formats {eventLocation} with venue name, address, and markdown-safe Google Maps link", () => {
    expect(
      formatCommunicationEventLocation({
        venueAddress: "163 E Wheeling St\nLancaster, OH 43130",
        venueName: "First United Methodist Church - Choir Room (Upstairs)",
      }),
    ).toBe(
      "First United Methodist Church - Choir Room (Upstairs), 163 E Wheeling St Lancaster, OH 43130 ([Google Maps](https://www.google.com/maps/search/?api=1&query=First%20United%20Methodist%20Church%20-%20Choir%20Room%20%28Upstairs%29%2C%20163%20E%20Wheeling%20St%20Lancaster%2C%20OH%2043130))",
    );

    expect(
      formatCommunicationEventLocation(
        {
          venueAddress: "163 E Wheeling St, Lancaster, OH 43130",
          venueName: "First United Methodist Church - Sanctuary Main Floor",
        },
        { includeMapLink: false },
      ),
    ).toBe(
      "First United Methodist Church - Sanctuary Main Floor, 163 E Wheeling St, Lancaster, OH 43130",
    );

    expect(formatCommunicationEventLocation({ location: "TBD" })).toBe("TBD");
    expect(formatCommunicationEventLocation({})).toBe("");
  });
});
