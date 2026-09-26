# Platform Stripe payment reconciliation

Platform Administrators can audit and repair historical payment records against Stripe source of
truth from **Platform → Organizations → Organization access → Stripe payment reconciliation**.

## Overview and Purpose

Historically, when refunds were issued directly in the Stripe Dashboard or via webhook processing
gaps, local Choir Management payment attempt and ticket purchase records could remain marked as
`paid`, and processor fee amounts or balance transaction IDs were sometimes omitted.

This discrepancy distorts financial KPI reporting
(`Gross charged - Refunds - Processor fees = Net proceeds`). The reconciliation tool resolves this
by comparing local records directly against Stripe's authoritative Charge/PaymentIntent objects and
applying forward-only corrections without initiating any new external effects.

## Safety Guarantees

Applying reconciliation strictly enforces the following safety invariants:

1. **No duplicate Stripe refunds or charges:** The repair tool only reads from Stripe; it never
   issues Stripe API refund or charge commands.
2. **No customer emails queued:** Customer notifications (such as refund receipts or ticket
   cancellations) are explicitly bypassed during reconciliation repairs to avoid alarming buyers
   regarding historical events.
3. **Preservation of gross revenue:** The original purchase amount (`amount_paid_cents`) is
   preserved so that historical sales reporting accurately reflects total gross collections.
4. **Elevation required:** Applying repairs requires active Platform Administrator elevation with a
   documented operator reason. Read-only previews may be run without elevation.
5. **Audit trail:** Every applied payment reconciliation records a permanent
   `payment.stripe_history.reconciled` audit event containing previous and updated statuses,
   operator identity, and the supplied operational reason.

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
   (`Only check payments since`) and select **Run reconciliation preview**.
3. Review the preview metrics and table. Verify the classifications and proposed actions. Rows are
   listed newest-first and intentionally offer no re-sorting, so the review order always matches the
   server scan.
4. If repairable records exist, ensure Platform edit elevation is enabled above.
5. Select **Apply reconciliation repairs (N)**.
6. In the confirmation dialog, review the safety summary, enter an operational reason (minimum 3
   characters), and confirm.
7. Upon completion, the tool reports updated record counts and refreshes the preview to verify that
   all repaired items now report as `matched`.
