# Use Per-Organization Scheduling and Idempotent Queues

Each Organization Durable Object will own its next-due alarm and durable scheduler state. Alarm
handlers will transactionally identify due work and enqueue Organization-scoped jobs; Cloudflare
Queues will perform external email, SMS, payment-reconciliation, and export work with bounded
concurrency, retries, dead-letter handling, and idempotency enforced in the Organization store.

**Why:** The Parity Baseline has email-queue processing, automated event reminders, ticket-buyer
reminders, post-event attendance finalization and reports, and stale-checkout cleanup.
Per-Organization alarms preserve these behaviors without a platform-wide operational query, while
queues keep slow or failure-prone provider calls outside Durable Object transactions. This design
accepts at-least-once delivery and the need for explicit idempotency records in exchange for
isolated scheduling, retry safety, and straightforward tenant attribution.
