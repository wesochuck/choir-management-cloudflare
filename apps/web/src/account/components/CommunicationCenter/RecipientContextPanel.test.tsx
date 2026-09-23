import type { ContactList } from "@choir/contracts";
import { contactListSchema } from "@choir/contracts";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RecipientContextPanel } from "./RecipientContextPanel";
import { audienceOptions, defaultAudience } from "./utils";

const LIST_NEWSLETTER = "33333333-3333-4333-8333-333333333333";
const LIST_AUDIENCE = "44444444-4444-4444-8444-444444444444";

function listFixture(id: string, name: string): ContactList {
  return contactListSchema.parse({
    createdAt: "2026-08-01T00:00:00.000Z",
    description: null,
    id,
    name,
    updatedAt: "2026-08-02T00:00:00.000Z",
  });
}

const contactLists = [
  listFixture(LIST_NEWSLETTER, "Newsletter"),
  listFixture(LIST_AUDIENCE, "2026 Audience"),
];

function renderPanel(overrides: Partial<Parameters<typeof RecipientContextPanel>[0]> = {}): string {
  return renderToString(
    <RecipientContextPanel
      audience={defaultAudience}
      audienceOptions={audienceOptions}
      channel="Email"
      contactLists={contactLists}
      events={[]}
      expanded
      onChannelChange={vi.fn()}
      onToggleExpanded={vi.fn()}
      onUpdateAudience={vi.fn()}
      reachState={{ data: null, error: null, loading: false }}
      rosterConfiguration={null}
      selectedEvent={null}
      {...overrides}
    />,
  );
}

describe("RecipientContextPanel Contacts audience", () => {
  it("offers Contacts alongside Members, Ticket Buyers, and Donors", () => {
    const html = renderPanel();
    for (const option of ["Members", "Contacts", "Ticket Buyers", "Donors"]) {
      expect(html).toContain(option);
    }
  });

  it("exposes list checkboxes when Contacts is selected", () => {
    const html = renderPanel({
      audience: {
        ...defaultAudience,
        contactListIds: [LIST_NEWSLETTER],
        targetAudiences: ["Contacts"],
      },
    });
    expect(html).toContain("Contact lists");
    expect(html).toContain("Newsletter");
    expect(html).toContain("2026 Audience");
  });

  it("hides list selection until Contacts is selected", () => {
    const html = renderPanel({
      audience: { ...defaultAudience, targetAudiences: ["Members"] },
    });
    expect(html).not.toContain("Contact lists");
  });

  it("explains the empty-list state without hiding the Contacts audience", () => {
    const html = renderPanel({
      audience: { ...defaultAudience, targetAudiences: ["Contacts"] },
      contactLists: [],
    });
    expect(html).toContain("Contacts");
    expect(html).toContain("No contact lists yet");
  });

  it("previews recipient counts where the architecture supports it", () => {
    const html = renderPanel({
      audience: { ...defaultAudience, targetAudiences: ["Members", "Contacts"] },
      reachState: {
        data: {
          both: 1,
          email: 2,
          sms: 1,
          ticketBuyerPurchasesOverLimit: 0,
          total: 2,
          undeliverableTicketBuyerPurchases: 0,
          unreachable: 0,
        },
        error: null,
        loading: false,
      },
    });
    expect(html).toContain("Reach:");
    expect(html).toContain("2 people can");
  });

  it("explains the explicit service mode and requires a performance selection", () => {
    const html = renderPanel({
      audience: {
        ...defaultAudience,
        eventId: null,
        targetAudiences: ["Ticket Buyers"],
        ticketBuyerMode: "ticket_service",
      },
    });
    expect(html).toContain("Ticket buyer audience");
    expect(html).toContain("Important notice for current ticket holders");
    expect(html).toContain("even if they did not opt in to marketing email");
    expect(html).toContain("Event ");
    expect(html).toContain("(required)");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Select the affected performance to contact its ticket holders.");
  });

  it("keeps Ticket Buyers in marketing mode until staff choose a service notice", () => {
    const html = renderPanel({
      audience: { ...defaultAudience, targetAudiences: ["Ticket Buyers"] },
    });
    expect(html).toContain(
      'type="radio" name="communication-ticket-buyer-mode" checked="" value="marketing"',
    );
    expect(html).toContain("Marketing / general communication");
    expect(html).toContain('value="ticket_service"');
  });

  it("does not enable ticket-service mode for SMS delivery", () => {
    const html = renderPanel({
      audience: { ...defaultAudience, targetAudiences: ["Ticket Buyers"] },
      channel: "SMS",
    });
    expect(html).toContain("Switch delivery channel to Email to enable ticket-holder notices.");
    expect(html).toContain('value="ticket_service"');
    expect(html).toContain('disabled=""');
  });

  it("shows unresolved orders and audience-limit counts for service notices", () => {
    const html = renderPanel({
      audience: {
        ...defaultAudience,
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        targetAudiences: ["Ticket Buyers"],
        ticketBuyerMode: "ticket_service",
      },
      reachState: {
        data: {
          both: 0,
          email: 998,
          sms: 0,
          ticketBuyerPurchasesOverLimit: 2,
          total: 998,
          undeliverableTicketBuyerPurchases: 1,
          unreachable: 2,
        },
        error: null,
        loading: false,
      },
    });
    expect(html).toContain("1 paid ticket orders have no matching Contact or usable email");
    expect(html).toContain(
      "2 paid ticket orders exceed the 1,000-order message limit; sending is blocked",
    );
  });
});
