# Platform Stripe payment reconciliation

Platform Administrators can audit and repair historical payment records against Stripe source of
truth from **Platform → Organizations → Organization access → Stripe payment reconciliation**.

## Overview and Purpose

Historically, when refunds were issued directly in the Stripe Dashboard or a webhook was missed,
local payment records could keep the wrong status. A successful Stripe Checkout Session can remain
`pending` or become `expired` locally even though Stripe captured the payment, and processor fee
amounts or balance transaction IDs can also be omitted.

This discrepancy distorts financial KPI reporting
(`Gross charged - Refunds - Processor fees = Net proceeds`). The reconciliation tool resolves this
by comparing Organization-local records against their connected Stripe account and applying
forward-only corrections without initiating any new external effects. Pending or expired ticket
orders are considered only when their original Checkout Session and PaymentIntent can be verified.

## Safety Guarantees

Applying reconciliation strictly enforces the following safety invariants:

1. **No duplicate Stripe refunds or charges:** The repair tool only reads from Stripe; it never
   issues Stripe API refund or charge commands.
2. **No customer notifications:** Historical repairs do not send receipts, refund notices, ticket
   confirmations, or cancellations. Repairing a paid ticket links its buyer to the local Contact
   record and restores the payment status without queuing ticket notifications.
3. **Preservation of gross revenue:** The original purchase amount (`amount_paid_cents`) is
   preserved so that historical sales reporting accurately reflects total gross collections.
4. **Elevation required:** Applying repairs requires active Platform Administrator elevation with a
   documented operator reason. Read-only previews may be run without elevation.
5. **Audit trail:** Every applied payment reconciliation records a permanent
   `payment.stripe_history.reconciled` audit event containing previous and updated statuses,
   operator identity, and the supplied operational reason.
6. **Organization and payment binding:** Stripe lookups use the Organization's connected account.
   For a local record without a PaymentIntent ID, reconciliation resolves its stored Checkout
   Session ID and verifies the session's Organization, purchase, checkout request, payment type,
   amount, and currency before considering the captured PaymentIntent.
7. **Capacity and discount protection:** Expired purchases are fulfilled only if their ticket
   capacity and discount reservation can still be safely honored. If another order has consumed
   performance or bundle capacity, or a discount reservation is inconsistent, the row requires
   manual review.

## Classifications and Actions

- **`matched`:** Local status and processor fees already match Stripe truth. No action is required.
- **`refund_status_mismatch`:** Stripe reflects a full refund and the local record is still `paid`.
  Safe for automatic repair (`mark_refunded`).
- **`refund_and_fee_mismatch`:** Stripe reflects a full refund and provides fee metadata, but the
  local record is still `paid` without fee records. Safe for automatic repair (`mark_refunded` +
  `backfill_fee`).
- **`processor_fee_missing` / `balance_transaction_missing`:** Local status is already correct, but
  the processor fee or Balance Transaction ID is missing while Stripe provides it. Safe for
  automatic backfill (`backfill_fee`).
- **`ticket_payment_status_mismatch`:** Stripe confirms an exact, fully captured successful payment
  for a local `pending` or `expired` ticket purchase. If capacity and discount checks still pass,
  safe to repair the local ticket and payment-attempt status (`mark_paid`) and backfill any missing
  fee evidence. The repair is allowed for older purchases; age alone does not block it.
- **`ticket_payment_not_captured_manual_review`:** Stripe does not confirm a complete, successful
  capture, or refund activity exists. Do not issue tickets based on this row; inspect the connected
  Stripe account and order history manually.
- **`ticket_fulfillment_manual_review`:** Stripe confirms payment, but current capacity or discount
  state cannot safely support fulfillment. Resolve the conflict manually before issuing tickets.
- **`partial_refund_manual_review`:** Stripe indicates a partial refund
  (`0 < amount_refunded < amount`). Automated repair is intentionally blocked to protect ticket
  allocations and custom split accounting; operators must review these records manually.
- **`amount_mismatch_manual_review`:** The Stripe charged amount or currency differs from the local
  record, or a conflicting non-null processor fee exists locally. Requires manual inspection; never
  auto-applied.
- **`provider_payment_missing` / `provider_lookup_failed`:** The payment was not found in the
  connected Stripe account, or the Stripe lookup errored. Requires manual inspection in the Stripe
  Dashboard.
- **`local_inconsistency`:** Local resource and payment-attempt statuses disagree in a way
  reconciliation cannot safely resolve (for example, Refunded locally but Paid in Stripe). Requires
  manual inspection.

## Operator Procedure

1. Navigate to the target Organization's Platform page.
2. Under **Stripe payment reconciliation**, optionally specify a date cutoff
   (`Only check payments since`) and select **Run reconciliation preview**. Results are read in
   pages of up to 50 payment attempts, ordered newest first with a stable attempt-ID tie-breaker.
   Use **Next page** and **Previous page** to walk older history; each page is checked separately
   against Stripe and uses the same cutoff and snapshot time. Do not narrow the date range to reach
   older records.
3. Review the preview metrics and table. Verify each classification and proposed action. Rows are
   listed newest-first. When more history is available, use **Next page**; the cursor continues from
   the last created-at/attempt-ID pair without repeating the current page.
4. If repairable records exist, ensure Platform edit elevation is enabled above.
5. Select **Apply reconciliation repairs (N)**. Apply targets the exact payment attempts shown on
   the current preview page, even when they are older than the newest 200 records. If one of those
   attempts changed or no longer matches the preview cutoff, refresh the preview before applying.
6. In the confirmation dialog, review the safety summary, enter an operational reason (minimum 3
   characters), and confirm.
7. Upon completion, the tool reports updated record counts and refreshes the preview to verify that
   all repaired items now report as `matched`.

The apply request is limited to repairable rows from that exact preview page and reuses its date
cutoff and snapshot time. Run a fresh preview if the cutoff or rows need to change. An empty
selection is rejected. Rows marked for manual review are never included in the automatic repair.
