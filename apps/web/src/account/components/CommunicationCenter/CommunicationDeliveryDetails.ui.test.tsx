import type {
  CommunicationDeliverySummary,
  CommunicationMessage,
  OrganizationEvent,
} from "@choir/contracts";
import { organizationEventSchema } from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "../../../api/client";
import type * as AuthApi from "../../../auth/api";
import { CommunicationDeliveryDetails } from "./CommunicationDeliveryDetails";
import { defaultAudience } from "./utils";

vi.mock("../../../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthApi>();
  return {
    ...actual,
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
  };
});

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

  it("surfaces bounced and complained issues, marks them reviewed, and fixes emails inline", async () => {
    const user = userEvent.setup();
    const deliveryId = "20000000-0000-4000-8000-000000000001";
    const complaintDeliveryId = "20000000-0000-4000-8000-000000000002";
    const onReviewIssues = vi.fn().mockResolvedValue(undefined);
    const onResolveDeliveryEmail = vi.fn().mockResolvedValue({
      clearedBounceSuppression: true,
      deliveryId,
      email: "fixed@example.test",
      messageId: sampleMessage.id,
      requestId: "00000000-0000-4000-8000-000000000099",
      resent: true,
    });

    const summaryWithIssues: CommunicationDeliverySummary = {
      ...sampleSummary,
      hasMoreIssues: false,
      issues: [
        {
          attempts: 1,
          canEditEmail: true,
          category: "invalid-destination",
          channel: "email",
          deliveryId,
          destination: "typo@example.test",
          failureDetail: "",
          issueKind: "bounced",
          lastSeen: "2026-08-14T18:15:00.000Z",
          providerReason: "550 5.1.1 User unknown",
          providerStatus: "bounced",
          recipientId: "30000000-0000-4000-8000-000000000001",
          recipientKind: "profile",
          recipientName: "Sam Typo",
          status: "sent",
        },
        {
          attempts: 1,
          canEditEmail: false,
          category: "provider-rejected",
          channel: "email",
          deliveryId: complaintDeliveryId,
          destination: "complained@example.test",
          failureDetail: "",
          issueKind: "complained",
          lastSeen: "2026-08-14T18:16:00.000Z",
          providerReason: "Spam complaint",
          providerStatus: "complained",
          recipientId: "30000000-0000-4000-8000-000000000002",
          recipientKind: "contact",
          recipientName: "Pat Complainer",
          status: "sent",
        },
      ],
      issuesReviewedAt: null,
      provider: {
        ...sampleSummary.provider,
        bounced: 1,
        complained: 1,
        total: 3,
      },
      unresolvedIssueCount: 2,
    };

    render(
      <CommunicationDeliveryDetails
        busy={false}
        message={sampleMessage}
        onResolveDeliveryEmail={onResolveDeliveryEmail}
        onRetry={vi.fn()}
        onReviewIssues={onReviewIssues}
        summary={summaryWithIssues}
        timezone="America/New_York"
      />,
    );

    expect(screen.getByText("Delivery issues (2)")).toBeVisible();
    expect(screen.getByText("Sam Typo")).toBeVisible();
    expect(screen.getByText("typo@example.test")).toBeVisible();
    expect(screen.getByText("Bounced")).toBeVisible();
    expect(screen.getByText(/550 5\.1\.1 User unknown/)).toBeVisible();
    expect(screen.getByText("Pat Complainer")).toBeVisible();
    expect(screen.getByText("Complained")).toBeVisible();

    // Snapshot & Recipients collapse by default when unresolved issues exist
    const snapshotDetails = screen.getByText("Message snapshot").closest("details");
    expect(snapshotDetails).not.toHaveAttribute("open");

    // Only the bounced recipient has a Fix email button (not the spam complaint)
    const fixButtons = screen.getAllByRole("button", { name: "Fix email" });
    expect(fixButtons).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Mark issues reviewed" }));
    expect(onReviewIssues).toHaveBeenCalledTimes(1);

    // Open Fix email modal and submit updated address + resend
    const [firstFixButton] = fixButtons;
    expect(firstFixButton).toBeDefined();
    if (!firstFixButton) return;
    await user.click(firstFixButton);
    const emailInput = screen.getByLabelText("Updated email address");
    expect(emailInput).toHaveValue("typo@example.test");
    const resendCheckbox = screen.getByLabelText("Also resend this message to the updated email");
    expect(resendCheckbox).toBeChecked();

    await user.clear(emailInput);
    await user.type(emailInput, "fixed@example.test");
    await user.click(screen.getByRole("button", { name: "Save & resend" }));

    await waitFor(() => {
      expect(onResolveDeliveryEmail).toHaveBeenCalledWith(deliveryId, {
        email: "fixed@example.test",
        resend: true,
      });
    });
  });

  it("displays inline error in Fix email dialog when server rejects duplicate email", async () => {
    const user = userEvent.setup();
    const deliveryId = "20000000-0000-4000-8000-000000000003";
    const onResolveDeliveryEmail = vi
      .fn()
      .mockRejectedValue(
        new AuthApiError(
          "Another contact already uses this email address.",
          409,
          "contact_duplicate_email",
        ),
      );

    const summaryWithBounce: CommunicationDeliverySummary = {
      ...sampleSummary,
      hasMoreIssues: false,
      issues: [
        {
          attempts: 1,
          canEditEmail: true,
          category: "invalid-destination",
          channel: "email",
          deliveryId,
          destination: "typo@example.test",
          failureDetail: "",
          issueKind: "bounced",
          lastSeen: "2026-08-14T18:15:00.000Z",
          providerReason: "Bounce",
          providerStatus: "bounced",
          recipientId: "30000000-0000-4000-8000-000000000003",
          recipientKind: "contact",
          recipientName: "Jordan Bounce",
          status: "sent",
        },
      ],
      issuesReviewedAt: null,
      unresolvedIssueCount: 1,
    };

    render(
      <CommunicationDeliveryDetails
        busy={false}
        message={sampleMessage}
        onResolveDeliveryEmail={onResolveDeliveryEmail}
        onRetry={vi.fn()}
        summary={summaryWithBounce}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fix email" }));
    await user.click(screen.getByLabelText("Also resend this message to the updated email"));
    await user.click(screen.getByRole("button", { name: "Save email" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Another contact already uses this email address.",
      );
    });
    expect(onResolveDeliveryEmail).toHaveBeenCalledWith(deliveryId, {
      email: "typo@example.test",
      resend: false,
    });
  });

  it("supports removing a bounced email address or deleting a standalone contact from Fix email", async () => {
    const user = userEvent.setup();
    const clearDeliveryId = "20000000-0000-4000-8000-000000000010";
    const deleteDeliveryId = "20000000-0000-4000-8000-000000000011";
    const archiveDeliveryId = "20000000-0000-4000-8000-000000000013";
    const removedDeliveryId = "20000000-0000-4000-8000-000000000012";
    const onResolveDeliveryEmail = vi.fn().mockResolvedValue({
      action: "clear_email",
      clearedBounceSuppression: true,
      deliveryId: clearDeliveryId,
      email: null,
      messageId: sampleMessage.id,
      requestId: "00000000-0000-4000-8000-000000000099",
      resent: false,
    });

    const summaryWithOptions: CommunicationDeliverySummary = {
      ...sampleSummary,
      hasMoreIssues: false,
      issues: [
        {
          attempts: 1,
          canClearEmail: true,
          canDeleteContact: true,
          canEditEmail: true,
          category: "invalid-destination",
          channel: "email",
          deliveryId: clearDeliveryId,
          destination: "carol@example.test",
          failureDetail: "",
          issueKind: "bounced",
          lastSeen: "2026-08-14T18:15:00.000Z",
          providerReason: "554 mailbox disabled",
          providerStatus: "bounced",
          recipientId: "30000000-0000-4000-8000-000000000010",
          recipientKind: "contact",
          recipientName: "Carol Ann Family",
          recipientStatus: "active",
          status: "sent",
        },
        {
          attempts: 1,
          canClearEmail: false,
          canDeleteContact: true,
          canEditEmail: true,
          category: "invalid-destination",
          channel: "email",
          deliveryId: deleteDeliveryId,
          destination: "britta@example.test",
          failureDetail: "",
          issueKind: "bounced",
          lastSeen: "2026-08-14T18:16:00.000Z",
          providerReason: "550 5.1.10",
          providerStatus: "bounced",
          recipientId: "30000000-0000-4000-8000-000000000011",
          recipientKind: "contact",
          recipientName: "Britta Sharp",
          recipientStatus: "email_removed",
          status: "sent",
        },
        {
          attempts: 1,
          canArchiveProfile: true,
          canClearEmail: true,
          canDeleteContact: false,
          canEditEmail: true,
          category: "invalid-destination",
          channel: "email",
          deliveryId: archiveDeliveryId,
          destination: "member@example.test",
          failureDetail: "",
          issueKind: "bounced",
          lastSeen: "2026-08-14T18:16:30.000Z",
          providerReason: "550 unknown",
          providerStatus: "bounced",
          recipientId: "30000000-0000-4000-8000-000000000013",
          recipientKind: "profile",
          recipientName: "Morgan Member",
          recipientStatus: "active",
          status: "sent",
        },
        {
          attempts: 1,
          canClearEmail: false,
          canDeleteContact: false,
          canEditEmail: false,
          category: "invalid-destination",
          channel: "email",
          deliveryId: removedDeliveryId,
          destination: "gone@example.test",
          failureDetail: "",
          issueKind: "bounced",
          lastSeen: "2026-08-14T18:17:00.000Z",
          providerReason: "550 unknown",
          providerStatus: "bounced",
          recipientId: "30000000-0000-4000-8000-000000000012",
          recipientKind: "contact",
          recipientName: "Already Removed",
          recipientStatus: "contact_removed",
          status: "sent",
        },
      ],
      issuesReviewedAt: null,
      unresolvedIssueCount: 4,
    };

    render(
      <CommunicationDeliveryDetails
        busy={false}
        message={sampleMessage}
        onResolveDeliveryEmail={onResolveDeliveryEmail}
        onRetry={vi.fn()}
        summary={summaryWithOptions}
      />,
    );

    expect(screen.getByText("Email removed")).toBeVisible();
    expect(screen.getByText("Contact removed")).toBeVisible();

    const fixButtons = screen.getAllByRole("button", { name: "Fix email" });
    expect(fixButtons).toHaveLength(3);
    const [firstFixButton, secondFixButton, thirdFixButton] = fixButtons;
    expect(firstFixButton).toBeDefined();
    expect(secondFixButton).toBeDefined();
    expect(thirdFixButton).toBeDefined();
    if (!firstFixButton || !secondFixButton || !thirdFixButton) return;

    // 1. Remove email address for Carol Ann Family
    await user.click(firstFixButton);
    await user.click(screen.getByLabelText(/Remove email address/));
    await user.click(screen.getByRole("button", { name: "Remove email" }));

    await waitFor(() => {
      expect(onResolveDeliveryEmail).toHaveBeenCalledWith(clearDeliveryId, {
        action: "clear_email",
      });
    });

    // 2. Remove contact for Britta Sharp
    await user.click(secondFixButton);
    expect(screen.queryByLabelText(/Remove email address/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/Remove contact/));
    await user.click(screen.getByRole("button", { name: "Delete contact" }));

    await waitFor(() => {
      expect(onResolveDeliveryEmail).toHaveBeenCalledWith(deleteDeliveryId, {
        action: "delete_contact",
      });
    });

    // 3. Archive Organization Profile for Morgan Member (cannot permanently delete)
    await user.click(thirdFixButton);
    expect(screen.queryByLabelText(/Remove contact/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/Archive Organization Profile/));
    await user.click(screen.getByRole("button", { name: "Archive profile" }));

    await waitFor(() => {
      expect(onResolveDeliveryEmail).toHaveBeenCalledWith(archiveDeliveryId, {
        action: "archive_profile",
      });
    });
  });
});
