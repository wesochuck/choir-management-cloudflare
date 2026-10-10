# Organization Profile Reconciliation Runbook

This runbook guides Organization Administrators and Platform Administrators performing profile
reconciliations to merge signup-created duplicate profiles into historical unlinked profiles.

## 1. Problem and Objective

When singers sign up or accept invitations, their user account may be linked to a newly generated
Organization Profile instead of an existing historical Profile that already contained past
attendance, rehearsal music folder numbers, historical dues, and director notes.

The Profile Reconciliation feature allows an administrator to consolidate these profiles:

- **Canonical Target Profile:** Preserves its profile ID, historical attendance, dues records,
  assigned folder numbers, and notes.
- **Source Profile:** The signup duplicate. Its verified Organization Membership is relinked to the
  canonical Target Profile. Operational records that do not conflict are transferred to the Target
  Profile.
- **Alias Retirement:** The Source Profile is hidden from default roster listings and marked with
  `merged_into_profile_id = target_profile_id`. Any subsequent roster invite lookups or enrollment
  checks transparently resolve to the canonical Target Profile.

## 2. Security and Authorization

- Reconciliations can only be initiated by Organization **Owners** or **Administrators**.
- If MFA is enforced for the Organization, valid MFA verification is required before initiating or
  previewing reconciliation actions.
- Reconciliations are strictly tenant-isolated. An administrator can only reconcile profiles and
  memberships within their authenticated Organization.

## 3. Why Same-Name Profiles Are Not Auto-Merged

The system never automatically merges profiles sharing the same name or email:

1. Distinct members may share identical or similar names (e.g. parent/child, common names).
2. Automatic merging could silently destroy or combine distinct attendance records or financial
   obligations without human verification.
3. Explicit affirmation (`confirmedSamePerson: true`) is required from the administrator confirming
   that both profiles represent the same physical person.

## 4. Conflict Previews and Blocker Resolution

Before performing a merge, the system runs an atomic, read-only preview that audits for data
conflicts:

### Blockers (Prevent Consolidation)

- **Contradictory Event Records:** Both profiles have non-pending, conflicting attendance (Present
  vs Absent) or conflicting non-empty folder numbers for the same performance. _Resolution:_ An
  administrator must inspect the event rosters and resolve the discrepancy manually on one of the
  profiles before re-running the merge. RSVP Yes-vs-No conflicts do not block: a Yes response is
  always preserved over No (see Warnings).
- **Poll Response Collisions:** Both profiles cast votes on the same poll. _Resolution:_ Because
  votes cannot be merged or deleted without corrupting poll integrity, these profiles cannot be
  reconciled automatically.
- **Settled Financial History:** The Source Profile has settled dues (`paid` or `refunded`) or an
  active Stripe checkout session. _Resolution:_ Financial transactions are immutable for accounting
  and Stripe reconciliation safety. The profile holding settled dues must serve as the canonical
  profile, or refund adjustments must be handled before merging.

### Warnings (Resolved with Admin Choices)

- **Pending vs Confirmed Event State:** When one profile has a confirmed status and the other is
  "Pending", the confirmed status is automatically preserved.
- **RSVP Yes-vs-No:** When one profile answered Yes and the other answered No for the same event,
  Yes is always preserved. The preview lists each affected event as a warning with both responses
  shown, and the admin's same-person confirmation authorizes that outcome.
- **Phone Number Differences:** The administrator can choose whether to keep the Target phone or
  overwrite it with the Source phone.
- **Notes Differences:** The administrator can choose whether to keep Target notes, overwrite with
  Source notes, or append Source notes to Target notes.
- **Communication Suppressions:** Any active provider suppression or "Do Not Email" flag is
  conservatively propagated to the Target Profile.

## 5. Execution Lifecycle and Failure Recovery

Reconciliation uses a two-phase compare-and-swap (CAS) protocol across D1 and the Durable Object:

1. **D1 Reservation:** Records `state = 'reserved'` in `organization_profile_reconciliations`.
2. **DO Preparation:** Verifies the preview revision has not become stale due to concurrent edits.
3. **D1 Atomic Relink:** Conditionally updates `member.profileId` to `targetProfileId` and records a
   platform audit event. If concurrent edits changed `member.profileId`, the CAS fails closed.
4. **DO Commit:** Executes atomic transfers of event rosters, RSVP history, poll responses, dues,
   and deliveries within SQLite `transactionSync`. Sets `merged_into_profile_id` and logs an audit
   event.
5. **D1 Completion:** Marks `state = 'completed'`.

### Handling `pending_repair`

If step 4 encounters a fatal storage crash after step 3 relinked the membership in D1:

- The reconciliation row in D1 is marked `state = 'needs_repair'` and the API returns status
  `pending_repair`.
- The singer's login is already safely directed to the canonical Target Profile.
- The operator or maintenance job can re-trigger `executeProfileReconciliation` with the same
  `idempotencyKey` to finalize the DO commit safely without repeating the D1 update.
