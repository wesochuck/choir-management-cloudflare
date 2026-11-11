import { describe, expect, it } from "vitest";
import { communicationPlaceholderDefinitions } from "@choir/domain";
import type { OrganizationBranding, OrganizationEvent, OrganizationVenue } from "@choir/contracts";
import { futureIsoDate, pastIsoDate } from "@choir/testkit";
import {
  SAMPLE_COMMUNICATION_RECIPIENT_NAME,
  communicationPreviewValues,
  renderCommunicationMarkdownPreview,
} from "./communicationMarkdown";

describe("renderCommunicationMarkdownPreview", () => {
  const branding: OrganizationBranding = {
    organizationId: "test-choir",
    organizationName: "Sample Choir",
    logoFileId: "11111111-1111-4111-8111-111111111111",
    physicalAddress: null,
  };

  it("renders every registered placeholder and alias with a sample value", () => {
    const values = communicationPreviewValues(null, "UTC", branding);
    for (const definition of communicationPlaceholderDefinitions) {
      for (const tag of [definition.tag, ...(definition.aliases ?? [])]) {
        const rendered = renderCommunicationMarkdownPreview(tag, values, { branding });
        expect(rendered, tag).not.toContain(tag);
        expect(rendered, tag).not.toBe("<p></p>");
      }
    }
    expect(
      renderCommunicationMarkdownPreview(
        "{{POLL_LINK:11111111-1111-4111-8111-111111111111}}",
        values,
      ),
    ).toContain("Respond Here (No login required)");
  });

  it("renders Organization branding in both brace styles without changing the source", () => {
    const source =
      "{organizationLogo} {{organizationLogo}} {organizationName} {{organizationName}}";
    const rendered = renderCommunicationMarkdownPreview(
      source,
      communicationPreviewValues(null, "UTC", branding),
      { branding },
    );
    expect(rendered.match(/<img /g)).toHaveLength(2);
    expect(rendered).toContain(
      'src="/api/organization/files/11111111-1111-4111-8111-111111111111"',
    );
    expect(rendered).toContain('alt="Sample Choir"');
    expect(rendered).not.toContain("{organization");
    expect(source).toContain("{organizationLogo}");
  });

  it("uses the styled Organization name without a logo and plain text for SMS", () => {
    const noLogo = { ...branding, logoFileId: null };
    const values = communicationPreviewValues(null, "UTC", noLogo);
    const email = renderCommunicationMarkdownPreview("{organizationLogo}", values, {
      branding: noLogo,
    });
    expect(email).toContain("<span style=");
    expect(email).toContain("Sample Choir");
    const sms = renderCommunicationMarkdownPreview("{organizationLogo}", values, {
      branding,
      channel: "SMS",
    });
    expect(sms).toBe("<p>Sample Choir</p>");
  });

  it("escapes Organization names and never renders authored HTML as markup", () => {
    const unsafeBranding = { ...branding, organizationName: '<img src=x onerror="alert(1)">' };
    const rendered = renderCommunicationMarkdownPreview(
      "{organizationLogo} {organizationName} <script>alert(1)</script>",
      communicationPreviewValues(null, "UTC", unsafeBranding),
      { branding: unsafeBranding },
    );
    expect(rendered).toContain('alt="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"');
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("<img src=x");
  });

  it("escapes attributes and markup in link previews", () => {
    const rendered = renderCommunicationMarkdownPreview(
      '[safe](https://example.test/?q=" onmouseover="alert(1)) <img src=x>',
    );

    expect(rendered).toContain(
      '<a href="https://example.test/?q=&quot; onmouseover=&quot;alert(1" target="_blank" rel="noopener noreferrer">safe</a>',
    );
    expect(rendered).toContain("&lt;img src=x&gt;");
    expect(rendered).not.toContain('onmouseover="alert(1)"');
  });

  it("does not turn non-HTTP links into anchors", () => {
    expect(renderCommunicationMarkdownPreview("[unsafe](javascript:alert(1))")).not.toContain(
      "<a ",
    );
  });

  it("renders multiple links with tokens containing underscores without mangling into @@LINK placeholders or accidental italics", () => {
    const source =
      "If you have an account, go to [https://lmc.musicsite.org/schedule](https://lmc.musicsite.org/schedule) and scroll to the bottom. Don't have an account? [Sign up](https://lmc.musicsite.org/join-roster#token=abc_123_xyz).";
    const rendered = renderCommunicationMarkdownPreview(source);

    expect(rendered).not.toContain("@@LINK");
    expect(rendered).not.toContain("<em>");
    expect(rendered).toContain(
      '<a href="https://lmc.musicsite.org/schedule" target="_blank" rel="noopener noreferrer">https://lmc.musicsite.org/schedule</a>',
    );
    expect(rendered).toContain(
      '<a href="https://lmc.musicsite.org/join-roster#token=abc_123_xyz" target="_blank" rel="noopener noreferrer">Sign up</a>',
    );
    expect(rendered).toContain(" and scroll to the bottom. Don&#39;t have an account? ");
  });

  it("handles backslash-escaped characters in preview without rendering escape slashes", () => {
    const rendered = renderCommunicationMarkdownPreview(
      "Buyer: Robin Leach (leachrobing@gmail\\.com) and \\[VIP\\] \\*not italic\\*",
    );
    expect(rendered).toContain("leachrobing@gmail.com");
    expect(rendered).toContain("[VIP]");
    expect(rendered).toContain("*not italic*");
    expect(rendered).not.toContain("<em>not italic</em>");
    expect(rendered).not.toContain("gmail\\.com");
    expect(rendered).not.toContain("\\[");
  });

  it("populates preview placeholders without changing the source", () => {
    const source = "Hi {recipientName}, {eventTitle}. {{RSVP_LINKS}}";
    const rendered = renderCommunicationMarkdownPreview(
      source,
      communicationPreviewValues(null, "UTC"),
    );

    expect(rendered).toContain(SAMPLE_COMMUNICATION_RECIPIENT_NAME);
    expect(rendered).toContain("Example Performance");
    expect(rendered).toContain("View RSVP details");
    expect(rendered).not.toContain("{recipientName}");
    expect(source).toBe("Hi {recipientName}, {eventTitle}. {{RSVP_LINKS}}");
  });

  it("previews canonical recipient placeholders written with double braces", () => {
    const rendered = renderCommunicationMarkdownPreview(
      "Hi {{recipientName}}, {{eventTitle}}.",
      communicationPreviewValues(null, "UTC"),
    );

    expect(rendered).toContain(SAMPLE_COMMUNICATION_RECIPIENT_NAME);
    expect(rendered).toContain("Example Performance");
    expect(rendered).not.toContain("{{recipientName}}");
    expect(rendered).not.toContain("{{eventTitle}}");
  });

  it("continues to preview legacy recipient aliases in both brace styles", () => {
    const rendered = renderCommunicationMarkdownPreview(
      "Hi {singerName}, {{singerName}}, {buyerName}, and {{buyerName}}.",
      communicationPreviewValues(null, "UTC"),
    );

    expect(rendered.match(new RegExp(SAMPLE_COMMUNICATION_RECIPIENT_NAME, "g"))).toHaveLength(4);
    expect(rendered).not.toMatch(/\{\{?(?:singerName|buyerName)\}\}?/);
  });

  it("populates refund placeholders and the order details link", () => {
    const rendered = renderCommunicationMarkdownPreview(
      "Refunded {refundAmount} on {refundDate}. {{TICKET_ORDER_LINK}}",
      communicationPreviewValues(null, "UTC"),
    );

    expect(rendered).toContain("$25.00");
    expect(rendered).toContain("August 20, 2026 at 7:00 PM");
    expect(rendered).toContain("View order details");
    expect(rendered).not.toContain("{{TICKET_ORDER_LINK}}");
  });

  it("uses custom sample recipient name when provided", () => {
    const rendered = renderCommunicationMarkdownPreview(
      "Hello {recipientName} and {singerName}!",
      communicationPreviewValues(null, "UTC", null, "Ada Lovelace"),
    );

    expect(rendered).toContain("Hello Ada Lovelace and Ada Lovelace!");
    expect(rendered).not.toContain(SAMPLE_COMMUNICATION_RECIPIENT_NAME);
  });

  it("renders upcoming performances filtered by audience visibility with venues and ticket links", () => {
    const venueA: OrganizationVenue = {
      address: "123 Symphony Way",
      createdAt: pastIsoDate({ days: 30 }),
      id: "11111111-1111-4111-8111-111111111111",
      name: "Symphony Hall",
      updatedAt: pastIsoDate({ days: 30 }),
    };
    const baseEvent: OrganizationEvent = {
      advancePriceCents: 2000,
      callTime: "",
      createdAt: pastIsoDate({ days: 20 }),
      dayOfPriceCents: 2500,
      details: "",
      doorsOpenTime: "",
      durationMinutes: 90,
      id: "22222222-2222-4222-8222-222222222222",
      isCanceled: false,
      isTicketingEnabled: true,
      location: "Old Location",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      rsvpDeadlineAt: null,
      rsvpDeadlineDate: null,
      rsvpDeadlinePassed: false,
      rsvpFollowUpLeadHours: null,
      rsvpFollowUpMode: "inherit",
      rsvpSelfServiceOpen: true,
      setList: [],
      setListApproved: false,
      setListDefaultTransitionSeconds: 0,
      startsAt: futureIsoDate({ days: 15 }),
      ticketCapacity: 200,
      ticketSlug: "winter-gala",
      title: "Winter Gala",
      type: "Performance",
      updatedAt: pastIsoDate({ days: 10 }),
      venueId: venueA.id,
    };
    const events: OrganizationEvent[] = [
      {
        ...baseEvent,
        id: "33333333-3333-4333-8333-333333333333",
        isTicketingEnabled: false,
        location: "Community Center",
        publishOnWebsite: false,
        ticketSlug: null,
        title: "Internal School Concert",
        startsAt: futureIsoDate({ days: 5 }),
        venueId: null,
      },
      baseEvent,
      {
        ...baseEvent,
        id: "44444444-4444-4444-8444-444444444444",
        isCanceled: true,
        title: "Canceled Concert",
        startsAt: futureIsoDate({ days: 20 }),
      },
      {
        ...baseEvent,
        id: "55555555-5555-4555-8555-555555555555",
        startsAt: pastIsoDate({ days: 3 }),
        title: "Past Concert",
      },
    ];

    const membersHtml = renderCommunicationMarkdownPreview(
      "{{UPCOMING_PERFORMANCES}}",
      communicationPreviewValues(null, "America/New_York", branding, undefined, {
        audience: { targetAudiences: ["Members"] },
        events,
        venues: [venueA],
      }),
      { branding },
    );
    expect(membersHtml).toContain("Internal School Concert");
    expect(membersHtml).toContain("Community Center");
    expect(membersHtml).toContain("Winter Gala");
    expect(membersHtml).toContain("Symphony Hall, 123 Symphony Way");
    expect(membersHtml).toContain('href="/tickets/winter-gala"');
    expect(membersHtml).not.toContain("Canceled Concert");
    expect(membersHtml).not.toContain("Past Concert");
    expect(membersHtml.indexOf("Internal School Concert")).toBeLessThan(
      membersHtml.indexOf("Winter Gala"),
    );

    const contactsHtml = renderCommunicationMarkdownPreview(
      "{{UPCOMING_PERFORMANCES}}",
      communicationPreviewValues(null, "America/New_York", branding, undefined, {
        audience: { targetAudiences: ["Members", "Contacts"] },
        events,
        venues: [venueA],
      }),
      { branding },
    );
    expect(contactsHtml).not.toContain("Internal School Concert");
    expect(contactsHtml).toContain("Winter Gala");

    const internalEvent = events[0];
    if (!internalEvent) throw new Error("Missing internal test event");
    const emptyHtml = renderCommunicationMarkdownPreview(
      "{{UPCOMING_PERFORMANCES}}",
      communicationPreviewValues(null, "America/New_York", branding, undefined, {
        audience: { targetAudiences: ["Contacts"] },
        events: [internalEvent],
      }),
      { branding },
    );
    expect(emptyHtml).toContain("No upcoming performances scheduled.");
  });
});
