import type { Contact } from "@choir/contracts";
import { contactSchema } from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import type { ContactDetail } from "../api";
import { ContactDetailDialog } from "./ContactsPageDetail";

const CONTACT_CATHY = "11111111-1111-4111-8111-111111111111";
const EVENT_EARTH = "66666666-6666-4666-8666-666666666666";
const PURCHASE_ONE = "77777777-7777-4777-8777-777777777777";
const PURCHASE_TWO = "88888888-8888-4888-8888-888888888888";
const BUNDLE_SEASON = "99999999-9999-4999-8999-999999999999";
const LIST_NEWSLETTER = "33333333-3333-4333-8333-333333333333";

const cathyContact: Contact = contactSchema.parse({
  createdAt: "2026-11-15T15:00:00.000Z",
  displayName: "Cathy Dardis",
  email: "cathy@example.com",
  firstName: "Cathy",
  id: CONTACT_CATHY,
  lastName: "Dardis",
  normalizedEmail: "cathy@example.com",
  normalizedPhone: null,
  phone: null,
  profileId: null,
  source: "ticket_purchase",
  updatedAt: "2026-11-15T15:00:00.000Z",
});

function buildDetail(overrides: Partial<ContactDetail> = {}): ContactDetail {
  return {
    activity: {
      donationCount: 1,
      ticketPurchaseCount: 2,
      ticketPurchases: [
        {
          bundleId: null,
          bundleTitle: "",
          createdAt: "2026-11-15T15:00:00.000Z",
          eventId: EVENT_EARTH,
          eventTitle: "Earth and Sky and Sea",
          id: PURCHASE_ONE,
          marketingOptIn: true,
          quantity: 2,
          status: "paid",
        },
        {
          bundleId: BUNDLE_SEASON,
          bundleTitle: "2026–27 Full Season Pass",
          createdAt: "2026-10-01T12:00:00.000Z",
          eventId: EVENT_EARTH,
          eventTitle: "Earth and Sky and Sea",
          id: PURCHASE_TWO,
          marketingOptIn: false,
          quantity: 1,
          status: "paid",
        },
      ],
    },
    contact: cathyContact,
    lastEmailAt: null,
    linkedProfile: null,
    listIds: [LIST_NEWSLETTER],
    lists: [{ id: LIST_NEWSLETTER, name: "Holiday Audience" }],
    preferences: [
      {
        channel: "email",
        contactId: CONTACT_CATHY,
        observedAt: "2026-11-15T15:00:00.000Z",
        source: "ticket_purchase",
        status: "subscribed",
      },
      {
        channel: "sms",
        contactId: CONTACT_CATHY,
        observedAt: "2026-11-15T15:00:00.000Z",
        source: null,
        status: "unknown",
      },
    ],
    ...overrides,
  };
}

describe("ContactDetailDialog", () => {
  it("switches between Overview, Activity, and Lists tabs and shows concert and opt-in details", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<ContactDetailDialog detail={buildDetail()} onClose={vi.fn()} onEdit={onEdit} open />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("cathy@example.com")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Opted in to marketing emails during checkout for Earth and Sky and Sea/,
      ),
    ).toBeInTheDocument();

    // Jump to Activity tab from Overview button
    await user.click(within(dialog).getByRole("button", { name: /View activity/i }));
    const activityTab = within(dialog).getByRole("tab", { name: /Activity/i });
    expect(activityTab).toHaveAttribute("aria-selected", "true");
    const activityPanel = within(dialog).getByRole("tabpanel", { name: /Activity/i });
    expect(within(activityPanel).getByText("Earth and Sky and Sea")).toBeInTheDocument();
    expect(within(activityPanel).getByText("2026–27 Full Season Pass")).toBeInTheDocument();
    expect(within(activityPanel).getByText("Single")).toBeInTheDocument();
    expect(within(activityPanel).getByText("Bundle")).toBeInTheDocument();
    expect(within(activityPanel).getByText("Marketing opt-in")).toBeInTheDocument();
    expect(within(activityPanel).getByText("No marketing opt-in")).toBeInTheDocument();

    // Switch to Lists tab via left rail
    await user.click(within(dialog).getByRole("tab", { name: /Lists/i }));
    const listsPanel = within(dialog).getByRole("tabpanel", { name: /Lists/i });
    expect(within(listsPanel).getByText("Holiday Audience")).toBeInTheDocument();

    // Edit contact action in footer
    await user.click(within(dialog).getByRole("button", { name: "Edit contact" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("clearly indicates when a ticket buyer did not opt into marketing emails", () => {
    render(
      <ContactDetailDialog
        detail={buildDetail({
          activity: {
            donationCount: 0,
            ticketPurchaseCount: 1,
            ticketPurchases: [
              {
                bundleId: null,
                bundleTitle: "",
                createdAt: "2026-11-15T15:00:00.000Z",
                eventId: EVENT_EARTH,
                eventTitle: "Earth and Sky and Sea",
                id: PURCHASE_ONE,
                marketingOptIn: false,
                quantity: 1,
                status: "paid",
              },
            ],
          },
          preferences: [
            {
              channel: "email",
              contactId: CONTACT_CATHY,
              observedAt: "2026-11-15T15:00:00.000Z",
              source: "ticket_purchase",
              status: "unknown",
            },
          ],
        })}
        onClose={vi.fn()}
        open
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("Not opted in").length).toBeGreaterThanOrEqual(1);
    expect(
      within(dialog).getByText(
        "Added via ticket purchase for Earth and Sky and Sea (1 ticket). Did not opt in to marketing emails at checkout.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Did not opt in to marketing emails at checkout. Transactional ticket receipts are still sent.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Edit contact" })).not.toBeInTheDocument();
  });
});
