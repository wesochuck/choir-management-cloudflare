# Parity Completion Plan

**Audit date:** July 28, 2026 **Baseline:** `6874d43a3c3698ae53218a44d17649bc454ca9ac` **Matrix:**
`docs/parity/feature-matrix.yaml`

## Audit result

The parity checker validates the baseline commit, route/API inventory, unique IDs, status values,
and target-evidence paths. It does not prove that an entry's behavior matches the baseline. A second
pass compared the current implementation with the legacy source, current contracts, the Organization
Durable Object handlers, and the focused browser/integration tests.

The matrix now records **69 verified, 121 implemented, 0 partial, and 0 planned** entries across
nine sections (190 entries total after adding the asynchronous export routes). `verified` means the
entry has both the required local evidence and permanent-staging evidence; `implemented` means the
behavior and focused local/integration evidence exist, while staging proof is still outstanding;
`partial` means the feature has target code or a renamed replacement, but the baseline contract is
not yet complete. Before the route-contract repair, setup recovery and Stripe were the two real
compatibility gaps; both now have typed target handlers and focused local evidence.

### Closed gaps and evidence

| Area                | Closed behavior and evidence                                                                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auditions           | Public settings/slot/closed/scheduled states, admin lifecycle routes, token atomicity, tenant isolation, and browser coverage are now represented by `auditions.spec.ts`, `publicAudition.integration.test.ts`, and `calendarManagement.integration.test.ts`.          |
| Music and set lists | Recency/count projections, atomic event persistence, keyboard and touch ordering, copy, print, mobile cards, and light-theme switching are covered by `music.integration.test.ts` and `setlists.spec.ts`.                                                              |
| Organization export | Typed queued/processing/completed/failed contracts, bounded R2 archive generation, checksum manifest, owner/elevated-platform authorization, replay-safe completion, download verification, and audit records are covered by `calendarManagement.integration.test.ts`. |
| Mobile shell focus  | Staging exposed a drawer focus-return regression; the Radix Sheet now restores focus to the trigger on Escape/close, with mobile browser coverage in `auth.spec.ts`.                                                                                                   |

### Open work across the remaining entries

The remaining 121 non-verified entries are staging evidence debt for the 121 implemented entries:

| Section               | Entries still `implemented` | Completion evidence still required                                                                                                                                 |
| --------------------- | --------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public browser routes |                           0 | All 60 browser routes now have a deployed route/empty-state sweep; retain these checks in release automation.                                                      |
| API routes            |                          68 | Read and mutation contract probes using seeded staging Organizations, including authorization, MFA, validation, tenant isolation, and safe fake-provider outcomes. |
| Record hooks          |                           4 | Workerd/integration replay and audit evidence on the deployed schema; no live external effect.                                                                     |
| Background tasks      |                           5 | Queue/alarm replay, retry, idempotency, and dead-letter visibility evidence with staging-safe fixtures.                                                            |
| CSV contracts         |                           7 | Import/export round trips and malformed/oversized input checks against Organization-scoped fixtures.                                                               |
| Signed flows          |                           7 | Expiry, revocation, purpose binding, tenant binding, and successful signed-link browser/API checks.                                                                |
| Domain workflows      |                          20 | End-to-end success, authorization failure, rollback compatibility, and audit attribution for the remaining workflow families.                                      |
| File behaviors        |                           5 | Upload/download/public-media checks, key isolation, and metadata/body agreement using non-sensitive fixtures.                                                      |
| Responsive states     |                           5 | Public checkout, setup, communications, and data-table mobile screenshots/interaction checks; focused dialog, seating, and theme states are already verified.      |

The setup recovery and Stripe webhook entries are now implemented with typed, tenant-scoped handlers
and focused tests. Staging still needs signed-provider fixtures and authenticated replay,
authorization, and tenant-isolation evidence before those entries can be promoted to `verified`. The
current staging Worker secret inventory contains no `STRIPE_WEBHOOK_SECRET` and no Brevo
credentials, so this is an external secure-secret prerequisite rather than a code failure; do not
seed placeholder provider keys into staging.

### Completion plan for the repaired provider contracts

- **Setup recovery:** the Better Auth replacement contract is implemented: a recently MFA-verified
  Platform Administrator, scoped to one hostname and active elevation, creates or upgrades the
  administrator membership, links an Organization Profile, records an audit event, and rolls back
  partial writes. Password fields are accepted only for legacy shape validation and never stored or
  logged. Remaining work is staging replay and invitation/rollback evidence.
- **Stripe webhook:** raw-body `Stripe-Signature` verification with a bounded timestamp window,
  event-id idempotency, module/Organization metadata checks, checkout-completed/expired and
  charge-refunded transitions, and audit persistence are implemented for ticketing, donations, and
  dues. Keep fake mode deterministic in local tests; staging still needs a secure test-mode secret,
  signed fixtures, queue assertions, and a provider rollback drill.

  The donation contract now derives and persists legacy-compatible `expired`/`expiredAt` state
  through a forward-only Organization schema v34 `donation_expirations` table; completion removes
  the marker and returns the donation to `paid`. Dues intentionally retain their existing `pending`
  contract while recording the provider-expiry audit. Local expiry, replay, and
  completion-after-expiry coverage is green; staging still needs the signed provider fixture and
  rollback drill.

The remaining 121 `implemented` entries are evidence debt: each has target code and focused tests,
but still needs the staging success plus authorization, validation, retry, or tenant-isolation proof
listed in the table. Keep these entries as `implemented` until that evidence is captured.

The `route.admin.auditions` target evidence was corrected to point to `AuthenticatedShell.tsx` (the
actual route owner) and `auditions.spec.ts`.

## Completion phases

### Phase A — Audition closure (complete)

**Owners:** `apps/web/src/public/PublicAuditionView.tsx`,
`apps/web/src/account/components/AuditionManager/page.tsx`, `apps/web/e2e/auditions.spec.ts`,
`apps/worker/test/publicAudition.integration.test.ts`, and the audition routes/store/consumer.

- Added settings/slot/transition/notification integration cases and route status mapping.
- Added browser coverage for public settings/scheduled details and the admin workflow.
- Verified fake/disabled provider behavior, retry/replay idempotency, actor audit, and
  hostname-resolved tenant isolation.

**Exit criteria:** met locally; no provider call occurs inside a transaction.

### Phase B — Music and set-list closure (complete)

**Owners:** `apps/worker/src/organization/musicStore.ts`, `organizationMusic.ts`, contracts,
`apps/web/src/account/components/MusicCatalog/controller.tsx`,
`apps/web/src/account/components/SetListManager/controller.tsx`, domain tests, and dedicated E2E
specs.

- Confirmed no separate performance relationship editor is required by the baseline and retained
  bounded recency/count projections.
- Added pointer/touch/keyboard sortable set-list items, list/text copy, print styling, and mobile
  cards while preserving the atomic event update path.

**Exit criteria:** met locally with domain, integration, and browser evidence.

### Phase C — Portable Organization export (complete)

**Owners:** new typed export contract/domain module, `apps/worker/src/organization/exportStore.ts`,
`apps/worker/src/organization/organizationExport.ts`, router, bounded export job/outbox support,
private R2 storage helpers, and export integration tests.

- Define an additive request/response contract and a versioned archive manifest containing
  Organization metadata, records, audit events, file metadata, checksums, byte counts, and export
  version.
- Stream or stage bounded chunks; never load an unbounded Organization into memory or perform
  provider work inside a DO transaction.
- Authorize only an Owner or explicitly elevated Platform Administrator on the hostname-resolved
  Organization. Scope every record and R2 key to that Organization.
- Make retries idempotent, redact secrets/token bytes, and provide a documented rollback path.

**Exit criteria:** met locally with checksum validation, file inventory, authorization failures,
cross-tenant denial, retry/replay, bounded size handling, and audit attribution covered by
integration tests. The PocketBase-era synchronous compatibility endpoint is removed; the settings
page and API use the asynchronous export contract only.

### Phase D — Route-contract repair and legacy removal (completed locally)

**Owners:** `apps/worker/src/router.ts`, Organization payment/queue/setup modules, contracts, and
the API integration suite.

- Remove PocketBase-era forwarding and dead aliases, then normalize remaining product routes to the
  canonical public, Organization, Platform, setup, singer, account, webhook, and health namespaces
  without bypassing hostname resolution, MFA, module guards, audit attribution, or request-size
  limits.
- Finish setup recovery through a documented Better Auth administrator-recovery flow, or explicitly
  retire the old superuser/password path with a versioned migration and owner-approved contract.
- Rebuild Stripe webhook behavior from the legacy contracts, including signature verification,
  idempotency, payment/refund state transitions, and safe fake-provider behavior in staging.
- Keep contract tests on canonical paths for success, malformed input, unauthorized/MFA failure,
  cross-tenant identifiers, and replay.

**Exit criteria:** the implementation audit passes with no implemented/verified API missing from
`router.ts`; every repaired entry is promoted to implemented with focused tests or changed to
blocked/superseded with an approved contract note.

Route-contract repair evidence: 87 unit tests, 118 integration tests, the Stripe Durable Object
completion/replay/refund/expiry test, and clean commit `deecd8d` deployed as staging Worker version
`42fc841d-77c7-4c09-a952-b9672768882d`. Anonymous staging health/readiness probes pass; setup status
correctly returns 401 without a session, while Stripe remains fail-closed with a typed 503 until a
secure staging webhook secret and signed provider fixture are supplied.

The same deployment passed a cache-busted route sweep of all 60 browser entries and 70 API entries:
2 public 200s, 13 validation 400s, 53 authorization 401s, four expected invalid-link/not-found 404s,
and one typed Stripe configuration 503. No route-level 404 occurred.

The local Milestone 6 scale slice now seeds 5,000 active Profiles and 500 upcoming events inside one
Organization Durable Object, then exercises the dashboard-summary API. The response returns exact
counts and only five next events in under one second, demonstrating that the overview uses bounded
`COUNT`/`LIMIT` queries rather than loading the full dataset. This is local qualification evidence;
the permanent-staging scale gate remains open until it runs against the deployed Cloudflare
primitives.

### Phase E — Evidence and staging qualification (in progress)

**Owners:** parity maintainers, route owners, and release engineering.

- Retain focused route tests for the new audition, set-list, theme, and export behavior; unchanged
  parity routes continue to use their existing shared-shell and integration evidence.
- Keep responsive browser proof for theme, public/admin audition, set lists, and existing seating
  focus/mobile modes.
- Keep source paths alongside executable test references for traceability.
- Run `format:check`, lint, strict typecheck, unit, integration, E2E, build, parity validation,
  implementation parity validation, and high-severity audit. The corrected qualified commit
  `971e4f5` is deployed to permanent staging as Worker version
  `b5515d2e-11ab-4e99-87e6-d1ede621dec7`.
- Complete authenticated Organization, member, Account, and Platform Administrator browser checks
  from a signed-in staging session, including tenant switching, export completion, mobile drawer
  Escape/focus return, active navigation semantics, light-theme switching, and the MFA boundary. The
  focused entries now have permanent-staging evidence; the 124 remaining implemented entries retain
  their local/integration evidence until their route-, workflow-, or contract-specific staging proof
  is captured.
- Add a bounded staging qualification suite in four batches: public/signed browser flows, API
  contract families, queue/file/CSV workflows, and responsive visual states. Use seeded LCC/LMC
  fixtures, fake external effects, and read-only cleanup so the qualification cannot mutate a
  production resource or cross an Organization boundary.
- Promote an entry from `implemented` to `verified` only after its successful path and the relevant
  failure/isolation path are recorded in the test output or a dated staging probe. Keep the matrix
  count and this table synchronized after each batch.

July 28 staging evidence now covers the deployed shell and anonymous route boundary: the current
CI-promoted Worker (`c57fb241-d693-4b30-aa56-ed89ada0098b`, commit `4833e18`) returned HTTP 200 for
all 60 browser routes on the product, LCC, and LMC hosts. The 73 API contracts returned only the
expected public, validation, authorization, and invalid-link/not-found responses for anonymous
requests; Stripe alone returned the intentional typed 503 because its webhook secret is not yet
configured. No router-level 404 or unhandled 5xx occurred. This closes the public-shell sweep but
does not promote authenticated API, queue/file/CSV, signed-flow, or responsive entries by itself.

**Exit criteria:** no `partial` or `planned` statuses remain and the local gate passes. Phase E
remains open until the 121 implemented entries are staging-verified or explicitly blocked by a
documented external prerequisite; production remains unlaunched.

### Phase F — Whole-product release gate (not started)

The local 5,000-Profile/500-event dashboard-summary slice is complete, but the deployed Cloudflare
scale check, custom/apex/www domain behavior, Platform email sandbox delivery, queue and dead-letter
replay, Stripe/Brevo webhook verification, exports, schedulers, observability, migrations,
dependency audit, security/tenant-isolation probes, and rollback drill still need dated staging
evidence. Do not mark the goal complete while any partial entry, unqualified provider workflow, or
high-severity finding remains.

## Rollback and risk notes

- All storage changes are forward-only and additive; retain old audition fields and payload
  compatibility during rollout.
- Organization schema v34 adds only the tenant-local `donation_expirations` marker table; existing
  donation rows and columns are untouched. A rollback to a pre-v34 Worker ignores the additive table
  and continues to see the underlying donation as pending, so no destructive downgrade is required.
- Audition messages and export jobs must honor fake/disabled external-effect modes in local,
  preview, and staging environments.
- Hostname-first Organization resolution remains authoritative for every new route, DO call, R2 key,
  job envelope, and audit event.
- The largest performance risks are unbounded export snapshots and repeated music-performance scans;
  use bounded pagination/chunking and precomputed maps/aggregates.
- Accessibility acceptance includes keyboard/screen-reader operation, visible destructive
  confirmations, focus return, and mobile drawer/dialog behavior.

## File Responsibility Map additions

The rebuild plan now owns this audit artifact:

| Path                                                  | Responsibility                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `docs/parity/completion-plan.md`                      | Code/test-backed parity audit, confirmed gaps, evidence debt, phased completion plan, and exit criteria |
| `scripts/audit-parity-implementation.mjs`             | Fails the gate when an implemented/verified API has no matching Worker route; reports partial API work  |
| `apps/worker/src/organization/reconciliationStore.ts` | Read-only Organization consistency report; no automatic historical repair                               |

The August 1 decomposition pass also owns the contract, delivery, API-client, route, schema,
OrganizationStore, and UI submodule paths listed in the rebuild plan. The post-deletion matrix has
181 entries; removed aliases have no redirects or remaining source/test/probe references.
