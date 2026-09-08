# Integration Test Isolation and Parallelism

Phase 5 evidence for `docs/2026-09-07-test-suite-improvement-plan.md` sections 4.15-4.16.

## State-isolation rules

The shared harness is `apps/worker/test/organization.integration.fixture.ts`. Its header comment is
the normative rule list; the short version:

1. Every `*.integration.test.ts` file seeds all D1/DO state in `beforeEach` via
   `setupOrganizationIntegration` and releases it in `afterEach` via
   `teardownOrganizationIntegration` (per-file Miniflare `reset()`).
2. No `beforeAll`/`afterAll` shared mutable state; no dependence on file execution order. Verified
   2026-09-07: no `beforeAll`/`afterAll` and no top-level `let`/`var` in any integration file.
3. Reusing the same `organization-alpha`/`organization-bravo` slugs across files is intentional and
   safe (storage is isolated per file). Do not invent unique slugs per file; that hides leakage
   instead of preventing it.
4. `auth.*` suites keep `auth.integration.fixture.ts` (Better Auth session layer) and ticketing
   suites keep `ticketing.integration.fixture.ts` (custom public-domain seed); everything else uses
   the shared harness.
5. New per-file binding/seed boilerplate belongs in the harness, not in test files.

## Files changed (no splits)

- Added `apps/worker/test/organization.integration.fixture.ts` (`requireIntegrationBinding`,
  `setupOrganizationIntegration`, `teardownOrganizationIntegration`, plus the rule documentation
  above).
- Migrated `apps/worker/test/calendarManagement.integration.test.ts` (~61 KB, 12 tests) and
  `apps/worker/test/communications.integration.test.ts` (~51 KB, 8 tests) to the harness. Seed
  values are unchanged (calendar keeps custom `Organization Alpha`/`Bravo` display names asserted by
  the setup-status test; communications keeps alpha-admin / bravo-member roles). Net effect is
  deleted boilerplate only.
- Added `OrganizationStoreNamespace` / `TestWorkerFetcher` type re-exports to
  `packages/testkit/src/index.ts` so worker-side fixtures can type the shared harness without
  duplicating structural types. No runtime change.
- No app behavior changes. No route, migration, or parity-ledger changes.

### Why no file splits

Evaluated `calendarManagement` (export/auditions/dashboard/setup/finance/polls/
venues-events/RSVP/deadlines), `communications` (reach/drafts/dedupe/queue/cancel/
sender/unsubscribe), `auth.platform` (already on the auth fixture), and `scheduler`. Each file's
tests share one seed shape and sign-in flow, have no order dependence, and failures already localize
to a single `it`. Splitting would multiply per-file Miniflare boot cost (serial import time is ~105
s across 47 files) without any isolation gain, since isolation is already per file. Revisit only if
one file's runtime dominates the suite; the behavior seams listed above are the split boundaries to
use.

## Benchmark: serial vs parallel (2026-09-07, local machine)

Command serial: `npm run test:integration:prepared` (config `fileParallelism: false`). Command
parallel: `npx vitest run --config vitest.integration.config.ts --fileParallelism --maxWorkers=2`
(CLI override; committed as config default after the experiment).

| Run | Mode                | Files     | Tests      | Failures | Duration |
| --- | ------------------- | --------- | ---------- | -------- | -------- |
| 1   | serial              | 47 passed | 269 passed | 0        | 184.85 s |
| 2   | parallel, workers=2 | 47 passed | 269 passed | 0        | 115.03 s |
| 3   | parallel, workers=2 | 47 passed | 269 passed | 0        | 118.93 s |
| 4   | parallel, workers=2 | 47 passed | 269 passed | 0        | 115.54 s |
| 5   | serial              | 47 passed | 269 passed | 0        | 184.89 s |
| 6   | parallel, workers=2 | 47 passed | 269 passed | 0        | 114.10 s |

Result: parallel with 2 workers is ~37% faster (~116 s vs ~185 s, ~70 s saved) with zero failures
across 4 parallel and 2 serial full-suite runs.

Log-noise comparison (full captured logs of runs 5 and 6): byte-identical benign signatures -- 15
`ContactStoreError` emissions from tests that deliberately exercise contact error paths
(duplicate/import-conflict/not-found), plus the 1 known benign `deleteAllDurableObjects` Miniflare
teardown line documented in `vitest.integration.config.ts`. Parallelism introduces no new noise.

One transient flake was observed outside the full-suite runs: a 2-file filtered serial run failed
one communications unsubscribe assertion (`expected 200 to be 400`) and passed on immediate re-run
with identical code, then passed in all 6 full-suite runs. It is a serial-mode cold-start flake, not
a parallelism or harness regression (the harness preserves exact seed values and ordering).

## Decision

Adopt `fileParallelism: true` with `maxWorkers: 2` as the committed default (plan criterion:
measurably faster AND equally reliable -- both met). The worker cap stays conservative: each file
boots its own Miniflare instance, so 2 bounds memory while still overlapping the ~105 s of serial
import/boot time. pool-workers stays pinned at 0.20.1 (0.22.0 known worse; not re-evaluated here).

To re-run the experiment after major suite changes, compare `npm run test:integration:prepared`
against the same command with `--fileParallelism --maxWorkers=2` (or `--no-file-parallelism` to
force serial) at least 3 times each and check both duration and the `uncaught exception` noise
signature.
