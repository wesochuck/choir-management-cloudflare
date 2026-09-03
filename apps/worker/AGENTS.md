# Worker Agent Instructions

These instructions inherit the repository root `AGENTS.md` and apply under `apps/worker/`.

## Tenancy and Authorization

- D1 owns global identity, Better Auth state, Organization registry, memberships, invitations,
  domains, Platform Administrator grants, and integration-routing metadata only.
- One SQLite-backed Durable Object owns each Organization's operational records and scheduler state.
- Verify Organization Membership or scoped Platform Administrator elevation before invoking
  operational methods.
- Platform Administrator access is Organization-at-a-time, never impersonated, visibly elevated for
  edits, time-bounded, and attributed to the actual actor.
- Audit events are append-only through application APIs and include safe actor, Organization,
  action, target, request, timestamp, and change-summary fields.
- Add adversarial isolation coverage where relevant: host or Organization-ID alteration,
  cross-membership access, cross-host token replay, R2 key substitution, stale invitations, revoked
  elevation, queue replay, and webhook-account mismatch.

## Data and Migrations

- `organization_memberships` is a legacy unused table. Do not query or write it. Authorization and
  membership listing use Better Auth's `member` table with camelCase columns: `organizationId`,
  `userId`, `role`, `createdAt`, and `profileId`.
- Do not remove `organization_memberships` without a rollback-safe forward migration.
- Use versioned D1 and Organization-store migrations with explicit schema registries.
- Keep Durable Object transactions short. Provider calls never occur inside them.
- New features and operations on Durable Objects (e.g. `OrganizationStore`) must use strongly-typed
  Cloudflare Workers RPC methods on the class (`stub.methodName(...)`) rather than internal HTTP
  `fetch()` dispatch.
- Organization alarms transactionally create stable jobs and advance the next alarm.
- Public traffic reads versioned Published Projections from R2 or edge cache; bursts must not
  serialize through the Organization object.
- Private R2 downloads require authorization. Public assets use immutable versioned URLs.
- Validate every untrusted HTTP, queue, webhook, provider, import, and export boundary with Zod and
  explicit size limits.
- Enforce cross-field and referential rules at the shared contract and Organization store layers,
  with UI validation as an affordance rather than an integrity boundary.
- SQL tests must execute against real SQLite schema migrations (via Node `DatabaseSync` or
  `@cloudflare/vitest-pool-workers` `runInDurableObject`); mocking `storage.sql.exec` by
  string-matching queries and returning synthetic columns is strictly prohibited (WS1).
- Search splits identity and profile data: email lives in D1 (`user`/`member`), while operational
  profiles live in the Organization Durable Object (`profiles`); the layers communicate via bounded
  `profileIds` and must enforce cross-tenant isolation (WS1).
- SQL queries must not broadly swallow errors with empty catch blocks; unexpected SQL syntax or
  schema mismatches must fail fast (WS1).

## Queues, Workflows, and Providers

- Queue delivery is at-least-once. Persist a stable idempotency key before a replay can create
  another external effect.
- Use bounded concurrency, exponential backoff, jitter, attempt records, terminal states, and
  dead-letter visibility.
- Do not broadly swallow Worker, Workflow, Durable Object, alarm, or queue errors. Handle explicitly
  typed terminal conditions and preserve unexpected failures.
- Test success, authorization and validation failures, retry/replay, rollback compatibility, and
  tenant isolation as applicable.
- Use deterministic clocks, provider fakes, and local Cloudflare bindings. Unit tests must not wait
  on real timers.

## Authentication and Provider Boundaries

- There is no public registration. Email one-time code is the primary sign-in method; users may set
  passwords; Platform Administrators require MFA and recovery codes.
- Custom public domains never host authenticated administration, member, account-management, or
  Platform Administrator routes.
- Stripe uses Organization-owned connected accounts and direct charges. The platform takes no
  application fee and has no subscription system.
- Platform transactional email and Organization campaign/SMS delivery are separate provider lanes.
- Cloudflare Email Sending feedback uses provider event subscriptions, not an inbound `email()`
  bounce parser. Follow `docs/runbooks/cloudflare-email-feedback.md` and verify current Cloudflare
  documentation before changing the subscription.

## Security Headers and Content Security Policy

- `buildContentSecurityPolicy()` in `router.ts` must remain compatible with Cloudflare platform
  services active on staging and production zones:
  - Cloudflare Web Analytics / Browser Insights & Bot Management:
    `https://static.cloudflareinsights.com` and a per-response `'nonce-<value>'` in `script-src` to
    allow dynamically tokenized proxy beacon injections and JavaScript Detections, and
    `https://cloudflareinsights.com` in `connect-src`.
  - Cloudflare Challenges / Turnstile: `https://challenges.cloudflare.com` in `script-src`,
    `connect-src`, and `frame-src`.
- Do not restrict `script-src`, `frame-src`, or `connect-src` without maintaining compatibility with
  these Cloudflare edge integrations.
