# Reconciliation Fulfillment for Verified Pending and Expired Ticket Purchases

Issue #84 scoped Stripe reconciliation to historical full-refund repair and processor-fee backfill,
and explicitly excluded pending and expired payments from enumeration. Operating that workflow
surfaced the larger residue: successful Stripe Checkout Sessions whose local ticket purchases stayed
`pending` or lapsed to `expired` because a webhook was missed or processing stalled. Those buyers
paid but hold no tickets, and no existing flow repairs them.

Reconciliation now also fulfills such purchases (`mark_paid`) when Stripe truth verifies them
exactly: the PaymentIntent ID, Checkout Session ID, Organization, purchase, checkout request,
payment type, mode, session and payment statuses, amount, and currency must all agree; capture must
be complete and successful; and no refund activity may exist locally or in Stripe. Pending and
expired rows are therefore enumerated rather than excluded, reversing the original #84 stance for
this narrow, fully-verified case.

Fulfillment additionally requires that the order can still be honored. Performance and bundle
capacity are re-checked against current commitments, and discount reservations must be present and
consistent (a released reservation counts only while its code still has headroom). A row that fails
any of these checks requires manual review instead of repair. Age alone does not block fulfillment:
an old verified payment with intact capacity is repaired the same as a recent one. Every repair
re-verifies Stripe immediately before mutation, re-reads the local row by attempt and resource
identity, applies through conditional writes that abort on any concurrent change, and records
organization and platform audit events with the operator's reason. Cursor pagination with a pinned
snapshot keeps multi-page reviews consistent.

Considered options: keeping the original exclusion (rejected — leaves paid buyers ticketless with no
repair path); fulfilling on payment confirmation alone without capacity and discount gates (rejected
— risks overselling performances and honoring dead discount reservations); imposing an age cutoff
(rejected — arbitrary cutoffs strand legitimate historical payments that verify exactly).

**Why:** Reconciliation exists to make local records agree with Stripe truth, and a verified
captured payment disagreeing with a pending local row is the same class of residue as a missing
refund record. The guard chain — exact identity match plus capacity plus discount plus optimistic
concurrency plus dual audit — keeps the fulfillment conservative while closing the loop for buyers
who paid.
