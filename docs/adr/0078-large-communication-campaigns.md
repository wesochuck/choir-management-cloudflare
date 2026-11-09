# Support 10,000-recipient Organization communications

Status: Accepted Date: 2026-11-08

## Context

Contact lists can exceed the former 500-recipient campaign limit. Raising a limit alone would
silently truncate some audience branches and leave deliveries stranded by the old whole-message
claim. The existing Organization communication, review, outbox, provider, and delivery-history
models remain authoritative; a second campaign pipeline is unnecessary.

## Decision

One canonical communication supports up to 10,000 deduplicated recipients and up to 20,000 delivery
rows when both Email and SMS are selected. Contact and member ID selections accept 10,000 IDs. Each
audience branch reads a bounded 10,001 candidates to detect overflow; no overflowing branch may send
a truncated subset. Commerce source-order overflow is conservative: administrators must narrow a
source exceeding the bounded order lookup even when several orders belong to one person. Member
eligibility filters apply before the candidate limit. Existing destination deduplication and
suppression precedence remain unchanged.

Promotion reviews retain their existing signed audience/message/revision binding. Generic campaigns
with more than 500 reachable recipients also require this review. The new UI saves the draft before
reviewing those campaigns. Generic reviews bind a null promotion-event context, the delivery
channel, recipient names and destinations, Organization, draft revision, message, and expiry. A
changed recipient selection requires a fresh review. At confirmation, canonical delivery rows
persist the complete recipient snapshot atomically with the message and initial outbox job. Later
Contact additions cannot grow a queued campaign. Smaller existing API clients remain compatible.

Delivery jobs claim at most 50 delivery rows. Migration 138 adds nullable `delivery_job_id`
ownership and an index on `(message_id, delivery_job_id, status, id)`. This access path serves
initial claims, resumption, completion, and continuation without scanning historical campaign
deliveries. Older unassigned queued rows are claimed through the same mechanism. A retry of a batch
resumes only its unfinished rows; persisted successful results are not attempted again. Provider
calls remain outside the Organization Durable Object, retain stable per-delivery provider
identities, and use the existing queue retry/dead-letter handling.

Finishing a batch atomically creates one idempotent continuation outbox entry when unassigned queued
rows remain. The shared scheduler wake helper activates the outbox; scheduler.ts keeps alarm and
queue-handoff ownership. Both batch completion and result recording tolerate replay. Explicit failed
recipient retries clear ownership only for failed rows. Consent is rechecked on claim and
immediately before each provider attempt, including Email and SMS unsubscribes and suppression.
Summary counts cover the full 20,000-row bound; recipient detail continues to use existing
pagination.

## Consequences

- Organization authorization, tenant-owned storage, explicit confirmation, canonical history,
  provider sandbox controls, unsubscribe links, and promotion purchaser exclusions are preserved.
- Campaign preparation is explicitly bounded at 10,000 recipients; provider execution is split into
  bounded queue jobs instead of one long provider loop.
- Migration 138 is forward-only and additive. Downgrading to a pre-batch Worker while campaigns are
  active is unsafe; follow the large-campaign runbook before a code rollback.
- No hosted resources, provider quotas, configuration, or production deployment are changed by this
  decision.
