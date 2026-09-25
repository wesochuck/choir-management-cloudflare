import { act, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicDonationReceiptResponse } from "@choir/contracts";

import * as api from "../api";
import { PublicDonationSuccessView } from "./PublicDonationSuccessView";

vi.mock("../api", () => ({
  getPublicDonationReceipt: vi.fn(),
  getPublicDonationSettings: vi.fn(),
}));

function makeReceipt(
  overrides: Partial<PublicDonationReceiptResponse> = {},
): PublicDonationReceiptResponse {
  return {
    amountCents: 100,
    anonymous: false,
    buyerEmail: "donor@example.test",
    buyerName: "Alex Donor",
    createdAt: "2026-09-22T12:00:00.000Z",
    expiredAt: null,
    feeCents: 0,
    id: "22222222-2222-4222-8222-222222222222",
    marketingConsent: false,
    patronId: null,
    paymentMethod: "stripe",
    paymentReference: "",
    processorFeeCents: null,
    processorFeeReconciledAt: null,
    providerBalanceTransactionId: null,
    refundRequested: false,
    requestId: "33333333-3333-4333-8333-333333333333",
    status: "paid",
    thankYouSentAt: null,
    tributeName: "",
    tributeNotifyEmail: "",
    tributeType: "none",
    updatedAt: "2026-09-22T12:00:00.000Z",
    ...overrides,
  };
}

describe("PublicDonationSuccessView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState({}, "", "/donate/success?token=receipt-token");
    vi.mocked(api.getPublicDonationReceipt).mockResolvedValue(makeReceipt());
    vi.mocked(api.getPublicDonationSettings).mockResolvedValue({
      buttonText: "Support our Music",
      description: "",
      levels: [],
      thankYouMessage: "Your generosity keeps our music going.",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("labels the gift amount, separates donor-paid fees, and shows the Organization thank-you message", async () => {
    vi.mocked(api.getPublicDonationReceipt).mockResolvedValue(
      makeReceipt({
        amountCents: 2_500,
        feeCents: 103,
        status: "paid",
      }),
    );
    render(<PublicDonationSuccessView />);

    expect(await screen.findByRole("heading", { name: "Thank you for your gift!" })).toBeVisible();
    const summary = screen.getByRole("region", { name: "Gift summary" });
    expect(within(summary).getByText("Donation amount")).toBeInTheDocument();
    expect(within(summary).getByText("$25.00")).toBeInTheDocument();
    expect(within(summary).getByText("Processing fee")).toBeInTheDocument();
    expect(within(summary).getByText("$1.03")).toBeInTheDocument();
    expect(within(summary).getByText("Total charged")).toBeInTheDocument();
    expect(within(summary).getByText("$26.03")).toBeInTheDocument();
    expect(screen.getByText("Your gift").nextElementSibling).toHaveTextContent("$25.00");
    expect(screen.getByText("Your generosity keeps our music going.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "We’ll email a donation receipt to donor@example.test.",
    );
  });

  it("omits a zero processing-fee row and shows date, donor, tribute, and anonymity details accessibly", async () => {
    vi.mocked(api.getPublicDonationReceipt).mockResolvedValue(
      makeReceipt({
        anonymous: true,
        buyerName: "Private Donor",
        tributeName: "Jane Smith",
        tributeType: "memory",
      }),
    );
    const { container } = render(<PublicDonationSuccessView />);

    expect(await screen.findByRole("heading", { name: "Thank you for your gift!" })).toBeVisible();
    const summary = screen.getByRole("region", { name: "Gift summary" });
    expect(within(summary).queryByText("Processing fee")).not.toBeInTheDocument();
    expect(within(summary).getByText("Gift date")).toBeInTheDocument();

    const details = screen.getByRole("region", { name: "Gift details" });
    expect(within(details).getByText("Private Donor")).toBeInTheDocument();
    expect(within(details).getByText("donor@example.test")).toBeInTheDocument();
    expect(within(details).getByText("In memory of Jane Smith")).toBeInTheDocument();
    expect(
      within(details).getByText("Your name will be hidden from public donor recognition."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelector(".public-donation-receipt__mark")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it.each([
    ["pending", "We're confirming your donation", "Your payment is still processing."],
    ["refunded", "Donation refunded", "This donation has been refunded."],
    ["expired", "Donation not completed", "The checkout expired and no payment was taken."],
  ] as const)(
    "presents the %s state without a paid success treatment",
    async (status, heading, message) => {
      vi.mocked(api.getPublicDonationReceipt).mockResolvedValue(makeReceipt({ status }));
      const { container } = render(<PublicDonationSuccessView />);

      expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
      expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
      expect(screen.queryByText("Donation complete")).not.toBeInTheDocument();
      expect(container.querySelector(".public-donation-receipt__mark")).not.toBeInTheDocument();
      expect(container.firstElementChild).toHaveClass(`public-donation-receipt--${status}`);
    },
  );

  it("polls pending receipts until the authoritative status changes, then stops", async () => {
    vi.useFakeTimers();
    vi.mocked(api.getPublicDonationReceipt)
      .mockResolvedValueOnce(makeReceipt({ status: "pending" }))
      .mockResolvedValueOnce(makeReceipt({ status: "paid" }));
    render(<PublicDonationSuccessView />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/Your payment is still processing/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByRole("heading", { name: "Thank you for your gift!" })).toBeVisible();
    expect(api.getPublicDonationReceipt).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.getPublicDonationReceipt).toHaveBeenCalledTimes(2);
  });

  it("stops polling after the bounded pending timeout and keeps the status truthful", async () => {
    vi.useFakeTimers();
    vi.mocked(api.getPublicDonationReceipt).mockResolvedValue(makeReceipt({ status: "pending" }));
    render(<PublicDonationSuccessView />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });

    expect(screen.getByText(/Payment is taking longer than usual/)).toBeInTheDocument();
    expect(screen.getByText("Payment processing")).toBeInTheDocument();
    const callCountAtTimeout = vi.mocked(api.getPublicDonationReceipt).mock.calls.length;
    expect(callCountAtTimeout).toBeGreaterThan(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.getPublicDonationReceipt).toHaveBeenCalledTimes(callCountAtTimeout);
  });

  it("aborts the receipt request and clears pending polling when unmounted", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.mocked(api.getPublicDonationReceipt).mockImplementation((_token, signal) => {
      requestSignal = signal;
      return Promise.resolve(makeReceipt({ status: "pending" }));
    });
    const { unmount } = render(<PublicDonationSuccessView />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(requestSignal?.aborted).toBe(false);
    unmount();
    expect(requestSignal?.aborted).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.getPublicDonationReceipt).toHaveBeenCalledTimes(1);
  });
});
