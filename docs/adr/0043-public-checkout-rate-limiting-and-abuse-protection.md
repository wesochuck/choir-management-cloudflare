# Public Checkout Rate Limiting and Abuse Protection

Public checkout endpoints for tickets and donations enforce tenant-scoped rate limiting and
anti-abuse protections before creating pending reservations, patron records, payment attempts, or
Stripe Checkout sessions. Requests are evaluated inside the tenant's Organization Durable Object
using privacy-preserving keyed hashes of the client IP (`cf-connecting-ip`) and normalized buyer
email.

Budgets are tracked in Organization Durable Object storage within sliding time windows across three
orthogonal dimensions: client IP hash, normalized buyer email hash, and total organization
mutations. Inexpensive quote and discount availability reads operate under separate, independent
read budgets so browsing does not exhaust checkout capacity. Requests exceeding the hard rate limit
receive an HTTP 429 response with a typed error code and a bounded `Retry-After` header.

To balance accessibility with abuse resistance, the system introduces progressive challenge
escalation. Requests within baseline volume proceed with zero friction. When repeated checkout
attempts from a client or email exceed the challenge threshold, subsequent attempts must provide a
valid Cloudflare Turnstile token verified at the Worker route boundary. Missing or invalid challenge
tokens fail closed without reserving inventory or dispatching external calls. Idempotent replays of
an already accepted `checkoutRequestId` recover the existing record immediately without consuming
rate limit quotas or triggering challenges.

Stripe Checkout sessions are explicitly configured with a bounded expiration window (30 minutes),
and local pending reservations align with this provider lifecycle. Reservations whose expiration
deadline has passed immediately relinquish inventory upon evaluation and are promptly transitioned
to expired by scheduled cleanup, with the seven-day cutoff retained as a safety net. Aggregate
metrics and safe reason codes record rate limit events without logging raw IP addresses, cleartext
emails, or secret tokens.

**Why:** Unauthenticated reservation endpoints are vulnerable to inventory starvation and unbounded
database/Stripe resource consumption. Tenant-local DO rate limiting preserves strict isolation
without cross-tenant state leakage, progressive Turnstile escalation avoids punishing human buyers,
and prompt expiration ensures reserved inventory returns quickly to the pool when checkouts are
abandoned.
