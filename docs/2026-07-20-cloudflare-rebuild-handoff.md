# Cloudflare Rebuild Handoff

**Prepared:** July 20, 2026 **Current repository:** `choir-management-tool` **Current branch:**
`main` **Parity baseline:** `6874d43a3c3698ae53218a44d17649bc454ca9ac` **Planned repository:**
`choir-management-cloudflare` **Current state:** Architecture and plan are complete; the local
target repository and immutable parity worktree are prepared; implementation has not started; no
Codex goal is active.

This document is the self-contained restart point for continuing the Cloudflare multitenant rebuild
on another machine. It intentionally contains no secrets.

## Preparation State on This Machine

The approved planning package was committed and pushed to legacy `main` in commit
`60d2e259352cb29848e41001c96da2dd9f5eafe2`. It is no longer dependent on uncommitted transfer state.

The immutable Parity Baseline is available in the detached sibling worktree
`/Users/wesandlaura/Downloads/choir-management-tool-parity` at
`6874d43a3c3698ae53218a44d17649bc454ca9ac`. The writable target repository is
`/Users/wesandlaura/Downloads/choir-management-cloudflare`.

The target repository contains the copied plan, glossary, ADRs, a Cloudflare-specific `AGENTS.md`,
and the durable goal/readiness files under `docs/goal/`. Treat `docs/goal/READINESS.md` in the
target repository as the live preflight record. Do not copy `.env`, Wrangler credentials, provider
secrets, GitHub tokens, or other secrets into source control.

## Read These Files in Order

1. `AGENTS.md` — mandatory repository instructions.
2. `docs/2026-07-20-cloudflare-rebuild-handoff.md` — this restart state.
3. `docs/2026-07-20-cloudflare-multitenant-rebuild-plan.md` — complete architecture, file
   responsibility map, milestones, gates, risks, and technical references.
4. `CONTEXT.md` — accepted product language and domain behavior.
5. `docs/adr/0003-*.md` through `docs/adr/0015-*.md` — accepted Cloudflare decisions.
6. Existing application code and tests at baseline commit `6874d43a3c3698ae53218a44d17649bc454ca9ac`
   — proof of implemented behavior.
7. Existing historical plans — supporting intent only; they are not evidence that proposed behavior
   was implemented.

The legacy repository's `AGENTS.md` uses standard project commands directly. No machine-specific
command wrapper is required. Preserve the remaining repository safety rules when creating the new
repository's agent instructions.

## Goal Statement to Resume With

Use this objective if starting a Codex goal:

> Create the new sibling repository `choir-management-cloudflare` and execute
> `docs/2026-07-20-cloudflare-multitenant-rebuild-plan.md` through a production-ready permanent
> staging deployment. Preserve every implemented module, workflow, export, public behavior,
> responsive/accessibility behavior, and visual characteristic from legacy baseline commit
> `6874d43a3c3698ae53218a44d17649bc454ca9ac`; implement the accepted multi-Organization Cloudflare
> architecture; keep the new repository fully standalone; do not migrate PocketBase data; and do not
> launch production until the complete parity matrix and release gates pass.

Suggested restart prompt:

> Read `AGENTS.md`, `docs/goal/GOAL.md`, `docs/goal/READINESS.md`,
> `docs/2026-07-20-cloudflare-rebuild-handoff.md`,
> `docs/2026-07-20-cloudflare-multitenant-rebuild-plan.md`, `CONTEXT.md`, and ADRs 0003–0015
> completely. Verify the detached parity worktree is exactly the recorded baseline and report
> unexpected changes. Then start Phase 0 of the plan. Keep new CI/runtime independent of the legacy
> checkout, and pause only when interactive account authorization, secure secret entry, an absent
> external entitlement, or a genuinely product-changing decision is required.

Do not create the goal until every item under “Required Before Goal Start” in the target
repository's `docs/goal/READINESS.md` is complete.

## Accepted Product Decisions

### Tenant and access model

- One tenant is one independently managed **Organization**.
- There is no umbrella Organization-to-Ensemble hierarchy in v1.
- One global identity may belong to multiple Organizations with different roles and different
  Profiles.
- Operational access is Organization-at-a-time. There are no cross-Organization operational queries
  or reports.
- Platform-wide views expose Organization metadata, health, and usage only.
- Organization Profiles may exist without login access.

### Storage and runtime boundary

- A control-plane D1 database owns global identities, Better Auth, the Organization registry,
  memberships, invitations, domains, platform metadata, and integration routing metadata.
- One SQLite-backed Durable Object per Organization owns all operational data.
- R2 stores original uploads and derived public projections under Organization-scoped keys.
- KV may cache derived hostname routing; D1 remains authoritative and KV never grants authorization.
- Queues handle external provider work and retries.
- Workflows handle long/resumable provisioning, domain onboarding, fleet migration preparation, and
  export work.
- Each Organization Durable Object owns its scheduler alarm. There is no platform-wide scan of
  tenant operational data.

This structure was selected to make accidental missing-tenant predicates substantially harder and to
match the Organization-at-a-time access rule.

### Supported scale

Design and test up to:

- 500 Profiles per Organization;
- 10,000 operational/commercial records per Organization;
- 25 simultaneous authenticated users per Organization;
- larger public bursts served from Published Projections and edge caching.

Expected real Organizations are roughly one-fifth of those limits.

### Roles and performer behavior

- **Organization Owner:** ownership/security boundary; at least one; multiple allowed.
- **Organization Administrator:** full operational administration.
- **Organization Member:** self-service portal access.
- **Platform Administrator:** cross-Organization platform operator; mandatory MFA.
- Voice part, performer status, section leadership, and notification responsibilities are Profile
  attributes, not authorization roles.
- Performer eligibility means a non-empty `voicePart`.
- An administrative Profile may have no `voicePart` and must be excluded from performer workflows.
- The stored status `Idle` displays as **On Break** in the UI but remains `Idle` in storage, APIs,
  and CSVs.

### Provisioning and delegated administration

- There is no public registration.
- A Platform Administrator manually provisions each Organization.
- Administrators can create Profiles without login access.
- Granting portal access sends an email invitation and creates/links a pending membership.
- Administrators never choose another user's password.
- The initial Owner can be invited, but a Platform Administrator may fully configure and launch the
  Organization before the Owner accepts.
- Platform Administrators are expected to perform about 70% of administration.
- They select one visible Organization scope and can easily enable short-lived edit elevation.
- There is no impersonation. Actions retain the actual Platform Administrator actor.
- Organization Owners and Administrators can see platform actions in Organization Audit History.
  Private platform notes remain private.

### Authentication

- Use Better Auth backed by control-plane D1.
- Use the Better Auth Organization model for membership.
- Primary sign-in is an emailed one-time code.
- Users may optionally set and use a conventional password.
- MFA is mandatory for Platform Administrators and optional for Organization roles.
- Platform Administrators retain recovery codes; production should have a documented
  break-glass/recovery procedure.

### Domains

- Every Organization receives a canonical product subdomain that serves the full authenticated and
  public application.
- Optional customer-owned custom domains serve public pages and public/signed flows only.
- Login, member, account-management, admin, and Platform Administrator routes remain on the
  canonical product subdomain.
- Public custom-domain coverage includes website, performances, tickets, donations, auditions, RSVP,
  polls, player, and personalized public links as applicable.
- Apex domains are supported where DNS can target the SaaS hostname through CNAME flattening or
  ALIAS/ANAME behavior.
- `www` is the documented fallback.
- V1 must not depend on universal Apex Proxying.

### Payments and platform pricing

- Platform access is permanently free; there are no subscriptions, plans, trials, entitlements,
  application fees, invoicing, or dunning.
- Each Organization owns a Stripe Connect connected account.
- Use direct charges for tickets, donations, dues, and bundles.
- The Organization is merchant of record and owns fees, refunds, disputes, taxes, and negative
  balances.
- Platform Administrators may initiate refunds with audit attribution.

### Email and SMS

- Cloudflare Email Service sends platform transactional messages only: login codes, invitations,
  security notices, and domain/integration notices.
- Organization campaigns, reminders, reports, ticket messages, and SMS use the Organization's own
  communications provider account and verified identity.
- Implement a provider-neutral adapter with Brevo first.
- Preserve Email, SMS, and Both; reach preview; SMS length behavior; templates; drafts; history;
  delivery summaries; suppressions; retries; failed-recipient retry; and test sends.
- The Organization owns sending cost, consent, deliverability reputation, branding, and
  suppressions.

### Frontend and public website

- Preserve behavior, visual character, responsiveness, accessibility, semantic theming, and
  interaction safety; frontend source compatibility is not required.
- Keep React, TypeScript, Vite, Tailwind, TanStack Query, TanStack Table, and dnd-kit.
- Replace Shoelace/Web Awesome with repository-owned shadcn-style components built on Radix
  primitives.
- Preserve responsive table/card layouts, mobile dialogs, confirmation patterns, and meaningful
  loading/error/empty states.
- The public website remains structured and module-driven: branded hero, About/History Markdown,
  featured/past performances, and navigation to current public modules.
- Do not build an arbitrary CMS, blog, or page builder in v1.

### Scope and release policy

- The first production release must contain every implemented current module and all functionality.
- Internal phases are engineering milestones only; partial production launch is not authorized.
- There is no PocketBase data migration. New Organizations begin empty.
- The immutable parity baseline is commit `6874d43a3c3698ae53218a44d17649bc454ca9ac`.

### Export

- Provide one Organization Export ZIP for Owners and Platform Administrators.
- Include manifest, schema/application versions, counts, checksums, CSV, JSON where CSV is lossy,
  audit history, and original uploaded files.
- Reuse existing CSV contracts for roster, music library, event RSVP roster, donations, attendance,
  repertoire history, and will-call.
- There is no whole-archive import, restoration, Organization deletion, timed recovery, or automated
  purge in v1.

### Repository and promotion

- Build in a new separate repository named `choir-management-cloudflare`.
- Keep the legacy repository pinned and read-only as the Parity Bridge.
- Keep the repositories as local siblings or in a multi-root workspace so AI tools can inspect both.
- Copy approved contracts, fixtures, screenshots, CSV specifications, glossary entries, and ADRs
  into the new repository.
- The new repository's CI, builds, deployment, tests, and runtime must work when the legacy
  repository is absent.
- Use isolated local, optional PR preview, permanent staging, and production resources.
- A merge to `main` deploys one commit and lockfile automatically to staging.
- Production approval promotes the identical commit with production bindings; there is no staging
  branch, cherry-pick, manual file transfer, or rebuild with different dependencies.
- Use expand/contract migrations and retain a known-good Worker version for rollback.

## Baseline Functional Inventory

Implemented module flags currently include:

- roster;
- events;
- attendance;
- RSVPs;
- music library;
- set lists;
- resources;
- reports;
- public website;
- directory;
- auditions;
- communications;
- polls;
- seating;
- ticket sales;
- donations;
- patrons.

Related implemented behavior also includes seasons and seasonal dues, setup/readiness, module
management, profile/self-service behavior, venues, calendar feeds, and platform/system settings.

Major public routes include setup/login/reset, auditions, RSVP, polls, unsubscribe, music player,
tickets and bundles, donations, landing/history/performances, and signed/personalized variants.

Major authenticated routes include dashboards, roster, events and event rosters, set lists, venues,
seating and seating finder, attendance, RSVP administration, polls, auditions, reports, music
library, public website settings, system/module/setup settings, communications, resources, ticket
administration/scanning, donations, patrons, directory, and profile.

### Background behavior that must not disappear

- Email/SMS queue processing and delivery state.
- Automated event reminders.
- Ticket-buyer reminders.
- Post-event attendance finalization and attendance reports.
- Stale pending ticket/donation checkout expiration.
- Time-based poll/archive behavior found during the parity inventory.

These map to per-Organization alarms, idempotent Organization job records, queues, bounded provider
calls, retry/backoff, and dead-letter visibility.

### File behavior that must be represented in R2

- Profile photos.
- Organization logo.
- Landing-page hero image.
- Event graphics.
- Singer resources.
- Music learning/reference audio and track mappings.
- Configurable QR/ticket imagery where implemented.

## Architecture Summary

The target is one TypeScript npm-workspace repository:

- `apps/web`: React/Vite frontend;
- `apps/worker`: Hono-based Worker, Better Auth, D1, Durable Object, queue/workflow entry points,
  public projection and webhook handling;
- `packages/contracts`: Zod request/response/job contracts;
- `packages/domain`: pure domain rules and calculations;
- `packages/ui`: repository-owned Radix-based components;
- `packages/testkit`: fixtures and Cloudflare/browser test harnesses.

The Worker resolves the request hostname before authorization. The resolved registry ID—not a
client-supplied Organization ID—selects the Durable Object. Membership or scoped Platform
Administrator elevation is checked before operational access. Public content is materialized as a
versioned projection in R2/cache so bursts do not serialize through the Organization object.

The detailed D1 tables, Organization schema areas, API route groups, job rules, export format, test
gates, file responsibility map, milestones, risks, and completion definition are in
`docs/2026-07-20-cloudflare-multitenant-rebuild-plan.md`.

## Cloudflare and GitHub Access State

Current machine checks:

- Node.js `v26.5.0`, npm/npx `11.17.0`, and GitHub CLI `2.96.0` are installed.
- The Codex GitHub connector is authenticated as `wesochuck` with admin access to the legacy
  repository.
- GitHub CLI authentication is still pending and must be completed interactively.
- `wrangler` is not installed globally or pinned in the target package yet; Wrangler authentication
  is pending.
- No Cloudflare, Stripe, Brevo, or Turnstile environment-variable names were found in the current
  process.
- The target repository exists locally but `wesochuck/choir-management-cloudflare` does not yet
  exist on GitHub.

This means local development can begin after dependencies are installed, but remote staging,
custom-domain qualification, real platform email, CI publication, and provider integration cannot
complete until access is authorized.

## One-Time Setup on the New Machine

### 1. Transfer and verify the legacy baseline

- Use the prepared `choir-management-tool-parity` detached worktree, or reproduce it from the
  recorded commit.
- Verify the dedicated reference checkout resolves to `6874d43a3c3698ae53218a44d17649bc454ca9ac`
  before treating it as the Parity Baseline.
- Preserve any unexpected worktree changes; do not reset them.
- Install dependencies with `npm ci` if local baseline tests or screenshots are needed.

### 2. Restore developer authentication

Authenticate GitHub interactively if the agent is expected to create/push the new repository:

```text
gh auth login -h github.com
gh auth status
```

Authenticate Cloudflare interactively after Wrangler is installed in the new repository:

```text
npx wrangler login --use-keyring
npx wrangler whoami
```

The new repository should carry forward the applicable safety, verification, and reporting policies
from `AGENTS.md`, but it must not depend on a machine-specific command wrapper.

Do not paste OAuth tokens, API tokens, API keys, account secrets, one-time codes, or recovery codes
into chat or commit them. Use Wrangler's login/keyring flow, Worker secrets, and GitHub environment
secrets.

### 3. Supply the Cloudflare deployment choices

These values are not yet known and should be recorded in the new repository's private deployment
configuration, not this public handoff:

- Cloudflare account name and account ID.
- Product base domain/zone.
- Desired canonical subdomain pattern.
- Permanent staging hostname.
- Whether staging and production use the same Cloudflare account with isolated resources or separate
  accounts.
- Platform email sending domain and test-recipient policy.
- A safe customer-owned test subdomain and apex domain.
- Platform Administrator bootstrap email identities.

Once authenticated, the agent can create the environment-specific D1 databases, R2 buckets, KV
namespaces, queues/dead-letter queues, Durable Object bindings, Workflows, Worker versions, routes,
and secrets. These do not need to be manually pre-created unless account policy requires it.

### 4. Confirm Cloudflare product readiness

- Workers account and permissions can create/edit Workers, D1, R2, KV, Queues, Durable Objects,
  Workflows, routes, and secrets.
- The chosen zone is present and editable.
- Cloudflare for SaaS is enabled on the chosen zone.
- A fallback origin and friendly CNAME target can be configured for custom hostnames.
- Hostname and certificate validation can be tested to `active` state.
- Cloudflare Email Sending is enabled for the account and the platform sending domain is onboarded
  with its DNS records.
- CI receives a least-privilege token or supported Cloudflare build integration; do not reuse a
  developer OAuth token as a permanent CI secret.

Cloudflare's current official references:

- Wrangler login and `whoami`:
  <https://developers.cloudflare.com/workers/wrangler/commands/general/>
- Workers testing and Vitest integration: <https://developers.cloudflare.com/workers/testing/>
- Local and remote binding support:
  <https://developers.cloudflare.com/workers/local-development/bindings-per-env/>
- Cloudflare for SaaS setup:
  <https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/>
- Hostname/certificate validation:
  <https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/>
- Email Service onboarding:
  <https://developers.cloudflare.com/email-service/get-started/send-emails/>

### 5. Prepare external provider test access when its milestone approaches

Stripe Connect:

- test-mode platform account with Connect enabled;
- test client ID/OAuth or chosen connected-account onboarding configuration;
- test secret key stored as a Worker secret;
- staging webhook endpoint and signing secret;
- one test connected Organization account;
- authorization to create test charges, refunds, disputes/replay cases, and webhook fixtures.

Brevo:

- Organization-owned test API key stored through the encrypted credential path;
- verified email sender/domain;
- test-recipient allowlist;
- SMS-enabled test configuration and a safe test number if SMS parity is to be exercised;
- webhook signing/verification configuration if used.

Do not block repository and local platform work on these credentials. They become required for the
communications and commerce staging gates.

## Testing Strategy on the New Machine

Cloudflare's Workers Vitest integration can locally test request handling, isolated storage, D1
migrations, Durable Objects, direct Durable Object access, alarms, R2, KV, queues, Workflows, and
outbound request mocks. Use this for fast deterministic coverage.

Permanent staging is still required because local simulation does not prove:

- deployed Worker bindings and IAM;
- real Durable Object namespace behavior under deployment;
- custom hostname ownership and certificate activation;
- DNS and apex/`www` behavior;
- Cloudflare Email Service sending and deliverability;
- real queue retry/dead-letter operations and observability;
- Stripe/Brevo webhook reachability;
- same-commit staging-to-production promotion and rollback.

Use separate resources for local/preview, permanent staging, and production. Preview cannot send
real messages or create real charges. Staging uses provider sandbox/test modes or allowlisted
recipients. Production receives the exact staging-qualified commit and lockfile with production
bindings.

## Implementation Restart Sequence

1. Planning documents transferred and verified — complete locally.
2. Reauthenticate GitHub and Cloudflare; record the account/domain choices without exposing secrets
   — pending interactive authorization and deployment inputs.
3. Create the private sibling repository `choir-management-cloudflare` — complete locally; GitHub
   remote pending.
4. Copy `CONTEXT.md`, accepted ADRs, the rebuild plan, and this handoff — complete locally.
5. Create a Cloudflare-specific `AGENTS.md` that carries forward non-PocketBase rules and removes
   PocketBase/Goja/hook/migration mechanics — complete locally.
6. Pin the legacy repository at the baseline commit and document the sibling Parity Bridge —
   complete locally. Do not add runtime imports or CI checkout dependencies.
7. Execute Phase 0: build the exhaustive parity matrix from code/tests, capture
   fixtures/screenshots, copy existing CSV contracts, and classify historical plans.
8. Execute Phase 1: scaffold workspaces, strict checks, Worker/Vite test harness, isolated
   environments, and permanent staging health deployment.
9. Continue the plan milestone-by-milestone, expanding and validating the File Responsibility Map
   for each milestone.
10. Do not treat a visually complete subset as done; production remains blocked until every parity
    entry and release gate passes.

## Questions That Remain Open

These are deployment inputs, not unresolved architecture:

- Which Cloudflare account should own the platform?
- What is the product name and base domain?
- What permanent staging hostname should be used?
- Should the new GitHub repository be private? Recommended: private during the rebuild.
- Which domain should send platform login/invitation email?
- Which domain(s) can safely be used for custom subdomain and apex staging tests?
- Which email addresses become the initial Platform Administrators?
- When should Stripe and Brevo staging credentials be made available?

Local implementation and parity capture can proceed before most of these are answered. Account
authentication and a selected zone are required before the first real staging deployment.

## Verification Already Performed

- `git diff --check` passed after the planning edits.
- Prettier check passed for `CONTEXT.md`, the rebuild plan, and all ADRs.
- No application TypeScript, generated PocketBase files, historical migrations, schema, or
  production data was changed.
- `tsc -b --force` and application tests were not run because the changes were documentation-only.
- No unsafe TypeScript patterns were introduced.

## Resume Completion Check

Before implementation resumes, the new agent should be able to state:

- the exact Parity Baseline commit;
- which repository is read-only and which is the standalone target;
- the Organization tenant/storage boundary;
- the role, authentication, domain, payment, and email/SMS decisions;
- the no-data-migration and whole-product-parity constraints;
- which credentials/resources are present and which remain deferred;
- the first incomplete milestone and its complete File Responsibility Map.

If any of those cannot be established from the transferred files, stop before implementation and
repair the handoff rather than guessing.
