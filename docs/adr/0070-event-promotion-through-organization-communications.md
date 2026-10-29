# Event Promotion Through Organization Communications

Status: Accepted Date: 2026-10-29

## Context

Organization administrators need to announce newly published, ticketed Performances to prior ticket
buyers, other eligible Contacts, or both. The application already has a tenant-owned Communication
Center with reusable composition, Contact targeting, ticket-buyer targeting, previews, explicit
review, queued delivery, suppression, unsubscribe, retry, and delivery history. The generic
ticket-buyer audience currently uses event context to filter the purchases being announced, so a new
Performance cannot be used as both invitation context and a prior-purchase filter without changing
existing message meaning.

## Decision

Promotion is an event-scoped entry point and preset in the existing Organization Communication
system. It does not create a second campaign, recipient, provider, queue, or delivery-history
system. Message content, recipients, delivery states, jobs, audits, retries, and unsubscribe records
remain owned by the existing communication models and services.

Promotion messages carry an explicit target-event context separate from audience selection. The
audience may contain opted-in Ticket Buyers from selected or all eligible previous Performances,
Contacts, or both. Contact targeting reuses the Communication Center's existing Contact Lists,
explicit selections, filters, consent-preference behavior, and suppression rules. Contacts require
no purchase history. Buyer-only source filters apply only to the buyer branch; deduplication and
suppression are resolved across the combined audience. Current-event purchaser exclusion applies to
every selected branch.

The application may prepare or save a draft when an administrator opens Promotion, but saving,
publishing, enabling ticket sales, refreshing, and reopening never send a campaign. A person must
review the current audience and message and explicitly confirm each send. Promotion requires
server-side target-event eligibility at review and queue time, bounded truthful reach, tenant
authorization, and stable idempotency. An initial announcement is unique per event; follow-ups are
separate messages linked to their parent and require the same review and confirmation.

Promotion history references canonical communication messages and delivery results. Persist a
minimal Organization-local event/message association only for reliable event lookup and the
one-initial invariant. Do not duplicate message content, recipient rows, delivery state, or provider
data. Persist promotion context on canonical messages so generic Communication Center operations
cannot accidentally strip event constraints.

## Consequences

- Existing generic audiences and historical messages keep their current interpretation. New
  audience/context fields are optional for unrelated communication messages.
- Draft identity, message context, the event association, recipient rows, audit record, and delivery
  outbox transition must be concurrency-safe in the Organization Durable Object. Provider work
  remains outside the Durable Object transaction.
- Marketing purchase and Contact queries must signal overflow rather than silently sending to a
  partial audience. Existing per-message recipient and delivery limits remain in force.
- Existing Organization provider credentials, branded rendering, postal footer, signed unsubscribe,
  suppression rechecks, delivery feedback, retries, and history are reused.
- Migration is forward-only. Compatibility with an older Worker version must be assessed for each
  new linked-draft operation; rollback must stop promotion mutations before routing requests to a
  version that cannot enforce promotion invariants.
- No production deployment or hosted-resource change is authorized by this decision.

## Alternatives considered

- A separate event campaign entity and sender pipeline: rejected because it duplicates the existing
  canonical message, delivery, provider, unsubscribe, and retry infrastructure.
- Automatically send when an event is published or ticket sales are enabled: rejected because an
  event save is not sufficient consent to send a marketing communication and can cause duplicate or
  unintended messages.
- Reuse `audience.eventId` as the promotion event: rejected because it currently filters purchases
  to that event and would omit prior buyers or include the wrong target audience.
- Permit buyers only: rejected because the requested audience also includes existing Contacts who
  have not purchased a ticket.
