import type {
  CommunicationDeliverySummary,
  CommunicationMessage,
  OrganizationEvent,
} from "@choir/contracts";
import { organizationEventSchema } from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { CommunicationDeliveryDetails } from "./CommunicationDeliveryDetails";
import { defaultAudience } from "./utils";

vi.mock("../../../auth/api", () => ({
  getOrganizationCommunicationRecipients: vi.fn().mockResolvedValue({
    nextCursor: null,
    recipients: [
      {
        channel: "email",
        destination: "ada@example.test",
        recipientName: "Ada Lovelace",
        status: "sent",
        providerStatus: "delivered",
      },
    ],
    requestId: "00000000-0000-0000-0000-000000000001",
  }),
}));

const sampleSummary: CommunicationDeliverySummary = {
  email: { failed: 0, processing: 0, queued: 0, sent: 1, suppressed: 0, total: 1 },
  failures: [],
  hasMoreFailures: false,
  lastActivity: "2026-08-14T18:12:00.000Z",
  messageId: "10000000-0000-0000-0000-000000000001",
  provider: {
    accepted: 1,
    bounced: 0,
    complained: 0,
    deferred: 0,
    delivered: 1,
    failed: 0,
    rejected: 0,
    total: 1,
  },
  recipients: [
    {
      channel: "email",
      providerStatus: "delivered",
      recipientName: "Ada Lovelace",
      status: "sent",
    },
  ],
  sms: { failed: 0, processing: 0, queued: 0, sent: 0, suppressed: 0, total: 0 },
  state: "sent",
  total: { failed: 0, processing: 0, queued: 0, sent: 1, suppressed: 0, total: 1 },
};

const sampleMessage: CommunicationMessage = {
  audience: defaultAudience,
  channel: "Email",
  contentMarkdown: "Hello {recipientName}, don't miss our concert!",
  createdAt: "2026-08-14T18:00:00.000Z",
  draftRevision: 1,
  eventPromotion: null,
  id: "10000000-0000-0000-0000-000000000001",
  queuedByName: "Wes Osborn",
  queuedByUserId: "user-1",
  reach: {
    audienceOverLimit: false,
    both: 0,
    email: 1,
    sms: 0,
    ticketBuyerPurchasesOverLimit: 0,
    total: 1,
    undeliverableTicketBuyerPurchases: 0,
    unreachable: 0,
  },
  sentAt: "2026-08-14T18:12:00.000Z",
  status: "Sent",
  subject: "Concert reminder for {recipientName}",
  updatedAt: "2026-08-14T18:12:00.000Z",
};

describe("CommunicationDeliveryDetails", () => {
  it("renders delivery summary and message snapshot expanded by default", async () => {
    render(
      <CommunicationDeliveryDetails
        busy={false}
        message={sampleMessage}
        onRetry={vi.fn()}
        summary={sampleSummary}
      />,
    );

    // Delivery stats
    expect(screen.getByText(/Delivery: sent · 1 sent · 0 failed/)).toBeVisible();
    expect(screen.getByText(/Provider: 1 accepted · 1 delivered/)).toBeVisible();

    // Snapshot details section is present and open
    const snapshotDetails = screen.getByText("Message snapshot").closest("details");
    expect(snapshotDetails).toHaveAttribute("open");

    // Subject populated with recipient name
    expect(screen.getByText("Concert reminder for Ada Lovelace")).toBeVisible();

    // Attribution note
    expect(screen.getByText("Preview snapshot based on Ada Lovelace.")).toBeVisible();

    // Rendered markdown body populated with recipient name
    expect(screen.getByText("Hello Ada Lovelace, don't miss our concert!")).toBeVisible();

    // Recipients list loaded
    await waitFor(() => {
      expect(screen.getByText("Ada Lovelace", { selector: "strong" })).toBeVisible();
    });
  });

  it("renders SMS message snapshot without subject line", async () => {
    const smsMessage: CommunicationMessage = {
      ...sampleMessage,
      channel: "SMS",
      contentMarkdown: "Quick reminder: rehearsal tomorrow!",
      subject: "Ignored SMS Subject",
    };

    render(
      <CommunicationDeliveryDetails
        busy={false}
        message={smsMessage}
        onRetry={vi.fn()}
        summary={sampleSummary}
      />,
    );

    expect(screen.queryByText(/Subject:/)).not.toBeInTheDocument();
    expect(screen.getByText("Quick reminder: rehearsal tomorrow!")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByText("Ada Lovelace", { selector: "strong" })).toBeVisible();
    });
  });

  it("renders fallback message when markdown content is empty", async () => {
    const emptyMessage: CommunicationMessage = {
      ...sampleMessage,
      contentMarkdown: "",
    };

    render(
      <CommunicationDeliveryDetails
        busy={false}
        message={emptyMessage}
        onRetry={vi.fn()}
        summary={sampleSummary}
      />,
    );

    expect(screen.getByText("No message content.")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByText("Ada Lovelace", { selector: "strong" })).toBeVisible();
    });
  });

  it("uses matched event details and branding for placeholders", async () => {
    const eventId = "33333333-3333-4333-8333-333333333333";
    const promoMessage: CommunicationMessage = {
      ...sampleMessage,
      contentMarkdown: "Join {organizationName} at {eventTitle} on {eventDate}!",
      eventPromotion: {
        announcementKind: "initial",
        eventId,
        parentMessageId: null,
      },
      subject: "{eventTitle} tickets on sale now!",
    };

    const mockEvent: OrganizationEvent = organizationEventSchema.parse({
      advancePriceCents: 2000,
      callTime: "18:00",
      createdAt: "2026-08-01T00:00:00.000Z",
      dayOfPriceCents: 2500,
      details: "Annual winter concert",
      doorsOpenTime: "18:30",
      durationMinutes: 120,
      id: eventId,
      isCanceled: false,
      isTicketingEnabled: true,
      location: "Symphony Hall",
      publishOnWebsite: true,
      startsAt: "2026-12-15T19:00:00.000Z",
      title: "Winter Wonderland Gala",
      type: "Performance",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    render(
      <CommunicationDeliveryDetails
        branding={{
          logoFileId: null,
          organizationId: "org-1",
          organizationName: "Metropolitan Chorale",
          physicalAddress: "123 Music Ave",
        }}
        busy={false}
        events={[mockEvent]}
        message={promoMessage}
        onRetry={vi.fn()}
        summary={sampleSummary}
        timezone="America/New_York"
      />,
    );

    expect(screen.getByText("Winter Wonderland Gala tickets on sale now!")).toBeVisible();
    expect(
      screen.getByText(/Join Metropolitan Chorale at Winter Wonderland Gala on December 15, 2026/),
    ).toBeVisible();
    await waitFor(() => {
      expect(screen.getByText("Ada Lovelace", { selector: "strong" })).toBeVisible();
    });
  });
});
