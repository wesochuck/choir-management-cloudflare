# Use a Shared Webhook-Authoritative Payment Lifecycle

Tickets, bundles, donations, and dues use one Organization-owned Stripe Connected Account and one
shared Payment Lifecycle. Every checkout creates a tenant-local pending Payment Attempt before or as
part of creating its hosted Checkout Session. Only a verified Stripe webhook may transition the
attempt to `paid` or `expired`; `checkout.session.completed` is accepted only when the session's
`payment_status` is `paid`, while delayed payment methods use the explicit async success/failure
events. A verified refund event transitions a paid attempt to `refunded`. Expired attempts are
retained for audit and a retry creates a new attempt and Checkout Session.

The platform webhook endpoint verifies the raw signature before any lookup, reads the
connected-account identifier from Stripe's event envelope, resolves it to exactly one Organization
in D1, and dispatches the event into that Organization's Durable Object. The Durable Object applies
event IDs and refund event IDs idempotently. Disputes create Organization-scoped operational alerts
and audit records but do not silently refund or revoke a paid ticket, donation, or dues obligation.

Online payment activation is explicit per module and defaults off. Organization Owners and
Administrators may activate a module after the readiness checklist passes; scoped Platform
Administrators may do so with visible attribution. A global platform payment kill switch overrides
all module switches. Local and preview use fake or disabled effects, staging uses isolated Stripe
test-mode connected accounts and signed test webhooks, and production uses live secrets and live
connected accounts only after the staging gate passes.

Payment confirmations are Organization-owned communication jobs sent through the Organization's
Brevo lane only after the paid transition. The templates are editable system templates with a
constrained placeholder set. Payment state commits independently from email delivery, so provider
email failures retry without causing Stripe webhook replay or duplicate fulfillment. Public forms,
status-aware confirmation pages, and emails preserve the legacy information hierarchy while card
entry remains Stripe-hosted. Dues, tickets, and donations all expose pending, paid, expired, and
refunded states; the dues page uses the same confirmation shell as the public commerce flows.

**Why:** This keeps merchant ownership, tenant isolation, and reconciliation explicit while making
the three revenue modules consistent. The design trades a small Payment Attempt history and separate
activation controls for safe retries, clear incident recovery, and protection against browser-return
or webhook replay bugs.
