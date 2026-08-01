# Provider and Queue Failure Runbook

## First response

1. Identify one Organization scope from safe routing/job metadata.
2. Disable or pause only the affected provider lane when possible; do not perform a platform-wide
   operational scan.
3. Preserve typed raw provider details for the formatter while redacting credentials, authorization
   headers, full signed tokens, OTPs, recovery codes, and sensitive payload fields.
4. Check attempt history, idempotency key state, queue depth, dead letters, webhook event ID, and
   Organization integration status.

## Email/SMS

- Platform transactional email and Organization communications are separate lanes.
- Respect provider retry-after/429 signals with bounded exponential backoff and jitter.
- A partial Email/SMS result records each channel separately; retry only failed, non-suppressed
  recipients using the same stable effect identity.
- Preview/local modes never send. Staging sends only through configured sandbox or recipient
  allowlists.
- Brevo email qualification must retain `X-Sib-Sandbox: drop`. Transactional SMS has no equivalent
  no-send mode and must remain restricted to `BREVO_SMS_ALLOWED_RECIPIENTS` until a separate launch
  gate changes the environment contract.
- A 401/403 is a credential/configuration incident; 429 and 5xx responses are retryable. Do not log
  Brevo response bodies because they may contain provider or recipient detail.

## Stripe

- The Worker fails closed with `stripe_webhook_unavailable` (HTTP 503) when the environment has no
  `STRIPE_WEBHOOK_SECRET`; do not replace this with an unsigned compatibility path.
- Verify webhook signatures before account lookup.
- Read and verify the raw request body with the five-minute timestamp tolerance; reject malformed,
  stale, or mismatched signatures without revealing provider details.
- Require the Stripe connected-account envelope and resolve it to exactly one Organization in D1; do
  not select a webhook tenant from the request hostname. Compare any Organization metadata with the
  D1 mapping before dispatching to a Durable Object. The event ID is the stable replay identity.
- Resolve the connected account to exactly one Organization in D1, then apply the stable event ID
  idempotently inside that Organization store.
- `checkout.session.completed` applies ticket, donation, or dues transitions only when
  `payment_status` is `paid`; delayed payment methods use `checkout.session.async_payment_succeeded`
  and `checkout.session.async_payment_failed`. Expired sessions and `charge.refunded` events use
  separate idempotency markers so a refund cannot suppress a completion event with the same provider
  delivery context. A partial or malformed refund event is acknowledged without revoking local
  access; only a complete, amount-verified refund can transition the payment locally.
- Dispute events append an Organization-scoped alert/audit record. They do not automatically refund
  a payment or revoke a ticket/access entitlement. Refund requests use connected-account Stripe
  idempotency and remain locally paid until `charge.refunded` is verified.
- The seven-day stale-checkout job is a backstop, not a substitute for Stripe events. It releases
  pending records as expired and preserves the original payment attempt for audit/reconciliation.
- Never recompute price/capacity from browser values. Refunds and bundle transitions remain
  all-or-nothing where the baseline requires it.

## Queue/dead letters

- At-least-once delivery is expected. Do not manually duplicate a message with a new idempotency
  key.
- Inspect safe job metadata, correct the provider/configuration cause, then replay through a bounded
  operator path that retains the original effect identity.
- Record terminal state and operator action in Organization Audit History when user-visible behavior
  changes.
