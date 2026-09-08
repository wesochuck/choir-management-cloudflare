# Test Suite Improvement Plan

- **Status:** Proposed
- **Date:** 2026-09-07
- **Review basis:** `main` at `faac48801492942008338b8967d2111e805a8abd`
- **Scope:** Improve confidence, maintainability, accessibility coverage, and release qualification
  across Vitest unit tests, Cloudflare integration tests, and Playwright browser tests.
- **Review method:** Static repository review. The suite was inspected through the repository, but
  the tests were not executed as part of this review.
- **Repository constraint:** Keep the current local-release-gate model. GitHub Actions is
  intentionally not required by this plan.

## 1. Executive summary

The project already has a stronger test foundation than many applications at this stage:

- `vitest.config.ts` runs unit/component-style tests across `packages/**`, `apps/**`, and
  `scripts/**`.
- `vitest.integration.config.ts` uses the Cloudflare Vitest pool with the real Wrangler
  configuration and D1 migrations.
- Playwright covers desktop Chromium and a Pixel 7 Chromium profile.
- `scripts/run-e2e-servers.mjs` builds the web app, applies local D1 migrations, starts the Worker,
  and serves the built web app before browser tests.
- `scripts/check-ci.mjs` provides a broad local release gate covering static checks,
  contracts/parity checks, unit tests, build verification, and Workerd integration tests.
- Domain and Worker behavior are generally covered with focused tests, while larger integration
  suites exercise real Cloudflare runtime behavior.

The main opportunity is not simply to add more tests. It is to improve **what kinds of failures the
suite can detect** and make the existing tests easier to maintain.

The highest-value improvements are:

1. Establish useful code-coverage visibility and then ratchet coverage in critical areas.
2. Add browser-like interaction tests for shared UI components instead of relying mainly on
   server-rendered markup assertions.
3. Break up and centralize the large Playwright mock fixtures, especially
   `apps/web/e2e/auth.spec.ts`.
4. Add a small set of true full-stack browser smoke tests that intentionally avoid API route
   mocking.
5. Make browser testing part of a clearly defined full release qualification command while
   preserving the existing browser-free `check:ci` workflow if desired.
6. Add automated accessibility checks and keyboard/focus tests for critical components and pages.
7. Evaluate integration-test file parallelism carefully, but do not enable it blindly because the
   current config documents Miniflare teardown behavior.
8. Add selective WebKit coverage, particularly for mobile behavior, without making every local run a
   full browser matrix.

## 2. Current state and findings

### 2.1 Unit and component tests

`vitest.config.ts` currently:

- includes `packages/**/*.test.{ts,tsx}`, `apps/**/*.test.{ts,tsx}`, and `scripts/**/*.test.mjs`;
- excludes integration tests;
- has V8 coverage configured but explicitly disabled.

This is a good broad default test command. The largest missing signal is coverage visibility.
`@vitest/coverage-v8` is already installed, so adding a coverage command should be low-friction.

Shared UI tests exist, but at least some are markup-oriented rather than interaction-oriented. For
example, `packages/ui/src/DataTable.test.tsx` uses `react-dom/server` and string assertions against
rendered HTML. That is useful for structural regressions, but it cannot prove:

- keyboard navigation;
- focus movement/restoration;
- click/tap behavior;
- dialog focus trapping;
- live state changes;
- browser accessibility-tree behavior.

Keep the lightweight markup tests where they are useful, but add a browser-like test layer for
interactive components.

### 2.2 Cloudflare integration tests

`vitest.integration.config.ts` is appropriately closer to the production runtime:

- it uses `@cloudflare/vitest-pool-workers`;
- it reads actual D1 migrations;
- it uses `apps/worker/wrangler.jsonc`;
- it has bounded 15-second test and hook timeouts;
- it intentionally sets `fileParallelism: false`.

The config also documents a known benign Miniflare isolated-storage teardown message and notes that
a newer pool-workers version was evaluated and was worse. That is important context: **do not treat
serial files as an obvious defect and flip parallelism on without proving isolation first.**

There are several large integration files, including approximately:

- `calendarManagement.integration.test.ts` — 61 KB;
- `communications.integration.test.ts` — 51 KB;
- `auth.platform.integration.test.ts` — 46 KB.

Large files are not automatically bad, but they make fixture reuse, failure localization, and future
parallelism harder. They are good candidates for splitting along behavioral boundaries once shared
setup is extracted.

### 2.3 Browser E2E tests

The Playwright setup has several strengths:

- the app is built before testing;
- the local Worker is started;
- local D1 migrations are applied;
- traces are captured on first retry;
- desktop and mobile Chromium projects exist.

However, many browser specs heavily intercept API calls with `page.route(...)`. That is a valid way
to test UI states, but it means those individual flows may prove the frontend behavior without
proving that the frontend and Worker still agree on the API at runtime.

The clearest maintainability signal is `apps/web/e2e/auth.spec.ts`, currently about 101 KB. Its
`beforeEach` constructs a large amount of mutable fixture state and registers many API routes before
the actual tests begin. Other feature specs also repeat session, organization, setup, and API route
fixtures.

This creates three risks:

1. a frontend mock can drift from the Worker contract;
2. changing a common API response can require edits in many browser files;
3. broad `beforeEach` setup makes individual tests harder to understand and more sensitive to
   unrelated fixture changes.

The project should keep mocked browser tests because they are fast and excellent for state coverage,
but the mock infrastructure should become a shared test utility rather than live inside large specs.

### 2.4 Full-stack browser confidence

`scripts/run-e2e-servers.mjs` already starts both sides of the application, which is a strong
foundation. The missing distinction is between:

- **mocked UI E2E:** browser tests that deliberately intercept most relevant API calls; and
- **full-stack E2E smoke:** browser tests that deliberately allow requests to reach the local
  Worker/D1 stack.

The project should explicitly maintain both categories. The full-stack set can stay small.

### 2.5 Release qualification

`scripts/check-ci.mjs` currently covers:

- dependency audit and lockfile verification;
- architecture/static checks;
- formatting/lint/Knip;
- typechecking and contract/parity checks;
- unit tests;
- build/release artifact checks;
- Workerd integration tests.

It explicitly does **not** run Playwright because browsers may not be installed. The script instead
tells the developer to run Playwright separately.

That is reasonable for a fast local gate, but it means there is no single command whose successful
completion proves that the browser suite ran. A full release qualification command should close that
gap while retaining the existing local workflow.

### 2.6 Browser coverage

`playwright.config.ts` currently covers:

- Desktop Chrome/Chromium;
- Pixel 7 Chromium.

That gives responsive-width coverage, but it does not exercise a different browser engine. For this
application, WebKit is the highest-value additional engine because it catches Safari/iOS-specific
behavior that another Chromium device profile cannot.

Firefox can be a secondary periodic check rather than a required run for every release initially.

### 2.7 Accessibility coverage

The repository has accessibility-related markup and component behavior, but a code search did not
find an axe-based automated accessibility scan. Structural string assertions alone cannot validate
many accessible interactions.

Accessibility testing should be added at two levels:

- component interaction tests for keyboard and focus behavior;
- axe-based smoke checks on representative browser pages/states.

Automated scans do not replace manual accessibility review, but they are valuable regression gates.

### 2.8 Test hygiene

A targeted code search did not find `test.skip`, `test.todo`, `test.only`, or `waitForTimeout`
usage. That is a positive baseline.

Preserve that discipline with configuration rather than relying only on convention. In particular,
Playwright's `forbidOnly` is currently tied to `process.env.CI`, while this repository's primary
qualification workflow is local. A release command should fail on focused tests even when GitHub
Actions is not involved.

## 3. Target test model

The target state should have four clearly different confidence layers:

| Layer              | Purpose                                                                       | Runtime                             |
| ------------------ | ----------------------------------------------------------------------------- | ----------------------------------- |
| Unit/domain        | Pure logic, validation, state transitions, utilities                          | Vitest / Node                       |
| UI interaction     | Shared components and page-level interaction behavior                         | DOM/browser-like Vitest environment |
| Worker integration | Routes, authz, D1, Durable Objects, migrations, Cloudflare runtime behavior   | Cloudflare Vitest pool              |
| Browser            | Critical user journeys, responsive behavior, and frontend/backend integration | Playwright                          |

Within the browser layer, keep two explicit styles:

1. **Mocked browser tests** for broad UI-state coverage.
2. **Full-stack browser smoke tests** for a small number of critical frontend-to-Worker journeys.

This makes it clear what a passing test actually proves.

## 4. Implementation plan

### Phase 1 — Add coverage visibility and a complete release command

**Priority: P0**

#### 4.1 Add a dedicated coverage command

Use the already-installed V8 provider.

Recommended shape:

- add `test:coverage` to `package.json`;
- produce text plus machine-readable/HTML output locally;
- keep coverage output out of source control;
- initially report coverage without failing the release gate;
- after a baseline is established, add thresholds only where they provide real value.

Do **not** start with a repository-wide 100% target.

Good first candidates for ratcheted thresholds are:

- `packages/domain/**`;
- authorization/identity decision code;
- payment/finance policy logic;
- scheduling/attendance policy logic;
- API request/response validation helpers.

Use a ratchet model: once a critical area reaches a reasonable baseline, prevent it from going
backward.

#### 4.2 Create one full release qualification command

Preserve `npm run check:ci` as the browser-free local gate if that speed/convenience is useful.

Add a command such as:

```text
npm run check:release
```

that runs:

1. `npm run check:ci`;
2. Playwright Chromium smoke/full suite;
3. any additional release-only checks selected below.

Then make the release/deploy documentation state unambiguously which command is required before
production promotion.

Do not add GitHub Actions solely to solve this. The existing repository contract intentionally uses
a local qualification model.

#### 4.3 Make focused tests fail release qualification

Ensure release-mode test runs fail if `.only` is committed:

- Playwright: use `forbidOnly: true` for release qualification, independent of GitHub Actions;
- Vitest: configure the equivalent no-focused-tests behavior for release runs.

Keep the current quick static convention check if desired, but configuration should be the final
guard.

#### 4.4 Improve browser failure artifacts

Keep Playwright trace-on-first-retry and add:

- screenshot on failure;
- a retained HTML report for a full release run when practical.

Avoid always-on video unless a real debugging need appears; traces are usually more useful and
cheaper.

**Phase 1 completion criteria**

- One command exists that means "release test qualification completed."
- Coverage can be generated locally with one command.
- A focused test cannot silently qualify a release.
- Browser failures preserve enough evidence to diagnose the failure without immediately rerunning
  it.

---

### Phase 2 — Refactor Playwright fixtures and split oversized specs

**Priority: P0/P1**

#### 4.5 Create shared Playwright fixtures/builders

Create an E2E support area such as:

```text
apps/web/e2e/fixtures/
  session.ts
  organization.ts
  apiMocks.ts
  builders.ts
```

The exact file names are less important than the separation of concerns.

Move repeated setup for the following into shared helpers:

- current session/current user;
- organization membership;
- MFA/auth status;
- setup status;
- module state;
- calendar settings;
- common request IDs;
- standard success/error API responses.

Feature specs should be able to express only the behavior that differs for that test.

For example, prefer an API such as:

```ts
const api = await installOrganizationApi(page, {
  role: "administrator",
  modules: ["events", "people"],
});
api.donations.set([...]);
```

rather than dozens of route registrations in every spec.

#### 4.6 Make mocked API responses contract-aware

Where shared contract types already exist, use them directly in E2E builders. Where runtime schemas
exist, consider validating fixture payloads through the same schema or a test-safe exported
equivalent.

The goal is to make this fail close to the fixture definition when the application contract changes,
instead of allowing an old browser mock to remain silently valid TypeScript.

Do not force every UI mock through the live Worker; that would defeat the purpose of fast
deterministic UI-state tests.

#### 4.7 Split `auth.spec.ts`

`auth.spec.ts` is currently about 101 KB and contains much more than a narrow authentication
scenario.

Split it by user journey/feature after the common route fixture is extracted. Possible boundaries
include:

- session/account/authentication behavior;
- member profile/directory behavior;
- administration/navigation behavior;
- attendance/RSVP behavior;
- seating behavior.

Use behavior boundaries rather than an arbitrary line-count gate. The practical goal is that
changing one feature's mock data should not require loading or modifying an unrelated 100 KB test
file.

Apply the same approach opportunistically to other large browser specs rather than performing a bulk
rewrite all at once.

#### 4.8 Prefer strict mock scopes

For suites intended to be fully mocked, make unexpected API calls visible. A helper can track
registered mocks and fail the test when an unexpected application API request escapes the intended
fixture boundary.

For full-stack suites, do the opposite: minimize route interception and explicitly document the few
provider/external-service boundaries that are stubbed.

**Phase 2 completion criteria**

- Common browser setup lives in reusable fixtures.
- `auth.spec.ts` is split by behavior.
- Repeated session/setup/module boilerplate is substantially reduced.
- Mocked test payloads are tied to shared contract types or validation wherever practical.

---

### Phase 3 — Add true full-stack browser smoke tests

**Priority: P1**

The existing E2E server launcher already builds the web app, migrates D1, starts the Worker, and
starts the preview server. Use that investment to add a small no-mock/minimal-mock project.

#### 4.9 Define a small critical-journey suite

Start with 3–5 deterministic journeys. Candidate areas:

- authentication/session restoration;
- a representative administrator create/update flow;
- a calendar/attendance or RSVP flow;
- one finance/donation flow that does not require a live external provider;
- one member-facing flow.

Select the final journeys based on which can be seeded deterministically without production-only
provider calls.

#### 4.10 Add deterministic local seeding

Do not add a generally accessible test backdoor to the production Worker.

Prefer one of:

- a Node test helper that writes to the local D1 database before the browser starts;
- fixture SQL applied only to the local E2E database;
- a test-environment-only bootstrap path that is unreachable in production builds.

The full-stack suite should control its data and be independently repeatable.

#### 4.11 Stub only external/provider boundaries

Allow browser requests to reach the real local Worker and D1. Stub only boundaries such as
payment/email/provider calls where hitting a real service would be unsafe or nondeterministic.

This suite's purpose is to detect frontend/Worker contract drift that mocked browser tests cannot
detect.

**Phase 3 completion criteria**

- At least three important browser journeys reach the real local Worker.
- Tests can repeat from clean data without manual cleanup.
- Provider calls remain isolated and deterministic.
- A frontend/API contract mismatch causes a browser smoke failure.

---

### Phase 4 — Add interactive UI and accessibility tests

**Priority: P1**

#### 4.12 Add a browser-like component test environment

Do not force all existing Vitest tests into a DOM environment.

Create a separate UI test project/configuration using either:

- Vitest + jsdom/happy-dom + React Testing Library/user-event; or
- Vitest Browser Mode for components where real browser behavior matters.

Keep pure domain/Worker tests in their current faster environment.

Potential command structure:

```text
npm run test:unit
npm run test:ui
npm test              # runs both required fast layers
```

A Vitest multi-project configuration is also acceptable if it keeps the environments explicit.

#### 4.13 Prioritize interaction-sensitive shared components

Add interaction tests first for components where markup-only tests provide limited confidence:

- `Modal` / dialogs: initial focus, focus trap, Escape, focus restoration;
- `Tabs`: arrow-key navigation and selected state;
- dropdown menus: keyboard opening/navigation/dismissal;
- `DatePicker`: keyboard and accessible labels;
- `DataTable`: responsive/card behavior and interactive cell controls;
- `Pagination`: keyboard activation and disabled states;
- mobile navigation;
- music-player controls, especially mobile-specific behavior.

Do not replace useful structural SSR tests. Add interaction coverage where behavior is the risk.

#### 4.14 Add automated accessibility smoke scans

Add axe-based Playwright checks for representative pages/states, for example:

- login/account state;
- member dashboard;
- administrator table/form page;
- modal/dialog open state;
- mobile navigation open state;
- music player on desktop and mobile.

Treat serious axe violations as test failures once existing findings are understood and remediated.

Keep manual testing for areas automation cannot prove, such as screen-reader usability and whether
focus order is actually intuitive.

**Phase 4 completion criteria**

- Interactive shared components are tested through user behavior, not only HTML strings.
- Keyboard/focus regressions are covered for the highest-risk components.
- Representative desktop and mobile pages run automated accessibility scans.

---

### Phase 5 — Evaluate integration parallelism safely

**Priority: P2**

The current `fileParallelism: false` is intentional and the config documents Miniflare teardown
behavior. Do not simply turn it on.

#### 4.15 First reduce shared fixture/setup coupling

Before changing parallelism:

- make per-file D1/DO state reset expectations explicit;
- centralize repeated integration setup in existing test helpers/testkit where appropriate;
- split oversized integration files by feature behavior;
- ensure tests do not depend on file execution order.

#### 4.16 Run a controlled parallelism experiment

After isolation work:

1. establish current integration duration and flake baseline;
2. test `fileParallelism: true` with a conservative worker count such as 2;
3. repeat the suite enough times to expose teardown/state leaks;
4. compare runtime and failure rate;
5. keep the change only if it is measurably faster and equally reliable.

If the pool-workers/Miniflare behavior remains noisy or unsafe, keep integration files serial.
Reliability is more valuable than parallelism.

**Phase 5 completion criteria**

- Integration tests have explicit state-isolation rules.
- Large files are split where that improves maintainability.
- Parallelism is either adopted with evidence or deliberately rejected with a short note documenting
  why.

---

### Phase 6 — Add selective cross-browser coverage

**Priority: P2**

Keep desktop/mobile Chromium as the normal fast browser path.

Add a smaller WebKit smoke project for the highest-risk journeys, especially:

- mobile navigation;
- music playback controls;
- forms/dialogs;
- clipboard/download behavior where applicable;
- layout behavior that depends on mobile browser viewport/safe-area behavior.

Add Firefox later as a periodic compatibility check if the additional signal justifies the runtime.

Recommended commands:

```text
npm run test:e2e             # normal Chromium projects
npm run test:e2e:webkit      # smaller Safari/WebKit smoke set
npm run test:e2e:all-browsers
```

The full browser matrix does not need to run on every local code change.

**Phase 6 completion criteria**

- WebKit exercises a small critical-path suite.
- Browser-specific failures can be reproduced with a dedicated command.
- Routine developer testing remains reasonably fast.

## 5. Test reliability and maintenance rules

Adopt a few repository-wide rules as the suite evolves:

1. **No arbitrary sleeps.** Continue using state/request/event-based waits instead of
   `waitForTimeout`.
2. **No hidden focused tests in release qualification.** `.only` must fail a release run.
3. **Mock at the correct layer.** UI-state tests may mock APIs; full-stack smoke tests should not.
4. **Reset mutable fixture state per test.** Shared builders are fine; shared mutable state is not.
5. **Prefer behavior assertions.** Avoid snapshots or CSS-string assertions when the important
   requirement is user interaction.
6. **Keep external providers deterministic.** Payment/email/etc. should not call live services in
   automated tests.
7. **Every bug fix gets the narrowest useful regression test.** Put it at unit/integration/browser
   level based on where the defect actually escaped.
8. **Do not chase 100% coverage.** Use coverage to find blind spots and prevent regression in
   critical code.

## 6. Suggested implementation sequence

### PR/commit group A — Test observability

- add `test:coverage`;
- capture baseline coverage;
- add failure screenshots to Playwright;
- add focused-test guard for release mode;
- add/document `check:release`.

### PR/commit group B — E2E fixture extraction

- create shared session/organization/setup fixtures;
- refactor one medium-sized spec first to validate the fixture API;
- then split/refactor `auth.spec.ts`;
- move shared contract-aware builders into the fixture layer.

### PR/commit group C — Full-stack browser smoke

- add deterministic local data seeding;
- add 3–5 critical minimally mocked journeys;
- document which E2E specs are mocked versus full-stack.

### PR/commit group D — UI/accessibility

- add the UI interaction test environment;
- migrate/add tests for Modal, Tabs, DatePicker, DataTable, Pagination, mobile navigation, and
  player controls;
- add axe-based Playwright smoke scans.

### PR/commit group E — Integration maintenance/performance

- extract common integration setup;
- split the largest integration files where useful;
- benchmark serial versus conservative parallel execution;
- document the result.

### PR/commit group F — Browser compatibility

- add WebKit smoke tests;
- add Firefox only if it provides enough additional signal to justify the maintenance/runtime cost.

## 7. Success measures

Track these after implementation rather than choosing arbitrary test-count goals:

- **Coverage:** baseline is visible; critical-package coverage does not regress.
- **Browser confidence:** at least 3–5 critical journeys exercise the real local Worker rather than
  browser mocks.
- **Accessibility:** representative desktop/mobile pages have automated axe coverage; core
  interactive components have keyboard/focus tests.
- **Maintainability:** common E2E route/session/setup fixtures live in one place; `auth.spec.ts` is
  no longer a single ~101 KB catch-all fixture/test file.
- **Reliability:** no required test suite has a meaningful recurring flake; retry/failure evidence
  is preserved.
- **Release qualification:** one documented command means unit + integration + browser qualification
  is complete.
- **Performance:** integration parallelism is adopted only if measured runtime improves without
  increased flakes.

## 8. Explicit non-goals

This plan does **not** recommend:

- 100% repository-wide coverage;
- converting every browser test into a full-stack test;
- removing mocked Playwright tests;
- enabling integration parallelism without isolation evidence;
- running every browser engine on every developer test run;
- adding GitHub Actions just to have a remote CI service;
- replacing manual accessibility review with automated scans.

## 9. Recommended first move

Start with **Phase 1 and Phase 2**.

Coverage visibility and a complete release command close immediate confidence gaps with limited code
risk. Extracting the browser fixtures then reduces the cost of every future E2E change and creates
the foundation needed for contract-aware mocks, full-stack smoke tests, and easier browser-matrix
expansion.

After those two phases, add the full-stack smoke and accessibility layers before spending
significant effort on test parallelism.
