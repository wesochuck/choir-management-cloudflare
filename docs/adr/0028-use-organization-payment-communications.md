# Use Organization Payment Communications

Payment confirmation and receipt messages are Organization-owned transactional communications. They
use the Organization's Brevo communications lane, editable system templates, and tenant-local
communication delivery jobs. Platform Email remains reserved for authentication, invitations,
password recovery, and other platform account messages.

The paid webhook transition enqueues the payment email after committing the payment state. Email
delivery retries independently and cannot cause Stripe event replay or duplicate payment
fulfillment. Templates preserve the legacy ticket, bundle, donation, and dues information hierarchy
while the application owns payment facts, signed receipt/ticket links, provider identifiers, and
required security-sensitive placeholders.

**Why:** This preserves Organization branding and deliverability ownership while keeping platform
security mail separate. It also makes provider outages observable and recoverable without changing
financial state.
