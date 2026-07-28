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
- Require supported payment metadata and compare any Organization metadata with the canonical
  hostname before dispatching to a Durable Object. The event ID is the stable replay identity.
- Resolve the connected account to exactly one Organization in D1, then apply the stable event ID
  idempotently inside that Organization store.
- `checkout.session.completed` applies ticket, donation, or dues transitions; expired sessions and
  `charge.refunded` events use separate idempotency markers so a refund cannot suppress a completion
  event with the same provider delivery context.
- Never recompute price/capacity from browser values. Refunds and bundle transitions remain
  all-or-nothing where the baseline requires it.

## Queue/dead letters

- At-least-once delivery is expected. Do not manually duplicate a message with a new idempotency
  key.
- Inspect safe job metadata, correct the provider/configuration cause, then replay through a bounded
  operator path that retains the original effect identity.
- Record terminal state and operator action in Organization Audit History when user-visible behavior
  changes.
