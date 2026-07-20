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

The initial forward migration establishes Organization, domain, membership, invitation, platform
administration, audit, and integration-routing tables. Better Auth tables are added through a later
forward expansion once its pinned adapter contract is implemented.

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
