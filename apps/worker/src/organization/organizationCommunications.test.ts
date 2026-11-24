import { organizationEventSchema, type OrganizationEvent } from "@choir/contracts";
import { futureDateString, futureIsoDate, pastIsoDate } from "@choir/testkit";
import { describe, expect, it } from "vitest";

import { renderTestEmailPayload } from "./organizationCommunications";

function makeEvent(overrides: Partial<OrganizationEvent> = {}) {
  return organizationEventSchema.parse({
    advancePriceCents: 0,
    callTime: "17:30",
    createdAt: pastIsoDate({ days: 5 }),
    dayOfPriceCents: 0,
    details: "Concert details",
    doorsOpenTime: "",
    durationMinutes: 90,
    id: "11111111-1111-4111-8111-111111111111",
    isCanceled: false,
    isTicketingEnabled: false,
    location: "Main Hall",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpDeadlineDate: futureDateString({ days: 5 }),
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    setList: [],
    setListApproved: false,
    setListDefaultTransitionSeconds: 0,
    startsAt: futureIsoDate({ days: 10 }),
    ticketCapacity: null,
    title: "Downtown Christmas Stroll",
    type: "Performance",
    updatedAt: pastIsoDate({ days: 1 }),
    venueId: null,
    ...overrides,
  });
}

describe("renderTestEmailPayload", () => {
  it("resolves {setlist} as a bulleted Markdown list when the event has set list items", () => {
    const rendered = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: null, organizationName: "Alpha Choir" },
      contentMarkdown: "### Set list\n\n{setlist}\n\n{{PLAYER_LINK}}",
      event: makeEvent({
        setList: [
          { title: "Adeste Fideles" },
          { title: "God Rest You Merry, Gentlemen" },
          { title: "A King is Born" },
        ],
      }),
      fromName: "Alpha Choir",
      subject: "Performance details for: {eventTitle}",
      timezone: "America/New_York",
    });

    expect(rendered.templatedSubject).toBe("Performance details for: Downtown Christmas Stroll");
    expect(rendered.templatedContent).toContain(
      "### Set list\n\n- Adeste Fideles\n- God Rest You Merry, Gentlemen\n- A King is Born",
    );
    expect(rendered.templatedContent).not.toContain("{setlist}");
  });

  it("resolves {setlist} to the empty fallback when the selected event has no set list items", () => {
    const rendered = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: null, organizationName: "Alpha Choir" },
      contentMarkdown: "### Set list\n\n{setlist}",
      event: makeEvent({ setList: [] }),
      fromName: "Alpha Choir",
      subject: "Performance details for: {eventTitle}",
      timezone: "America/New_York",
    });

    expect(rendered.templatedContent).toContain("- Set list not published");
    expect(rendered.templatedContent).not.toContain("{setlist}");
  });

  it("leaves {setlist} unresolved when no event is selected", () => {
    const rendered = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: null, organizationName: "Alpha Choir" },
      contentMarkdown: "### Set list\n\n{setlist}",
      event: null,
      fromName: "Alpha Choir",
      subject: "General update",
      timezone: "America/New_York",
    });

    expect(rendered.templatedContent).toContain("{setlist}");
  });
});
