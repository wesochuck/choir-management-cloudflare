import { act, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicTicketReceipt, PublishedOrganizationProjection } from "@choir/contracts";
import type * as AuthApiModule from "../auth/api";
import {
  AuthApiError,
  getPublicTicketConfirmationSettings,
  getPublicTicketPurchase,
} from "../auth/api";
import { TicketReceipt } from "./PublicTickets";

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthApiModule>();
  return {
    ...actual,
    createPublicTicketCheckout: vi.fn(),
    getPublicCommerceProjection: vi.fn().mockResolvedValue(null),
    getPublicTicketConfirmationSettings: vi.fn(),
    getPublicTicketDiscountAvailability: vi.fn().mockResolvedValue({ hasRedeemableCode: false }),
    getPublicTicketPurchase: vi.fn(),
    getPublicTransactionFeeSettings: vi.fn(),
    getPublishedOrganizationProjection: vi.fn().mockResolvedValue(null),
    quotePublicTicketCheckout: vi.fn(),
  };
});

describe("TicketReceipt", () => {
  const baseSampleReceipt: PublicTicketReceipt = {
    amountPaidCents: 2000,
    bundleId: null,
    bundleTitle: "",
    buyerName: "Jane Doe",
    checkoutMode: "stripe",
    currency: "usd",
    discountAmountCents: 0,
    discountCode: null,
    discountType: null,
    discountValue: null,
    discountedSubtotalCents: 0,
    eventId: "11111111-1111-4111-8111-111111111111",
    eventStartsAt: "2026-10-15T19:30:00Z",
    eventTitle: "Spring Concert",
    feeCents: 100,
    id: "22222222-2222-4222-8222-222222222222",
    includedEvents: [],
    location: "Main Auditorium",
    originalSubtotalCents: 1900,
    originalUnitPriceCents: 1900,
    quantity: 1,
    requestId: "33333333-3333-4333-8333-333333333333",
    scanToken: null,
    status: "pending",
    timezone: "America/New_York",
    unitPriceCents: 1900,
    venueAddress: "123 Concert Hall Way, New York, NY 10001",
    venueName: "Symphony Hall",
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.mocked(getPublicTicketConfirmationSettings).mockResolvedValue({
      admissionInstructions: "Keep this confirmation available on your phone.",
      pendingMessage: "Order processing message.",
      qrCodeInstructions: "Show this QR code at the door.",
      successMessage: "Order success message.",
      willCallInstructions: "Pick up at will call.",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("automatically transitions pending -> pending -> paid and stops polling after paid", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    const paidReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: "credential.token.123",
      status: "paid",
    };

    vi.mocked(getPublicTicketPurchase)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(paidReceipt);

    render(<TicketReceipt token="tok-1" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();
    expect(screen.getByText("Order processing message.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Refund summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Refund complete" })).not.toBeInTheDocument();
    expect(screen.queryByText("Door credential")).not.toBeInTheDocument();
    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();
    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole("heading", { name: "Your tickets are confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Order success message.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Refund summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Refund complete" })).not.toBeInTheDocument();
    vi.useRealTimers();
    expect(await screen.findByRole("img", { name: /Admission QR code/ })).toBeInTheDocument();
    const ticketCard = screen.getByRole("article", { name: "Ticket admission credential" });
    expect(within(ticketCard).getByRole("heading", { name: "Your ticket" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your bundle pass" })).not.toBeInTheDocument();
    expect(screen.queryByText("credential.token.123")).not.toBeInTheDocument();
    expect(screen.queryByText("Manual credential")).not.toBeInTheDocument();
    expect(screen.getAllByText("Symphony Hall").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/123 Concert Hall Way/).length).toBeGreaterThanOrEqual(1);
    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(3);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(3);
  });

  it("automatically transitions pending -> refunded, stops polling, and displays refunded state", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    const refundedReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "refunded",
    };

    vi.mocked(getPublicTicketPurchase)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(refundedReceipt);

    render(<TicketReceipt token="tok-refund" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole("heading", { name: "Refund complete" })).toBeInTheDocument();
    expect(screen.getByText("Your ticket order has been refunded.")).toBeInTheDocument();
    expect(screen.getByText("This ticket is no longer valid for admission.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Refund summary" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Admission QR code/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Refund processed")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(2);
  });

  it("automatically transitions pending -> expired, stops polling, and displays expired state", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    const expiredReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "expired",
    };

    vi.mocked(getPublicTicketPurchase)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(expiredReceipt);

    render(<TicketReceipt token="tok-expire" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole("heading", { name: "Ticket order expired" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Refund summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Refund complete" })).not.toBeInTheDocument();
    expect(
      screen.getByText("This ticket order has expired because payment was not completed."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Admission QR code/ })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(2);
  });

  it("cancels polling on unmount", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValue(pendingReceipt);

    const { unmount } = render(<TicketReceipt token="tok-unmount" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(1);
  });

  it("treats 404 as unavailable and does not repeatedly poll", async () => {
    vi.mocked(getPublicTicketPurchase).mockRejectedValue(
      new AuthApiError("Ticket order not found.", 404, "not_found"),
    );

    render(<TicketReceipt token="tok-invalid" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("This ticket receipt is unavailable.")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(1);
  });

  it("recovers from transient network or 5xx errors while polling", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    const paidReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: "recovered.token",
      status: "paid",
    };

    vi.mocked(getPublicTicketPurchase)
      .mockResolvedValueOnce(pendingReceipt)
      .mockRejectedValueOnce(new AuthApiError("Internal error", 503, "ticket_order_unavailable"))
      .mockResolvedValueOnce(paidReceipt);

    render(<TicketReceipt token="tok-recover" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    // Second call fails with 503
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // Pending receipt remains visible despite transient error
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    // Third call succeeds with paid
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("heading", { name: "Your tickets are confirmed" })).toBeInTheDocument();
    vi.useRealTimers();
    expect(await screen.findByRole("img", { name: /Admission QR code/ })).toBeInTheDocument();
    expect(screen.queryByText("recovered.token")).not.toBeInTheDocument();
  });

  it("leaves pending receipt visible with manual retry action upon poll timeout", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValue(pendingReceipt);

    render(<TicketReceipt token="tok-timeout" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    // Advance beyond the 45-second timeout window
    await act(async () => {
      await vi.advanceTimersByTimeAsync(46000);
    });

    // Receipt details remain visible
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Spring Concert")).toBeInTheDocument();
    expect(
      screen.getByText(
        "We are still waiting for confirmation from the payment provider. Your order details are below.",
      ),
    ).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Check status again" });
    expect(retryButton).toBeInTheDocument();

    // Clicking retry starts a new check
    const callsBefore = vi.mocked(getPublicTicketPurchase).mock.calls.length;
    await act(async () => {
      retryButton.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(vi.mocked(getPublicTicketPurchase).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("does not display QR code or scan credential until paid response includes scanToken", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValueOnce(pendingReceipt);

    render(<TicketReceipt token="tok-cred" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("img", { name: /Admission QR code/ })).not.toBeInTheDocument();
    expect(screen.queryByText("credential.token.123")).not.toBeInTheDocument();
  });

  it("shows a bundle pass QR with the full included-concert context and a separate summary", async () => {
    const bundleReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      bundleId: "bundle-1",
      bundleTitle: "Choral Subscription 2026",
      includedEvents: [
        {
          id: "event-b",
          location: "Hall",
          startsAt: "2026-12-05T19:00:00Z",
          title: "Concert B",
          venueAddress: "200 State St",
          venueName: "Cathedral Hall",
        },
        {
          id: "event-a",
          location: "Chapel",
          startsAt: "2026-11-01T19:00:00Z",
          title: "Concert A",
          venueAddress: "100 Church St",
          venueName: "Grace Chapel",
        },
      ],
      scanToken: "bundle.scan.token",
      status: "paid",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValueOnce(bundleReceipt);

    render(<TicketReceipt token="tok-bundle" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const passCard = screen.getByRole("article", { name: "Bundle pass admission credential" });
    expect(within(passCard).getByRole("heading", { name: "Your bundle pass" })).toBeInTheDocument();
    expect(
      within(passCard).getByRole("heading", { level: 3, name: "Choral Subscription 2026" }),
    ).toBeInTheDocument();
    expect(within(passCard).getByText("2", { selector: "strong" })).toBeInTheDocument();
    expect(within(passCard).getByText(/^Includes/, { selector: "p" })).toHaveTextContent(
      "Includes 2 concerts",
    );
    vi.useRealTimers();
    expect(
      await within(passCard).findByRole("img", {
        name: "Bundle pass QR code for Choral Subscription 2026; valid for all 2 included concerts",
      }),
    ).toBeInTheDocument();
    expect(
      within(passCard).getByText(/This same pass QR code is valid for every included concert\./),
    ).toBeInTheDocument();

    const concertHeadings = within(passCard).getAllByRole("heading", { level: 4 });
    expect(concertHeadings.map((heading) => heading.textContent)).toEqual([
      "Concert A",
      "Concert B",
    ]);
    expect(within(passCard).getByText("Grace Chapel")).toBeInTheDocument();
    expect(within(passCard).getByText("100 Church St")).toBeInTheDocument();
    expect(within(passCard).getByText("Cathedral Hall")).toBeInTheDocument();
    expect(within(passCard).getByText("200 State St")).toBeInTheDocument();

    const summary = screen.getByLabelText("Purchase summary");
    expect(within(summary).getByRole("heading", { name: "Purchase summary" })).toBeInTheDocument();
    expect(within(summary).getByText("Jane Doe")).toBeInTheDocument();
    expect(within(summary).getByText("Quantity:").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("Total:").parentElement).toHaveTextContent("$20.00");
    expect(within(summary).queryByRole("list")).not.toBeInTheDocument();
    expect(within(summary).queryByText("Concert A")).not.toBeInTheDocument();
    expect(within(summary).queryByText("Concert B")).not.toBeInTheDocument();
    expect(screen.getAllByText("Choral Subscription 2026")).toHaveLength(1);
  });

  it("shows normalized shared bundle venue details once", async () => {
    const bundleReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      bundleId: "bundle-1",
      bundleTitle: "Choral Subscription 2026",
      includedEvents: [
        {
          id: "event-a",
          location: "Grace Chapel",
          startsAt: "2026-11-01T19:00:00Z",
          title: "Concert A",
          venueAddress: " 100 Church St ",
          venueName: " Grace Chapel ",
        },
        {
          id: "event-b",
          location: "100 Church St",
          startsAt: "2026-12-05T19:00:00Z",
          title: "Concert B",
          venueAddress: "",
          venueName: "Grace Chapel",
        },
      ],
      scanToken: "bundle.scan.token",
      status: "paid",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValueOnce(bundleReceipt);

    render(<TicketReceipt token="tok-bundle-shared-venue" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const passCard = screen.getByRole("article", { name: "Bundle pass admission credential" });
    expect(within(passCard).getAllByText("Grace Chapel")).toHaveLength(1);
    expect(within(passCard).getAllByText("100 Church St")).toHaveLength(1);
    expect(within(passCard).getAllByRole("link", { name: "View on Google Maps" })).toHaveLength(1);
  });

  it("keeps the bundle pass QR hidden while payment is pending", async () => {
    const pendingBundleReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      bundleId: "bundle-1",
      bundleTitle: "Choral Subscription 2026",
      includedEvents: [
        {
          id: "event-a",
          location: "Chapel",
          startsAt: "2026-11-01T19:00:00Z",
          title: "Concert A",
          venueAddress: "100 Church St",
          venueName: "Grace Chapel",
        },
      ],
      scanToken: null,
      status: "pending",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValueOnce(pendingBundleReceipt);

    render(<TicketReceipt token="tok-pending-bundle" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const passCard = screen.getByRole("article", { name: "Bundle pass admission credential" });
    expect(within(passCard).getByRole("heading", { name: "Your bundle pass" })).toBeInTheDocument();
    expect(within(passCard).getByText("Concert A")).toBeInTheDocument();
    expect(
      within(passCard).queryByRole("img", { name: /Bundle pass QR code/ }),
    ).not.toBeInTheDocument();
    expect(within(passCard).queryByText("bundle.scan.token")).not.toBeInTheDocument();
    expect(
      within(passCard).queryByText(/This same pass QR code is valid for every included concert/),
    ).not.toBeInTheDocument();
  });

  it("renders event graphic in order summary when projection contains performance artwork", async () => {
    const paidReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      eventId: "11111111-1111-4111-8111-111111111111",
      scanToken: "credential.token.123",
      status: "paid",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValueOnce(paidReceipt);

    const projectionWithArtwork: PublishedOrganizationProjection = {
      generatedAt: "2026-10-01T00:00:00Z",
      organizationId: "sample-org",
      payload: {
        mediaFileIds: ["art-file-123"],
        organizationName: "Sample Choir",
        performances: [
          {
            advancePriceCents: 2000,
            dayOfPriceCents: 2500,
            doorsOpenTime: "19:00",
            graphicFileId: "art-file-123",
            id: "11111111-1111-4111-8111-111111111111",
            isTicketingEnabled: true,
            location: "Main Auditorium",
            publicDetails: "",
            startsAt: "2026-10-15T19:30:00Z",
            ticketCapacity: 100,
            title: "Spring Concert",
            venueAddress: "",
            venueName: "Symphony Hall",
          },
        ],
        settings: {
          aboutUsText: "",
          bodyFont: "system",
          contactEmail: "",
          enabledNavigation: ["tickets"],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "Sample Choir",
          heroSubtitle: "",
          historyText: "",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
        ticketBundles: [],
        timezone: "America/New_York",
      },
      version: 2,
    };

    render(<TicketReceipt projection={projectionWithArtwork} token="tok-art" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const graphic = screen.getByAltText("Spring Concert");
    expect(graphic).toHaveAttribute("src", "/api/public/media/2/art-file-123");
    expect(graphic).toHaveClass("ticket-receipt-graphic__image");
  });

  it("renders bundle graphic in order summary when receipt is a bundle purchase with bundle artwork", async () => {
    const paidBundleReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      bundleId: "bundle-artwork-1",
      bundleTitle: "Choral Subscription 2026",
      includedEvents: [
        {
          id: "event-a",
          location: "Chapel",
          startsAt: "2026-11-01T19:00:00Z",
          title: "Concert A",
          venueAddress: "100 Church St",
          venueName: "Grace Chapel",
        },
      ],
      scanToken: "bundle.scan.token",
      status: "paid",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValueOnce(paidBundleReceipt);

    const projectionWithArtwork: PublishedOrganizationProjection = {
      generatedAt: "2026-10-01T00:00:00Z",
      organizationId: "sample-org",
      payload: {
        mediaFileIds: ["bundle-art-file-456"],
        organizationName: "Sample Choir",
        performances: [],
        settings: {
          aboutUsText: "",
          bodyFont: "system",
          contactEmail: "",
          enabledNavigation: ["tickets"],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "Sample Choir",
          heroSubtitle: "",
          historyText: "",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
        ticketBundles: [
          {
            capacity: 50,
            eventIds: ["event-a"],
            graphicFileId: "bundle-art-file-456",
            id: "bundle-artwork-1",
            priceCents: 5000,
            saleEndAt: "2026-12-01T00:00:00Z",
            title: "Choral Subscription 2026",
          },
        ],
        timezone: "America/New_York",
      },
      version: 5,
    };

    render(<TicketReceipt projection={projectionWithArtwork} token="tok-bundle-art" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const graphic = screen.getByAltText("Choral Subscription 2026");
    expect(graphic).toHaveAttribute("src", "/api/public/media/5/bundle-art-file-456");
    expect(graphic).toHaveClass("ticket-receipt-graphic__image");
  });
});
