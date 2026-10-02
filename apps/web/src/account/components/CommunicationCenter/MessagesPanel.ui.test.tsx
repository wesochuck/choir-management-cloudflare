import type { CommunicationMessage, CommunicationScheduledMessage } from "@choir/contracts";
import { futureIsoDate } from "@choir/testkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { MessagesPanel } from "./MessagesPanel";
import type { UnifiedCommunicationItem } from "./types";
import { defaultAudience } from "./utils";

const manualDraftMsg: CommunicationMessage = {
  audience: defaultAudience,
  channel: "Email",
  contentMarkdown: "Draft content",
  createdAt: "2026-08-01T10:00:00Z",
  id: "10000000-0000-0000-0000-000000000001",
  reach: {
    both: 0,
    email: 1,
    sms: 0,
    ticketBuyerPurchasesOverLimit: 0,
    total: 1,
    undeliverableTicketBuyerPurchases: 0,
    unreachable: 0,
  },
  sentAt: null,
  status: "Draft",
  subject: "Annual Gala Draft",
  updatedAt: "2026-08-01T10:00:00Z",
};

const manualSentMsg: CommunicationMessage = {
  ...manualDraftMsg,
  id: "10000000-0000-0000-0000-000000000002",
  sentAt: "2026-08-02T10:00:00Z",
  status: "Sent",
  subject: "Rehearsal Update",
};

const manualFailedMsg: CommunicationMessage = {
  ...manualDraftMsg,
  id: "10000000-0000-0000-0000-000000000003",
  sentAt: "2026-08-03T10:00:00Z",
  status: "Failed",
  subject: "Urgent Alert Failed",
};

const manualCanceledMsg: CommunicationMessage = {
  ...manualDraftMsg,
  id: "10000000-0000-0000-0000-000000000004",
  sentAt: null,
  status: "Canceled",
  subject: "Weather Notice Canceled",
};

const automatedScheduledMsg: CommunicationScheduledMessage = {
  eventId: null,
  eventTitle: "Fall Concert",
  id: "20000000-0000-0000-0000-000000000001",
  kind: "ticket_reminder",
  recipientCount: 15,
  scheduledAt: "2026-08-10T12:00:00Z",
  status: "Scheduled",
  subject: "Automated Ticket Reminder",
};

const automatedSentMsg: CommunicationScheduledMessage = {
  ...automatedScheduledMsg,
  id: "20000000-0000-0000-0000-000000000002",
  status: "Sent",
  subject: "Automated Audition Confirmation",
};

const automatedFailedMsg: CommunicationScheduledMessage = {
  ...automatedScheduledMsg,
  id: "20000000-0000-0000-0000-000000000003",
  status: "Failed",
  subject: "Automated Attendance Report",
};

const allUnifiedMessages: readonly UnifiedCommunicationItem[] = [
  {
    automated: false,
    channel: "Email",
    id: manualDraftMsg.id,
    kind: "manual",
    message: manualDraftMsg,
    recipientCount: 1,
    status: "Draft",
    timestamp: manualDraftMsg.createdAt,
    title: manualDraftMsg.subject,
  },
  {
    automated: false,
    channel: "Email",
    id: manualSentMsg.id,
    kind: "manual",
    message: manualSentMsg,
    recipientCount: 1,
    status: "Sent",
    timestamp: manualSentMsg.sentAt ?? "",
    title: manualSentMsg.subject,
  },
  {
    automated: false,
    channel: "Email",
    id: manualFailedMsg.id,
    kind: "manual",
    message: manualFailedMsg,
    recipientCount: 1,
    status: "Failed",
    timestamp: manualFailedMsg.sentAt ?? "",
    title: manualFailedMsg.subject,
  },
  {
    automated: false,
    channel: "Email",
    id: manualCanceledMsg.id,
    kind: "manual",
    message: manualCanceledMsg,
    recipientCount: 1,
    status: "Canceled",
    timestamp: manualCanceledMsg.createdAt,
    title: manualCanceledMsg.subject,
  },
  {
    automated: true,
    channel: "Email",
    id: automatedScheduledMsg.id,
    kind: "scheduled",
    recipientCount: 15,
    scheduledMessage: automatedScheduledMsg,
    status: "Scheduled",
    timestamp: automatedScheduledMsg.scheduledAt,
    title: automatedScheduledMsg.subject,
  },
  {
    automated: true,
    channel: "Email",
    id: automatedSentMsg.id,
    kind: "scheduled",
    recipientCount: 15,
    scheduledMessage: automatedSentMsg,
    status: "Sent",
    timestamp: automatedSentMsg.scheduledAt,
    title: automatedSentMsg.subject,
  },
  {
    automated: true,
    channel: "Email",
    id: automatedFailedMsg.id,
    kind: "scheduled",
    recipientCount: 15,
    scheduledMessage: automatedFailedMsg,
    status: "Failed",
    timestamp: automatedFailedMsg.scheduledAt,
    title: automatedFailedMsg.subject,
  },
];

describe("MessagesPanel UI", () => {
  it("renders distinct Status and Type filter groups with accessible labels and aria-pressed attributes", () => {
    render(
      <MessagesPanel
        busy={false}
        currentOrigin="all"
        currentStatus="all"
        deliveryDetailsMessage={null}
        deliverySummary={null}
        loadingDeliveryId={null}
        onCancelQueued={vi.fn()}
        onDeleteDraft={vi.fn()}
        onNewMessage={vi.fn()}
        onOpenDeliveryDetails={vi.fn()}
        onOriginFilterChange={vi.fn()}
        onResumeDraft={vi.fn()}
        onRetryDeliveries={vi.fn()}
        onStatusFilterChange={vi.fn()}
        unifiedMessages={allUnifiedMessages}
      />,
    );

    // Group labels
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();

    // Check aria-pressed
    const statusAllBtn = screen.getByRole("button", { name: "All" });
    const typeAllBtn = screen.getByRole("button", { name: "All messages" });
    expect(statusAllBtn).toHaveAttribute("aria-pressed", "true");
    expect(typeAllBtn).toHaveAttribute("aria-pressed", "true");

    const sentBtn = screen.getByRole("button", { name: "Sent" });
    expect(sentBtn).toHaveAttribute("aria-pressed", "false");

    // All messages visible
    expect(screen.getByText("Annual Gala Draft")).toBeInTheDocument();
    expect(screen.getByText("Rehearsal Update")).toBeInTheDocument();
    expect(screen.getByText("Urgent Alert Failed")).toBeInTheDocument();
    expect(screen.getByText("Weather Notice Canceled")).toBeInTheDocument();
    expect(screen.getByText("Automated Ticket Reminder")).toBeInTheDocument();
    expect(screen.getByText("Automated Audition Confirmation")).toBeInTheDocument();
    expect(screen.getByText("Automated Attendance Report")).toBeInTheDocument();
  });

  it("handles filter button clicks independently and preserves counterpart filter", async () => {
    const user = userEvent.setup();
    const onStatusFilterChange = vi.fn();
    const onOriginFilterChange = vi.fn();

    render(
      <MessagesPanel
        busy={false}
        currentOrigin="manual"
        currentStatus="sent"
        deliveryDetailsMessage={null}
        deliverySummary={null}
        loadingDeliveryId={null}
        onCancelQueued={vi.fn()}
        onDeleteDraft={vi.fn()}
        onNewMessage={vi.fn()}
        onOpenDeliveryDetails={vi.fn()}
        onOriginFilterChange={onOriginFilterChange}
        onResumeDraft={vi.fn()}
        onRetryDeliveries={vi.fn()}
        onStatusFilterChange={onStatusFilterChange}
        unifiedMessages={[]}
      />,
    );

    const sentBtn = screen.getByRole("button", { name: "Sent" });
    const manualBtn = screen.getByRole("button", { name: "Manual" });
    expect(sentBtn).toHaveAttribute("aria-pressed", "true");
    expect(manualBtn).toHaveAttribute("aria-pressed", "true");

    // Click Scheduled
    const scheduledBtn = screen.getByRole("button", { name: "Scheduled" });
    await user.click(scheduledBtn);
    expect(onStatusFilterChange).toHaveBeenCalledWith("scheduled");

    // Click Automated
    const automatedBtn = screen.getByRole("button", { name: "Automated" });
    await user.click(automatedBtn);
    expect(onOriginFilterChange).toHaveBeenCalledWith("automated");
  });

  it("displays customized empty state for combinations", () => {
    const { rerender } = render(
      <MessagesPanel
        busy={false}
        currentOrigin="all"
        currentStatus="all"
        deliveryDetailsMessage={null}
        deliverySummary={null}
        loadingDeliveryId={null}
        onCancelQueued={vi.fn()}
        onDeleteDraft={vi.fn()}
        onNewMessage={vi.fn()}
        onOpenDeliveryDetails={vi.fn()}
        onOriginFilterChange={vi.fn()}
        onResumeDraft={vi.fn()}
        onRetryDeliveries={vi.fn()}
        onStatusFilterChange={vi.fn()}
        unifiedMessages={[]}
      />,
    );

    expect(screen.getByText("No messages found.")).toBeInTheDocument();

    rerender(
      <MessagesPanel
        busy={false}
        currentOrigin="automated"
        currentStatus="sent"
        deliveryDetailsMessage={null}
        deliverySummary={null}
        loadingDeliveryId={null}
        onCancelQueued={vi.fn()}
        onDeleteDraft={vi.fn()}
        onNewMessage={vi.fn()}
        onOpenDeliveryDetails={vi.fn()}
        onOriginFilterChange={vi.fn()}
        onResumeDraft={vi.fn()}
        onRetryDeliveries={vi.fn()}
        onStatusFilterChange={vi.fn()}
        unifiedMessages={[]}
      />,
    );
    expect(screen.getByText("No sent automated messages found.")).toBeInTheDocument();

    rerender(
      <MessagesPanel
        busy={false}
        currentOrigin="manual"
        currentStatus="failed"
        deliveryDetailsMessage={null}
        deliverySummary={null}
        loadingDeliveryId={null}
        onCancelQueued={vi.fn()}
        onDeleteDraft={vi.fn()}
        onNewMessage={vi.fn()}
        onOpenDeliveryDetails={vi.fn()}
        onOriginFilterChange={vi.fn()}
        onResumeDraft={vi.fn()}
        onRetryDeliveries={vi.fn()}
        onStatusFilterChange={vi.fn()}
        unifiedMessages={[]}
      />,
    );
    expect(screen.getByText("No failed manual messages found.")).toBeInTheDocument();

    rerender(
      <MessagesPanel
        busy={false}
        currentOrigin="all"
        currentStatus="draft"
        deliveryDetailsMessage={null}
        deliverySummary={null}
        loadingDeliveryId={null}
        onCancelQueued={vi.fn()}
        onDeleteDraft={vi.fn()}
        onNewMessage={vi.fn()}
        onOpenDeliveryDetails={vi.fn()}
        onOriginFilterChange={vi.fn()}
        onResumeDraft={vi.fn()}
        onRetryDeliveries={vi.fn()}
        onStatusFilterChange={vi.fn()}
        unifiedMessages={[]}
      />,
    );
    expect(screen.getByText("No drafts found.")).toBeInTheDocument();
  });
});

it("labels upcoming previews with the Organization timezone and event navigation", () => {
  const scheduledMessage: CommunicationScheduledMessage = {
    ...automatedScheduledMsg,
    id: `planned:event-reminder:${automatedScheduledMsg.id}`,
    scheduledAt: futureIsoDate({ days: 10 }),
    projected: true,
    timezone: "America/New_York",
    eventId: "12345678-1234-4234-8234-123456789012",
  };
  render(
    <MessagesPanel
      busy={false}
      currentOrigin="all"
      currentStatus="scheduled"
      deliveryDetailsMessage={null}
      deliverySummary={null}
      loadingDeliveryId={null}
      onCancelQueued={vi.fn()}
      onDeleteDraft={vi.fn()}
      onNewMessage={vi.fn()}
      onOpenDeliveryDetails={vi.fn()}
      onOriginFilterChange={vi.fn()}
      onResumeDraft={vi.fn()}
      onRetryDeliveries={vi.fn()}
      onStatusFilterChange={vi.fn()}
      unifiedMessages={[
        {
          automated: true,
          channel: "Email",
          id: scheduledMessage.id,
          kind: "scheduled",
          recipientCount: null,
          scheduledMessage,
          status: "Scheduled",
          timestamp: scheduledMessage.scheduledAt,
          title: scheduledMessage.subject,
        },
      ]}
    />,
  );
  expect(screen.getByText(/Scheduled for.*America\/New_York/)).toBeVisible();
  expect(screen.getByText(/Automation preview. Recipients/)).toBeVisible();
  expect(screen.getByText(/next 90 days/)).toBeVisible();
  expect(screen.getByRole("link", { name: "View event" })).toHaveAttribute(
    "href",
    "/admin/rsvp?eventId=12345678-1234-4234-8234-123456789012",
  );
});
