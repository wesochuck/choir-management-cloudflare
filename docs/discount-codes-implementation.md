# Ticket Discount Codes — Implementation Understanding

Status: agreed product behavior; implementation not started.

This document records the decisions reached for ticket Discount Codes. It is the implementation
brief for the later ticketing milestone. `CONTEXT.md` remains the source of truth for the domain
glossary; this document adds workflow, persistence, contract, and verification guidance.

## Product behavior

- A Discount Code is tied to exactly one sellable item: either one Performance's tickets or one
  Ticket Bundle. It is not a site-wide or multi-item code.
- A code supports either a whole-number percentage from 1% through 100%, or a fixed currency amount.
  Fixed amounts are presented and calculated per purchased unit: per ticket for a Performance, or
  per purchased Bundle. A Bundle's included performances do not multiply the discount.
- A Performance code applies to the price active at checkout (advance or day-of). A discounted unit
  price floors at $0; it never produces credit or a negative order.
- A checkout accepts at most one code. Discounts never stack.
- A code may have an optional Organization-wide total redemption limit. The limit counts confirmed
  checkouts, not ticket or Bundle units and not anonymous people.
- A code may be prepared before its item is on sale, but cannot be redeemed until the linked item is
  currently available. It has no independent time window and expires with that item's availability.
- Codes are case-insensitive and ignore surrounding whitespace. Their normalized values are unique
  inside an Organization. The buyer-facing rejection message is always: “This code is not valid for
  this purchase.”

## Code administration lifecycle

Organization Owners and Organization Administrators can create, edit, deactivate, reactivate, and
report on codes. Administrative changes are attributed in Organization Audit History.

An unused code is editable, including its item, type, value, and limit. After its first confirmed
redemption, its discount terms are immutable. Availability is independent: a code may be deactivated
and later reactivated through dedicated, audited lifecycle actions. Deactivation blocks new checkout
reservations immediately but does not change the quoted terms of an already pending checkout.
Reactivation makes the code eligible again for new checkouts without altering historical discount
terms, redemption counts, or order snapshots. Both deactivation and reactivation transitions are
explicitly recorded in Organization Audit History.

The public checkout shows the optional code field only when the linked Performance or Bundle has a
code that could currently be redeemed. The public response must not expose code values, remaining
limits, or redemption data merely to decide whether to show the field.

## Checkout and redemption lifecycle

Discount validation, pricing, capacity reservation, and redemption reservation must be resolved in
the Organization Durable Object transaction. A client-supplied Organization ID or client-calculated
price must never select storage or determine the amount.

The expected state sequence is:

1. The public catalog reports whether a currently redeemable code exists for the sellable item.
2. The buyer submits a normalized code with the ticket checkout request.
3. The Organization store resolves the item, current price, code, eligibility, limit, and capacity
   atomically. It calculates the discount and fee from authoritative values, then creates a pending
   checkout and reserves one code redemption when a limited code is used.
4. The provider checkout receives the already-authoritative discounted amount. Provider callbacks,
   not the browser success page, make payment authoritative.
5. A successful paid order, or a fully discounted ($0) order, confirms the redemption. A failed or
   expired checkout releases the pending redemption reservation.
6. A refund does not restore a confirmed redemption.

The same idempotency key must not create a second purchase or redemption. Queue/webhook replay must
be safe, and unexpected provider or Durable Object errors must remain visible rather than being
silently treated as invalid codes.

## Pricing and order snapshot

The authoritative calculation is:

```text
original subtotal = current unit price × quantity
discount = percentage of the original subtotal
         or fixed per-unit amount × quantity
discounted subtotal = max(0, original subtotal - discount)
processing fee = existing fee rule applied to discounted subtotal
total = discounted subtotal + processing fee
```

For a Bundle, “quantity” means the number of purchased Bundles. A 100% code or an amount that meets
the subtotal creates a Complimentary Ticket Order: it consumes ticket and Bundle capacity, follows
the ordinary audit and buyer-confirmation paths, and has no processing fee or collected payment.

Every discounted order must retain an immutable financial snapshot, including:

- normalized/display code reference and the code's discount type/value;
- linked Performance or Bundle reference;
- original unit price and original subtotal;
- discount amount and discounted subtotal;
- processing fee and final amount;
- quantity, payment status, provider references, and redemption status.

Buyer confirmations and receipts show the code, original subtotal, discount, processing fee, and
final total. The door-facing will-call list remains admission-focused and does not expose discount
details. Organization management reports redemption count and discounted revenue.

## Provider boundary

The existing ticket checkout currently builds provider line items from the undiscounted unit price
and separately adds the processing fee. Discount support must change that boundary so the provider
is charged the authoritative discounted total and cannot recompute a different amount.

The provider may use native Stripe Promotion Code primitives behind the scenes, but the buyer-facing
contract is the product behavior above: fixed discounts are per purchased ticket or Bundle, the code
field appears only when an eligible code exists, and a $2 code must visibly mean $2 off each
eligible unit. Do not expose provider-specific stacking, coupon, or expiry semantics that contradict
this brief. The final Stripe representation needs focused contract tests, especially for fixed
per-unit discounts, 100% discounts, fees, idempotency, and webhook reconciliation.

## Expected implementation surfaces

The later implementation should update the existing ticketing surfaces rather than create a second
ticket system:

- `packages/domain/src/ticketing.ts`: pure normalization, eligibility, discount, floor-at-zero, fee,
  and receipt-summary rules, with deterministic tests;
- `packages/contracts/src/ticketing.ts`: checkout requests, public availability metadata, admin code
  CRUD/report DTOs, order snapshots, and typed error codes;
- `apps/worker/src/organization/schema/migrations.ts`: forward-only Organization-store migration for
  codes, redemption reservations, and order snapshots;
- `apps/worker/src/organization/ticketingStore.ts`: tenant-local code persistence, atomic
  validation, redemption reservation/confirmation/release, immutable snapshots, and audit rows;
- `apps/worker/src/organization/organizationTicketing.ts` and ticketing routes: host-authorized
  public/admin orchestration and provider handoff;
- `apps/worker/src/payments/ticketCheckout.ts` and Stripe checkout tests: discounted line items, $0
  behavior, idempotency, and provider-effect boundaries;
- `apps/web/src/public/PublicTickets.tsx`: conditional code entry, authoritative preview, typed
  validation errors, accessible field/help text, and receipt display;
- `apps/web/src/account/TicketingManager.tsx`: code creation/edit/deactivation, eligibility target,
  limits, redemption/revenue reporting, and destructive confirmation patterns;
- ticketing integration, domain, contract, route, webhook, and browser tests for success, invalid
  code, authorization, capacity, limit races, replay, refund, tenant isolation, and accessibility.

Before implementation, expand the plan File Responsibility Map for any new source or test files not
already listed there, and add the Discount Code routes/workflows to
`docs/parity/feature-matrix.yaml`.

## Required verification cases

- Performance code uses advance price before the event day and day-of price on the event day.
- Bundle fixed discount is per purchased Bundle, not per included Performance.
- Percentage values are limited to whole numbers 1–100; fixed values are nonnegative currency
  amounts.
- One code only; normalized duplicate codes are rejected within one Organization.
- Unknown, inactive, exhausted, wrong-item, not-yet-on-sale, and deactivated codes all produce the
  same buyer-facing error.
- Limited-code reservations cannot oversubscribe under concurrent checkouts; failed/expired
  checkouts release them, while successful $0 and paid orders confirm them.
- Deactivation does not change an already pending quoted checkout.
- Refunds do not restore redemptions.
- Discounted fees, $0 orders, capacity, order snapshots, receipts, audit events, and management
  reports agree.
- Host alteration, Organization-ID alteration, cross-membership use, cross-host replay, webhook
  account mismatch, queue replay, and provider idempotency cannot cross Organization boundaries or
  create duplicate external effects.

No code, schema migration, provider configuration, or parity entry has been changed by writing this
brief.
