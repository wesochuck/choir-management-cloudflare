import type { CommunicationAudienceRequest } from "@choir/contracts";
import { describe, expect, it } from "vitest";

import {
  communicationPlaceholderContext,
  hasEventDependentCommunicationPlaceholders,
  visibleCommunicationPlaceholders,
} from "./communicationPlaceholders";

function audience(
  targetAudiences: CommunicationAudienceRequest["targetAudiences"],
  eventId: string | null = null,
): CommunicationAudienceRequest {
  return {
    contactEmailStatus: null,
    contactIds: [],
    contactListIds: [],
    contactSmsStatus: null,
    contactSource: null,
    eventId,
    globalStatuses: ["Active"],
    profileIds: [],
    rsvp: "All",
    targetAudiences,
    ticketBuyerMode: "marketing",
    voiceParts: [],
  };
}

describe("communication placeholder contexts", () => {
  it("shows only the selected poll's member placeholders for a poll draft", () => {
    const content = "Hi {singerName},\n{{POLL_LINK:11111111-1111-4111-8111-111111111111}}";

    expect(communicationPlaceholderContext(content)).toBe("poll");
    expect(
      visibleCommunicationPlaceholders(audience(["Members"]), "Email", "poll", content).map(
        ({ tag }) => tag,
      ),
    ).toEqual(["{singerName}", "{{POLL_LINK:11111111-1111-4111-8111-111111111111}}"]);
  });

  it("keeps ticket confirmation fields separate from poll and attendance fields", () => {
    const content =
      "Hello {singerName}, {eventTitle} on {eventDate}. {ticketQuantity} tickets, {ticketAmount}. {{TICKET_LINK}}";
    const context = communicationPlaceholderContext(content);
    const tags = visibleCommunicationPlaceholders(
      audience(["Ticket Buyers"]),
      "Email",
      context,
      content,
    ).map(({ tag }) => tag);

    expect(context).toBe("ticket");
    expect(tags).toEqual([
      "{singerName}",
      "{eventTitle}",
      "{eventDate}",
      "{ticketQuantity}",
      "{ticketAmount}",
      "{{TICKET_LINK}}",
    ]);
    expect(tags).not.toContain("{{RSVP_LINKS}}");
    expect(tags).not.toContain("{attendanceRate}");
  });

  it("only exposes bundle fields for a bundle ticket message", () => {
    const content =
      "{ticketBundleName} · {ticketQuantity} · {ticketAmount} · {{TICKET_EVENT_LIST}} · {{TICKET_LINK}}";
    const context = communicationPlaceholderContext(content);
    const tags = visibleCommunicationPlaceholders(
      audience(["Ticket Buyers"]),
      "Email",
      context,
      content,
    ).map(({ tag }) => tag);

    expect(context).toBe("bundle");
    expect(tags).toEqual([
      "{singerName}",
      "{ticketQuantity}",
      "{ticketAmount}",
      "{ticketBundleName}",
      "{{TICKET_EVENT_LIST}}",
      "{{TICKET_LINK}}",
    ]);
  });

  it("keeps event-dependent help for standard messages but not order-scoped messages", () => {
    const members = audience(["Members"]);
    const ticketBuyers = audience(["Ticket Buyers"]);

    expect(hasEventDependentCommunicationPlaceholders(members, "Email", "standard")).toBe(true);
    expect(hasEventDependentCommunicationPlaceholders(ticketBuyers, "Email", "ticket")).toBe(false);
  });
});
