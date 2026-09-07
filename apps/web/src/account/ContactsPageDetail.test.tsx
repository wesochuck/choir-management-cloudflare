import type { Contact } from "@choir/contracts";
import { contactSchema } from "@choir/contracts";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ContactDetail } from "../api";
import { ContactDetailContent } from "./ContactsPageDetail";

const CONTACT_JANE = "11111111-1111-4111-8111-111111111111";
const PROFILE_JANE = "44444444-4444-4444-8444-444444444444";
const LIST_NEWSLETTER = "33333333-3333-4333-8333-333333333333";
const LIST_AUDIENCE = "55555555-5555-4555-8555-555555555555";

const janeContact: Contact = contactSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  displayName: "Jane Smith",
  email: "jane@example.com",
  firstName: "Jane",
  id: CONTACT_JANE,
  lastName: "Smith",
  normalizedEmail: "jane@example.com",
  normalizedPhone: null,
  phone: null,
  profileId: PROFILE_JANE,
  source: "Website signup",
  updatedAt: "2026-08-02T00:00:00.000Z",
});

function detailFixture(overrides: Partial<ContactDetail> = {}): ContactDetail {
  return {
    activity: { donationCount: 2, ticketPurchaseCount: 4 },
    contact: janeContact,
    lastEmailAt: "2026-08-12T10:00:00.000Z",
    linkedProfile: { displayName: "Jane Singer", id: PROFILE_JANE },
    listIds: [LIST_NEWSLETTER, LIST_AUDIENCE],
    lists: [
      { id: LIST_NEWSLETTER, name: "Newsletter" },
      { id: LIST_AUDIENCE, name: "Concert Audience" },
    ],
    preferences: [
      {
        channel: "email",
        contactId: CONTACT_JANE,
        observedAt: "2026-08-01T00:00:00.000Z",
        source: null,
        status: "subscribed",
      },
      {
        channel: "sms",
        contactId: CONTACT_JANE,
        observedAt: "2026-08-01T00:00:00.000Z",
        source: null,
        status: "unknown",
      },
    ],
    ...overrides,
  };
}

function renderDetail(detail: ContactDetail): string {
  return renderToString(<ContactDetailContent detail={detail} />);
}

describe("ContactDetailContent", () => {
  it("projects the linked profile, lists, activity counts, and communication state", () => {
    const html = renderDetail(detailFixture());
    // The contact name itself is the dialog title; content starts at sections.
    expect(html).toContain("Organization Profile");
    expect(html).toContain("Jane Singer");
    expect(html).toContain("Newsletter");
    expect(html).toContain("Concert Audience");
    expect(html).toContain("Ticket purchases");
    expect(html).toContain("Donations");
    expect(html).toContain("Subscribed");
    expect(html).toContain("Unknown");
    expect(html).toContain("Last email sent");
    expect(html).toContain("2026");
  });

  it("states empty relationships explicitly instead of omitting them", () => {
    const html = renderDetail(
      detailFixture({
        activity: { donationCount: 0, ticketPurchaseCount: 0 },
        lastEmailAt: null,
        linkedProfile: null,
        listIds: [],
        lists: [],
        preferences: [],
      }),
    );
    expect(html).toContain("Not linked to a roster profile.");
    expect(html).toContain("No lists");
    expect(html).toContain("No marketing email sent yet");
    expect(html).toContain("Unknown");
  });

  it("keeps commerce and roster records out of the dialog: counts only, no snapshots", () => {
    const html = renderDetail(detailFixture());
    expect(html).not.toContain("buyer@example.com");
    expect(html).not.toContain("Spring Concert");
  });
});
