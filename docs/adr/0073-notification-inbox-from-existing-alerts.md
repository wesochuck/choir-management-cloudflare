# Personal Inbox Receipts from Existing Notification Flows

Status: Proposed for final plan review Date: 2026-11-01

The Organization notification inbox records the audition, ticket-sale, and donation alerts already
generated for an intended recipient. The existing notification flow owns recipient eligibility,
suppression, canonical identity, and delivery; the inbox adds a personal receipt and read state at
the same durable generation boundary. It does not introduce a separate audience, queue, email
provider path, or activity-feed collector. An email excluded before generation yields no inbox
notice; a delivery failure after generation leaves its receipt available.

Audition recipients move from manually configured email destinations to a dedicated roster Profile
preference, available without an administrator role. Existing enabled recipients migrate only on an
unambiguous Organization-local Profile match; unmatched addresses are flagged for review and retired
from active selection. The old generic administrator-notification preference does not select
audition recipients. Personal inbox access requires current authenticated Organization Membership
linked to the recipient Profile and never grants permission to the related audition or financial
records.

Receipts start fresh at cutover, expire after 90 days whether read or unread, and retain original
identity/time through retries. Disabling a preference stops future alerts without deleting received
history. Opening the inbox does not mark read; explicit individual and snapshot-bounded mark-all
actions do, independently of operational record completion.

**Why:** A separate activity feed would duplicate recipient policy and create inconsistent email and
inbox behavior. Reusing email generation deliberately accepts its opt-out/suppression semantics
while making provider delivery failures independent of inbox visibility. Profile-based audition
recipients remove unowned destinations and support non-admin reviewers without expanding record
permissions. Retiring the manual list requires a compatible rollback boundary; restoring an older
runtime that reads that list would violate the new recipient choices.

See [the implementation plan](../plans/2026-11-01-admin-notification-inbox-implementation-plan.md)
for cutover, storage, UI, verification, and release sequencing. Accepted individual product
decisions are recorded there; this ADR remains proposed until the final shared-understanding review.
