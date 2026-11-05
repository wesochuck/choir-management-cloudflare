# ADR 0076: Organization Owner and Administrator Profile Requirement and Notification Inbox Expansion

- Status: Accepted
- Date: 2026-11-05

## Context

Organization administrative communications have historically had two different delivery paths:

1. Preference-bound alerts (auditions, ticket sales, donations, RSVP declines) delivered to linked
   roster Profiles, recorded in both email and the Organization notification inbox (ADRs 0066,
   0073).
2. Non-profit compliance reminders delivered directly to every Owner and Administrator resolved from
   the control plane (D1) by email only, bypassing Profiles and the notification inbox entirely.

Because `member.profileId` is nullable, an Organization Owner or Administrator could exist without a
linked Profile—specifically through initial Organization provisioning (where `ProvisioningWorkflow`
only inserted the D1 `member` record), direct invitation acceptance without a matching roster
Contact (ADR 0066), or role promotion via `PUT /members/:id/role`. Unlinked administrators could not
access the notification inbox (`409 profile_link_required`), received no operational alerts, and
could not use member-scoped views. Furthermore, compliance reminders and RSVP-decline notices lacked
receipts in the Organization notification inbox.

## Decisions

### 1. Owner and Administrator Profile requirement

Every Organization Owner and Administrator must have a linked Organization Profile:

- **Provisioning:** `ProvisioningWorkflow` provisions the founding Owner's Profile idempotently
  after operational store initialization, using a deterministic Profile ID derived from
  `params.requestId`. The Profile is configured with default administrative notification preferences
  (`receiveAdminNotifications: true`, `receiveFinancialAlerts: true`,
  `receiveRsvpDeclineNotices: true`) and linked to the founding Owner's membership.
- **Invitation acceptance:** Direct invitation acceptance for Owner or Administrator roles creates a
  new Organization Profile and links it immediately when no roster Contact matches (`no_match`),
  amending ADR 0066 for Owner and Administrator roles only. Member invitations continue to accept
  without creating an unmatched Profile.
- **Role promotion:** Promoting a member to `administrator` or `owner` requires that the target
  member already has a linked Profile. Unlinked promotions are rejected with
  `409 profile_link_required`. No-op role updates and demotions remain permitted.
- **Existing unlinked administrators:** Unlinked administrators are not silently repaired or locked
  out of administrative functions. Instead, `/api/organization/auth-status` exposes
  `profileLinked: boolean`, surfacing an actionable warning banner in the authenticated
  administrative shell and providing a direct "Create and link" repair action on the Access
  management page.
- **Audit script:** A read-only staging audit script (`scripts/audit-unlinked-admins.mjs`) reports
  unlinked administrators across all active Organizations.

### 2. Notification inbox expansion

The Organization notification inbox is expanded to record non-profit compliance reminder notices and
RSVP-decline alerts:

- **Compliance notices:** Delivered for applicable, non-archived compliance tasks due on the cycle
  date. The queue consumer resolves Owner and Administrator recipients and calls the Organization
  Durable Object RPC `recordComplianceInboxNotices` inside a single synchronous transaction before
  email delivery. Weekly repeat notices generate distinct receipts keyed by
  `nonprofit-compliance:{org}:{taskId}:{due}:{occurrence}`; retries are deduplicated by the unique
  `(recipient_profile_id, source_key)` index.
- **RSVP-decline notices:** When a member declines attendance, an inbox notice is recorded for
  eligible administrators with `receiveRsvpDeclineNotices` enabled. The notice body includes the
  member name, voice part, event details, and a shortened plain-text preview of the RSVP note
  (whitespace-collapsed and truncated to 160 characters), deep-linking to the event in the RSVP
  Manager.
- **Schema migration:** Migration 137 rebuilds `notification_receipts` in SQLite with an expanded
  CHECK constraint covering `rsvp_decline` and `compliance`, restoring all indexes and preserving
  receipt data and read states.

## Compatibility and Rollback

All schema changes are forward-only and rollback compatible. SQLite migration 137 expands allowed
values without rewriting existing rows. If an older Worker is restored during rollback, existing
receipts remain intact, though newly added notice kinds would be filtered by older contracts. No
unlinked administrator data is rewritten destructively.
