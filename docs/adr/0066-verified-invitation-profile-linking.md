# ADR 0066: Verified-email invitation Profile linking

- Status: Accepted
- Date: 2026-10-27
- Issue: #302

## Decision

After a recipient is authenticated with a verified email, both direct Organization invitations and
reusable roster invite links may connect that Membership to one existing Organization Profile when
the Organization's primary roster Contact has the same normalized email. The host-resolved
Organization Durable Object owns this lookup; D1 identity from other Organizations is never used to
find or select a Profile. Matching does not apply Gmail dot/plus equivalence.

Automatic linking is allowed only for one canonical Profile that is not archived under ADR 0065, is
not linked to another Membership, and is not involved in active reconciliation or another roster
invite enrollment. A retired alias is resolved to its canonical Profile and is never linked as an
alias. Ambiguous, archived, changed, or conflicting matches require administrator review. A
Membership's existing Profile link always takes precedence.

Direct Membership invitations remain usable without a match: acceptance creates the Membership and
the user can be linked later. Roster invite links keep their new-Profile path when there is no
match; a review-required result creates no replacement Profile or reservation. Linking an existing
Profile does not change its name, voice part, phone, status, visibility, preferences, Contacts, or
history.

The Worker and Organization Durable Object cannot share a transaction. Roster enrollment persists
the existing Profile choice and verified email before admission, revalidates at preparation and
commit, and uses a permanent DO guard so an older Worker version cannot replace that Profile if a
partially completed enrollment is retried during rollback. The guard is keyed by Profile ID. The
prepared-enrollment table's existing unique Profile ID index supports bounded checks against
competing users. D1's unique Organization/Profile Membership index and conditional link update
prevent a second Membership from taking the Profile. Automatic links use a distinct audit action
from administrator-initiated links.

## Compatibility and rollback

Forward-only D1 and Organization SQLite migrations add the enrollment mode/email columns and the
replacement guard. Existing enrollments default to the existing new-Profile behavior. No existing
Profile or Membership data is rewritten. Keep all added columns, the guard table, and its trigger
during rollback. An older Worker cannot overwrite a guarded Profile; an in-flight existing-Profile
enrollment may need the new Worker version or administrator repair to finish after rollback. New
Profile enrollment, invitation acceptance, and unrelated Organizations remain unchanged. No hosted
resource, production data, or provider configuration is changed.
