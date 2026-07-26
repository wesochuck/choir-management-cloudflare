# Parity Completion Plan

**Audit date:** July 26, 2026 **Baseline:** `6874d43a3c3698ae53218a44d17649ca9ac` **Matrix:**
`docs/parity/feature-matrix.yaml`

## Audit result

The parity checker validates the baseline commit, route/API inventory, unique IDs, status values,
and target-evidence paths. It does not prove that an entry's behavior matches the baseline. A second
pass compared the current implementation with the legacy source, current contracts, the Organization
Durable Object handlers, and the focused browser/integration tests.

The matrix now records **190 implemented, 0 partial, and 0 planned** entries across nine sections
(190 entries total after adding the asynchronous export routes). No entry is marked `verified` yet
because the current changes have not been requalified on permanent staging. The implementation gaps
from the first audit are closed locally; the remaining release work is qualification evidence,
including a permanent-staging probe and the full repository gate.

### Closed gaps and evidence

| Area                | Closed behavior and evidence                                                                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auditions           | Public settings/slot/closed/scheduled states, admin lifecycle routes, token atomicity, tenant isolation, and browser coverage are now represented by `auditions.spec.ts`, `publicAudition.integration.test.ts`, and `calendarManagement.integration.test.ts`.          |
| Music and set lists | Recency/count projections, atomic event persistence, keyboard and touch ordering, copy, print, mobile cards, and light-theme switching are covered by `music.integration.test.ts` and `setlists.spec.ts`.                                                              |
| Organization export | Typed queued/processing/completed/failed contracts, bounded R2 archive generation, checksum manifest, owner/elevated-platform authorization, replay-safe completion, download verification, and audit records are covered by `calendarManagement.integration.test.ts`. |

### Evidence debt across the remaining entries

The matrix is now implementation-complete. Some unchanged legacy routes still rely on shared shell
or integration evidence rather than a one-file-per-route browser test; that is retained as traceable
evidence debt for the final `verified` pass rather than represented as an unfinished feature.

The `route.admin.auditions` target evidence was corrected to point to `AuthenticatedShell.tsx` (the
actual route owner) and `auditions.spec.ts`.

## Completion phases

### Phase A — Audition closure (complete)

**Owners:** `apps/web/src/public/PublicAuditionView.tsx`,
`apps/web/src/account/AuditionManager.tsx`, `apps/web/e2e/auditions.spec.ts`,
`apps/worker/test/publicAudition.integration.test.ts`, and the audition routes/store/consumer.

- Added settings/slot/transition/notification integration cases and route status mapping.
- Added browser coverage for public settings/scheduled details and the admin workflow.
- Verified fake/disabled provider behavior, retry/replay idempotency, actor audit, and
  hostname-resolved tenant isolation.

**Exit criteria:** met locally; no provider call occurs inside a transaction.

### Phase B — Music and set-list closure (complete)

**Owners:** `apps/worker/src/organization/musicStore.ts`, `organizationMusic.ts`, contracts,
`apps/web/src/account/MusicCatalog.tsx`, `apps/web/src/account/SetListManager.tsx`, domain tests,
and dedicated E2E specs.

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
integration tests. The legacy synchronous endpoint remains as a rollback-compatible compatibility
route while the settings page uses the asynchronous contract.

### Phase D — Evidence and staging qualification

**Owners:** parity maintainers, route owners, and release engineering.

- Retain focused route tests for the new audition, set-list, theme, and export behavior; unchanged
  parity routes continue to use their existing shared-shell and integration evidence.
- Keep responsive browser proof for theme, public/admin audition, set lists, and existing seating
  focus/mobile modes.
- Keep source paths alongside executable test references for traceability.
- Run `format:check`, lint, strict typecheck, unit, integration, E2E, build, parity validation, and
  high-severity audit. Deploy the exact qualified commit to permanent staging and capture the
  staging request IDs/version IDs in `docs/goal/READINESS.md`.

**Exit criteria:** no `partial` or `planned` statuses remain and the local gate passes. Permanent
staging qualification remains the only release step; production remains unlaunched.

## Rollback and risk notes

- All storage changes are forward-only and additive; retain old audition fields and payload
  compatibility during rollout.
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

| Path                             | Responsibility                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `docs/parity/completion-plan.md` | Code/test-backed parity audit, confirmed gaps, evidence debt, phased completion plan, and exit criteria |
