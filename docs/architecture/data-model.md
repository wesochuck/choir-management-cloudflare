# Data Model Boundaries

## Control-plane D1

D1 contains only global entry and routing state:

- Better Auth identity, accounts, sessions, verification, password, OTP, MFA, and recovery state;
- Organization registry, lifecycle, setup/launch, schema version, and health summary;
- Organization Memberships and Invitations;
- canonical/custom hostname registry and routing versions;
- Platform Administrator grants, bounded elevations, and platform audit events;
- Stripe connected-account and Organization communications routing metadata;
- encrypted credential envelopes where dynamic Organization credentials are unavoidable.

The initial forward migration establishes the Organization/domain registry and platform control
records. `0002_better_auth.sql` adds the schema generated from pinned Better Auth `1.6.23`,
including native-D1 identity, session, hashed verification, Organization member/invitation,
TOTP/recovery, rate-limit, and session-bound Platform Administrator MFA assertion tables. Better
Auth shares the existing `organizations` registry; its `member` and `invitation` tables are
authoritative for portal access. The unused foundation-only `organization_memberships` and
`organization_invitations` tables remain non-authoritative until a rollback-safe contract migration
removes or repurposes them.

`0003_provisioning.sql` adds Organization provisioning/Workflow metadata, a nullable Better Auth
Membership-to-Profile link, and a session column plus active-scope indexes for bounded Platform
Administrator elevation. Existing rows remain valid; application authorization requires a
session-bound elevation for edits, so a null-session row never grants access.

`0004_organization_mfa.sql` adds an Owner-controlled policy flag and expiring assertions keyed by
Better Auth session plus Organization. Email one-time-code sign-in establishes identity but cannot
satisfy an Organization MFA policy; TOTP or a recovery code must create the scoped assertion.

`0005_profile_link.sql` makes each non-null Membership Profile ID unique within its Organization. D1
stores only this identity link; the Profile record remains in the Organization Durable Object and
must be confirmed there before the link is written.

D1 must never contain roster, event, music, communication, payment, ticket, donation, or other
Organization-operational rows.

## Organization SQLite Durable Object

One `OrganizationStore` instance owns one Organization's operational schema. Its ID is derived from
the authoritative Organization ID after hostname resolution and authorization. The schema registry
is ordered and append-only; applied versions are recorded in `organization_schema_migrations`.

The foundation migration creates Organization metadata, append-only audit events, an idempotent job
ledger, and scheduler state. Organization schema version 2 introduces the minimal Profile identity
table needed for control-plane linkage; full roster fields and behavior remain owned by the roster
parity wave. Version 3 adds nullable failed-attempt timing to the job ledger so a later Cloudflare
delivery can safely reclaim retryable work. Version 4 adds private-file metadata and pending/ready
state; bytes remain in Organization-prefixed R2 while authorization metadata and upload audit stay
inside the owning Organization store. Version 5 adds a stable scheduled-job outbox; enqueue
uncertainty can resend the same job ID/idempotency key without creating a second logical effect.
Version 6 adds per-Profile calendar-feed revocation. Version 7 adds the bounded calendar read model:
Organization timezone, venues, performances/rehearsals, parent-performance linkage, event rosters,
RSVPs, call times, details, and approved set lists. These rows remain wholly inside the owning
Organization store and are sufficient for tenant-local calendar projection without placing
operational data in D1. Version 8 adds event attendance, version 9 expands Organization Profiles,
version 10 tracks folder assignment and return, and version 11 stores bounded RSVP decline notes.
Version 12 stores ordered section and voice-part configuration in the Organization metadata row;
Profile writes and configuration updates preserve referential integrity for assigned voice parts.
Version 13 stores reusable seating formations plus ordered, event-scoped seating charts and their
seat assignments. Chart writes accept only active performance events, existing venues, active voiced
Profiles with a Yes RSVP, and seats inside the declared layout. Linked members may read only charts
for events on their own roster; venue deletion also accounts for retained chart references. Feature
milestones expand this schema with typed repositories. Contract or removal migrations occur only
after old and new Worker versions are both safe throughout the rollback window.

## R2 and KV

Every R2 key begins `organizations/{organizationId}/`. Original files are private unless explicitly
published. Metadata and authorization remain in the Organization store. Published projections use
immutable versioned keys and a derived pointer.

KV contains only derived hostname routes and published-projection pointers. D1 and the Organization
store remain authoritative; KV values never grant permissions.

Public Website Domain registration creates a pending `custom_public` D1 record only after hostname
validation and canonical-Organization authorization. Activation is a separate provider validation
lifecycle and must not be inferred from registration. Disabling a domain advances its routing
version and removes the corresponding KV hint; D1 remains the source of truth. Custom public
hostnames serve public projections only and never expose authentication or administration routes.

## Portability

Organization Export is a resumable logical snapshot, not a database backup. It produces a private
ZIP with a versioned manifest, checksums, baseline CSV contracts, structured JSON, audit history,
original R2 files, and a file index. v1 intentionally provides no whole-archive import, restore,
Organization deletion, recovery window, or purge automation.
