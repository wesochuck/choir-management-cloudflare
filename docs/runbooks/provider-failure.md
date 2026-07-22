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

- Verify webhook signatures before account lookup.
- Resolve the connected account to exactly one Organization in D1, then apply the stable event ID
  idempotently inside that Organization store.
- Never recompute price/capacity from browser values. Refunds and bundle transitions remain
  all-or-nothing where the baseline requires it.

## Queue/dead letters

- At-least-once delivery is expected. Do not manually duplicate a message with a new idempotency
  key.
- Inspect safe job metadata, correct the provider/configuration cause, then replay through a bounded
  operator path that retains the original effect identity.
- Record terminal state and operator action in Organization Audit History when user-visible behavior
  changes.
