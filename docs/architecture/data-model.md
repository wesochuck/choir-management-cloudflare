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

D1 must never contain roster, event, music, communication, payment, ticket, donation, or other
Organization-operational rows.

## Organization SQLite Durable Object

One `OrganizationStore` instance owns one Organization's operational schema. Its ID is derived from
the authoritative Organization ID after hostname resolution and authorization. The schema registry
is ordered and append-only; applied versions are recorded in `organization_schema_migrations`.

The foundation migration creates Organization metadata, append-only audit events, an idempotent job
ledger, and scheduler state. Feature milestones expand this schema with typed repositories. Contract
or removal migrations occur only after old and new Worker versions are both safe throughout the
rollback window.

## R2 and KV

Every R2 key begins `organizations/{organizationId}/`. Original files are private unless explicitly
published. Metadata and authorization remain in the Organization store. Published projections use
immutable versioned keys and a derived pointer.

KV contains only derived hostname routes and published-projection pointers. D1 and the Organization
store remain authoritative; KV values never grant permissions.

## Portability

Organization Export is a resumable logical snapshot, not a database backup. It produces a private
ZIP with a versioned manifest, checksums, baseline CSV contracts, structured JSON, audit history,
original R2 files, and a file index. v1 intentionally provides no whole-archive import, restore,
Organization deletion, recovery window, or purge automation.
