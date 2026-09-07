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
        data: { both: 1, email: 2, sms: 1, total: 2, unreachable: 0 },
        error: null,
        loading: false,
      },
    });
    expect(html).toContain("Reach:");
    expect(html).toContain("2 people can");
  });
});
