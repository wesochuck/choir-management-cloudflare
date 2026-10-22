# ADR 0061: Roster contact email without account enrollment

- Status: Accepted
- Date: 2026-10-22
- Issue: #287

## Decision

A roster Profile does not require an account. Store its independently editable contact email in
Organization-owned `contacts`, linked by `profile_id`; keep its ordinary telephone in
`profiles.phone`. Do not add another email column or alter verified D1 sign-in identity. Saving or
importing a Profile never invites, enrolls, or automatically matches an account or unrelated
Contact. Account invitations remain an explicit action in Organization invitation settings.

Where existing data has several linked Contacts, the primary is the oldest `created_at`, with ID as
the deterministic tie-breaker. Reads and edits use this same primary. Clearing its email retains the
Contact and preferences. Omitted email in older API payloads preserves the saved value. Effective
roster and Members delivery email is the primary Contact email, otherwise linked Membership email;
only one destination is selected. The roster editor displays contact and sign-in email separately.

Roster contact mutations run in the same short SQLite transaction as the Profile mutation, using
existing Contact validation, normalized-email uniqueness, audit, and preference code. They never
reassign an existing Contact on an email match. A collision rejects a single editor save; import
skips that row and reports its source row with corrective guidance. Other valid rows are created.
Invalid CSV or unconfigured parts reject the complete import before writes. Reimport of an already
stored email conflicts rather than duplicating a Profile. Import is create-only; rows without an
email have no stable matching identity and each accepted upload creates new Profiles. No name/phone
matching or implicit updates are performed.

General Members communications includes unassigned Profiles. Explicit part filters and track-only
exclusions still apply. Contact email unsubscribe and Profile suppression both block delivery; queue
reads recheck these restrictions after enqueue and on retry. Profile unsubscribe tokens work without
accounts and continue blocking overlapping Contacts via their linked Profile. Destination
deduplication retains suppression precedence. New roster Contacts have unknown marketing and SMS
consent; importing a phone does not subscribe SMS. Existing Contacts audiences are unchanged.

Enabled event reminders use the same Contact-first email precedence. Import neither sends a message
nor schedules reminder work; existing reminder defaults, event eligibility, opt-outs, and explicit
preferences remain unchanged. Attendance-report authorization still derives from manager
Memberships. Member/public directory disclosure rules are unchanged.

CSV export uses effective roster email and preserves phone. Export still escapes spreadsheet formula
prefixes; roster import removes that safety apostrophe only before a plus-prefixed telephone value.

## Consequences and rollback

No schema migration, new index, provider configuration, or hosted change is required. Existing
Contact profile and normalized-email indexes support bounded roster and collision lookups. Contact
preferences and suppressions survive edits/removal. Existing Profile merge behavior owns link moves;
primary selection remains deterministic after merges. Rollback to older code retains these Contact
rows and preferences, but older roster reads and Members resolution lose this destination behavior.
