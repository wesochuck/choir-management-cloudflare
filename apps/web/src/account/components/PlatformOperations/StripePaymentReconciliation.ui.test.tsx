import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlatformStripeReconciliationPreviewResponse } from "@choir/contracts";
import * as platformApi from "../../../api/platform";
import { StripePaymentReconciliation } from "./StripePaymentReconciliation";

vi.mock("../../../api/platform", () => ({
  applyPlatformStripeReconciliation: vi.fn(),
  previewPlatformStripeReconciliation: vi.fn(),
}));

const mockPreviewResponse: PlatformStripeReconciliationPreviewResponse = {
  accountId: "acct_test",
  hasMore: false,
  manualReviewCount: 0,
  matchedCount: 1,
  organizationId: "org_test",
  repairableCount: 1,
  requestId: "req_test",
  rows: [
    {
      classification: "refund_and_fee_mismatch",
      createdAt: "2026-02-15T12:00:00.000Z",
      currency: "usd",
      localAmountCents: 5000,
      localPaymentAttemptStatus: "paid",
      localProcessorFeeCents: null,
      localProviderBalanceTransactionId: null,
      localResourceStatus: "paid",
      manualReviewReason:
        "Stripe was fully refunded ($50.00) but local record is still paid. Processor fee $1.75 missing.",
      paymentType: "ticket",
      proposedActions: ["mark_refunded", "backfill_fee"],
      providerPaymentId: "pi_12345",
      resourceId: "ticket_1",
      safeToApply: true,
      stripeAmountChargedCents: 5000,
      stripeAmountRefundedCents: 5000,
      stripeFullyRefunded: true,
      stripeProcessorFeeCents: 175,
      stripeProviderBalanceTransactionId: "txn_1",
      stripeRefundCompletedAt: "2026-02-16T10:00:00.000Z",
      stripeStatus: "fully_refunded",
    },
    {
      classification: "matched",
      createdAt: "2026-02-15T12:00:00.000Z",
      currency: "usd",
      localAmountCents: 7500,
      localPaymentAttemptStatus: "paid",
      localProcessorFeeCents: 248,
      localProviderBalanceTransactionId: "txn_2",
      localResourceStatus: "paid",
      manualReviewReason: null,
      paymentType: "ticket",
      proposedActions: [],
      providerPaymentId: "pi_67890",
      resourceId: "ticket_2",
      safeToApply: false,
      stripeAmountChargedCents: 7500,
      stripeAmountRefundedCents: 0,
      stripeFullyRefunded: false,
      stripeProcessorFeeCents: 248,
      stripeProviderBalanceTransactionId: "txn_2",
      stripeRefundCompletedAt: null,
      stripeStatus: "paid",
    },
  ],
  scannedCount: 2,
};

describe("StripePaymentReconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders heading, description, and preview button", () => {
    render(<StripePaymentReconciliation canEdit={false} organizationId="org_test" />);

    expect(screen.getByText("Stripe payment reconciliation")).toBeInTheDocument();
    expect(
      screen.getByText(/Audit and repair historical payments against Stripe truth/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run reconciliation preview" })).toBeInTheDocument();
  });

  it("fetches preview and displays metrics and records table", async () => {
    vi.mocked(platformApi.previewPlatformStripeReconciliation).mockResolvedValueOnce(
      mockPreviewResponse,
    );

    render(<StripePaymentReconciliation canEdit={false} organizationId="org_test" />);

    fireEvent.click(screen.getByRole("button", { name: "Run reconciliation preview" }));

    await waitFor(() => {
      expect(screen.getByText("Checked")).toBeInTheDocument();
    });

    const checkedMetric = screen.getByText("Checked").closest(".platform-reconciliation-metric");
    expect(within(checkedMetric as HTMLElement).getByText("2")).toBeInTheDocument();

    const matchedMetric = screen
      .getByText("Already matched")
      .closest(".platform-reconciliation-metric");
    expect(within(matchedMetric as HTMLElement).getByText("1")).toBeInTheDocument();

    // Table rows (scoped to the table presentation; card markup duplicates content)
    const resultsTable = screen.getByRole("table");
    expect(within(resultsTable).getByText("pi_12345")).toBeInTheDocument();
    expect(within(resultsTable).getByText("Repair refund & fee")).toBeInTheDocument();
    expect(within(resultsTable).getByText("Matched")).toBeInTheDocument();

    // Notice that elevation is required when canEdit is false
    expect(screen.getByText(/Platform elevation required:/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Apply reconciliation repairs/ }),
    ).not.toBeInTheDocument();

    // Full scan: no truncation notice
    expect(
      screen.queryByText(/Only part of the payment history was scanned/),
    ).not.toBeInTheDocument();
  });

  it("warns when the preview covers only part of the payment history", async () => {
    vi.mocked(platformApi.previewPlatformStripeReconciliation).mockResolvedValueOnce({
      ...mockPreviewResponse,
      hasMore: true,
    });

    render(<StripePaymentReconciliation canEdit={false} organizationId="org_test" />);

    fireEvent.click(screen.getByRole("button", { name: "Run reconciliation preview" }));

    await waitFor(() => {
      expect(screen.getByText(/Only part of the payment history was scanned/)).toBeInTheDocument();
    });
  });

  it("allows applying repairs when elevated (canEdit is true)", async () => {
    vi.mocked(platformApi.previewPlatformStripeReconciliation).mockResolvedValue(
      mockPreviewResponse,
    );
    vi.mocked(platformApi.applyPlatformStripeReconciliation).mockResolvedValueOnce({
      accountId: "acct_test",
      appliedCount: 1,
      failedCount: 0,
      feeBackfilledCount: 1,
      organizationId: "org_test",
      refundedCount: 1,
      requestId: "req_apply_1",
      results: [
        {
          actionsApplied: ["mark_refunded", "backfill_fee"],
          message: "Repaired refund and fee",
          providerPaymentId: "pi_12345",
          status: "applied",
        },
      ],
      skippedCount: 0,
    });

    render(<StripePaymentReconciliation canEdit={true} organizationId="org_test" />);

    fireEvent.click(screen.getByRole("button", { name: "Run reconciliation preview" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Apply reconciliation repairs (1)" }),
      ).toBeInTheDocument();
    });

    // Open dialog
    fireEvent.click(screen.getByRole("button", { name: "Apply reconciliation repairs (1)" }));

    expect(
      screen.getByRole("heading", { name: "Apply Stripe payment reconciliation repairs?" }),
    ).toBeInTheDocument();

    const reasonInput = screen.getByLabelText("Reason for applying reconciliation repairs");
    const confirmButton = screen.getByRole("button", { name: "Apply reconciliation repairs" });

    // Confirm button disabled when reason is empty or too short
    expect(confirmButton).toBeDisabled();

    fireEvent.change(reasonInput, { target: { value: "Reconcile 2026 concert refunds" } });
    expect(confirmButton).not.toBeDisabled();

    // Submit the form
    fireEvent.submit(confirmButton.closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(platformApi.applyPlatformStripeReconciliation).toHaveBeenCalledWith("org_test", {
        confirm: true,
        reason: "Reconcile 2026 concert refunds",
      });
    });

    // Success message displayed
    await waitFor(() => {
      expect(
        screen.getByText(/Applied reconciliation repairs: 1 record updated/),
      ).toBeInTheDocument();
    });
  });
});
