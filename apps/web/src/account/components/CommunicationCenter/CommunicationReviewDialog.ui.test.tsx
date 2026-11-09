import type { CommunicationAudienceRequest } from "@choir/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { CommunicationReviewDialog } from "./CommunicationReviewDialog";

const testAudience: CommunicationAudienceRequest = {
  contactEmailStatus: "subscribed",
  contactIds: [],
  contactListIds: [],
  contactSmsStatus: null,
  contactSource: "all",
  eventId: null,
  excludeTicketBuyersForEventId: "77777777-7777-4777-8777-777777777777",
  globalStatuses: ["Active"],
  profileIds: [],
  rsvp: "All",
  targetAudiences: ["Ticket Buyers"],
  ticketBuyerMode: "marketing",
  ticketBuyerPastEventsOnly: true,
  voiceParts: [],
};

describe("CommunicationReviewDialog", () => {
  it("renders recipient summary, reach, and triggers onSend", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onClose = vi.fn();

    render(
      <CommunicationReviewDialog
        audience={testAudience}
        busy={false}
        channel="Email"
        contactLists={[]}
        contentMarkdown="Hello world"
        error={null}
        onClose={onClose}
        onSend={onSend}
        open={true}
        reachState={{
          data: {
            audienceOverLimit: false,
            both: 0,
            email: 357,
            sms: 0,
            ticketBuyerPurchasesOverLimit: 0,
            total: 357,
            undeliverableTicketBuyerPurchases: 2,
            unreachable: 2,
          },
          error: null,
          loading: false,
        }}
        rosterConfiguration={null}
        selectedEvent={null}
        subject="Concert announcement"
        timezone="America/New_York"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Review message" })).toBeInTheDocument();
    expect(screen.getByText("357 people can receive this email · 2 cannot")).toBeInTheDocument();
    const sendButton = screen.getByRole("button", { name: "Send to 357 recipients" });
    expect(sendButton).toBeEnabled();

    await user.click(sendButton);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("renders error alert and scrolls it into view when error prop is provided", () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = render(
      <CommunicationReviewDialog
        audience={testAudience}
        busy={false}
        channel="Email"
        contactLists={[]}
        contentMarkdown="Hello world"
        error={null}
        onClose={vi.fn()}
        onSend={vi.fn()}
        open={true}
        reachState={{
          data: {
            audienceOverLimit: false,
            both: 0,
            email: 357,
            sms: 0,
            ticketBuyerPurchasesOverLimit: 0,
            total: 357,
            undeliverableTicketBuyerPurchases: 0,
            unreachable: 0,
          },
          error: null,
          loading: false,
        }}
        rosterConfiguration={null}
        selectedEvent={null}
        subject="Concert announcement"
        timezone="America/New_York"
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(
      <CommunicationReviewDialog
        audience={testAudience}
        busy={false}
        channel="Email"
        contactLists={[]}
        contentMarkdown="Hello world"
        error="Invalid communication context."
        onClose={vi.fn()}
        onSend={vi.fn()}
        open={true}
        reachState={{
          data: {
            audienceOverLimit: false,
            both: 0,
            email: 357,
            sms: 0,
            ticketBuyerPurchasesOverLimit: 0,
            total: 357,
            undeliverableTicketBuyerPurchases: 0,
            unreachable: 0,
          },
          error: null,
          loading: false,
        }}
        rosterConfiguration={null}
        selectedEvent={null}
        subject="Concert announcement"
        timezone="America/New_York"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Invalid communication context.");
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
