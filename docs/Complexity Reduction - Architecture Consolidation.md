# Complexity Reduction / Architecture Consolidation

Review `AGENTS.md` and all applicable scoped `AGENTS.md` files before making changes.

## Goal

Reduce accidental complexity across the codebase without changing product behavior, weakening
security/tenancy boundaries, or introducing unnecessary third-party framework churn.

The objective is to eliminate repeated infrastructure, cut test boilerplate, and provide one
canonical, straightforward implementation path for frontend data fetching and staging qualification.

### Guiding Principles

- **Single Canonical Paths:** Eliminate competing patterns (e.g., ad-hoc `fetch()` vs. typed API
  clients).
- **Less React Orchestration:** Eliminate hand-rolled polling loops, manual `AbortController`
  chains, and optimistic update rollbacks inside components.
- **Composable Test Harnesses:** Eliminate copy-pasted session and route mocking across E2E specs.
- **Shared Qualification Core:** Consolidate repeated HTTP, auth, assertion, and cleanup logic
  across staging qualification scripts.
- **Strict Domain Separation:** Pure business rules in `@choir/domain`; transport validation in
  `@choir/contracts`; reusable test fixtures in `@choir/testkit`; presentation in `apps/web`.
- **Preserve Proven Core Architecture:** Retain existing tenant/Durable Object storage boundaries,
  security gates, and the lightweight, well-tested custom application router.

Do not perform this as one giant rewrite; execute incrementally by phase.

---

# Phase 0 — Inventory and Baseline

Before making code modifications:

1. **Audit current patterns:**
   - Browser API requests (identify all raw `fetch()` calls in components vs. helpers in
     `auth/api/`).
   - Server-state management (inventory components hand-rolling `setInterval` polling, manual
     refetch triggers, or complex optimistic state).
   - Playwright test setup (map duplicated session, user, and module mocks across
     `apps/web/e2e/*.spec.ts`).
   - Staging qualification scripts (identify shared HTTP, auth, assertion, and teardown logic across
     `scripts/qualify-staging-*.mjs`).

2. **Produce a focused execution sequence:**
   - Define exact targets for each phase.
   - Ensure every phase leaves the codebase in a shippable, fully tested state.

---

# Phase 1 — Normalize the Browser API Layer

Establish a single, typed browser API client path and move general API helpers out of the
authentication directory.

### Target Location

`apps/web/src/api/` (migrating general endpoints from `apps/web/src/auth/api/`)

### Standard Request Helper

Introduce a typed helper in `apps/web/src/api/client.ts`:

```ts
requestJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T>
```

Requirements:

- Parse JSON exactly once.
- Validate response payloads against Zod contracts.
- Preserve typed problem details / `AuthApiError` shapes for callers.
- Support caller-supplied `AbortSignal`.
- Enforce standard credentials/cache behavior (`credentials: "same-origin"`).
- Preserve raw HTTP status semantics when needed by the caller.

### Rules

- Eliminate raw `fetch("/api/...")` calls inside feature components (e.g., `DonationsManager.tsx`).
  All calls must go through the typed API client layer.
- Retain auth-specific logic (e.g., session verification, login, password reset) in
  `apps/web/src/auth/api/` and place shared domain resources (`events`, `donations`, `music`,
  `organization`, `roster`, `auditions`) into `apps/web/src/api/`.

---

# Phase 2 — Introduce TanStack Query for Async Server State & Polling

Adopt TanStack Query as the standard mechanism for managing server state, asynchronous caching, and
background polling.

### Target Scope

- Initialize the application `QueryClient` and provider in `apps/web/src/App.tsx` (or shell root).
- Establish a typed query-key registry (e.g., `queryKeys.organization.attendance(eventId)`).
- Use TanStack Query hooks (`useQuery`, `useMutation`) for:
  - Remote entity loading and caching;
  - Automatic background polling (replacing manual `setInterval`);
  - Loading / error / refetch state;
  - Mutations, cache invalidation, and optimistic updates.

### What Stays in Local React State

- Dialog / modal visibility;
- Active tab selection;
- Transient search / filter input text;
- Unsaved form drafts.

### High-Priority Migration Targets

1. **`AttendanceManager.tsx`:**
   - Replace manual 30-second `setInterval` polling with TanStack Query `refetchInterval`.
   - Remove manual `AbortController` juggling and `pendingIdsRef` optimistic update tracking.
   - Simplify combined event and venue loading.

2. **`DonationsManager.tsx`:**
   - Replace combined `Promise.all([fetch(...), fetch(...)])` and manual `parseDonations` /
     `parsePatrons` state tracking with typed queries.
   - Use mutation hooks with cache invalidation instead of manual state refreshing.

### Constraints

- Do not build a custom wrapper layer around TanStack Query that merely mirrors its built-in API.
- Do not copy query data into local component `useState` solely to make it readable.

---

# Phase 3 — Relocate Pure Business Rules to `@choir/domain`

Keep UI components strictly focused on layout, user interaction, and presentation. Move
deterministic business logic into pure, testable domain functions.

### Candidates for Domain Extraction

- Audience eligibility and compatibility calculations.
- Communication placeholder interpolation and template validation (e.g.,
  `availablePlaceholders(audience)`, `validateCommunicationContent(audience, content)`).
- Donor suggestion scoring and tier grouping heuristics.
- Roster status transitions and eligibility rules.

### Constraints

- Do not move presentation-only formatting or browser-specific behaviors into `@choir/domain`.
- All extracted domain functions must have comprehensive unit tests in `packages/domain`.

---

# Phase 4 — Build a Shared Playwright Test World

Eliminate the extensive duplication of mock data and route handlers across the 19 E2E test files in
`apps/web/e2e/`.

### Target Architecture

```text
apps/web/e2e/support/
  testWorld.ts
  routes/
    session.ts
    organization.ts
    modules.ts
    events.ts
    profiles.ts
  fixtures/
```

### Usage Pattern

Allow E2E specs to initialize standard application state declaratively:

```ts
const world = await createTestWorld(page, {
  organization: standardOrganization(),
  events: [performanceFixture()],
  user: browserAdminUser(),
});

// Apply test-specific overrides only
await world.mockDonations({ history: [donationFixture()] });
```

### Rules

- Reusable test fixtures belong in `@choir/testkit` when beneficial across unit/integration/E2E
  tests.
- Feature specs should only declare route overrides and assertions relevant to their specific
  feature under test.
- Retain native Playwright route interception (`page.route()`); do not add unnecessary third-party
  mocking layers (e.g., MSW).

---

# Phase 5 — Consolidate Staging Qualification Infrastructure

Consolidate shared HTTP, authentication, assertion, and cleanup logic across the 75+ qualification
scripts without removing or weakening any qualification assertions.

### Target Architecture

```text
scripts/qualification/
  config.mjs        # Staging environment config parsing & host construction
  client.mjs        # Authenticated HTTP client with timeout, JSON parsing & error redaction
  auth.mjs          # Session bootstrap and header handling
  assertions.mjs    # PASS/FAIL assertions and formatted diagnostic output
  fixtures.mjs      # Deterministic qualification fixture setup
  cleanup.mjs       # Safe teardown and cross-tenant verification
  runner.mjs        # Scenario execution wrapper
```

### Execution

1. Create shared qualification modules in `scripts/qualification/`.
2. Migrate representative scripts first:
   - `qualify-staging-profile-photo.mjs`
   - `qualify-staging-scheduler.mjs`
   - `qualify-staging-roster.mjs`
3. Refactor remaining scripts into thin entry points invoking standard scenario runners.

---

# Phase 6 — Pragmatic Form & Route Cleanup

Tackle targeted frontend and Worker cleanups without introducing high-risk migrations.

### 1. Form Validation Strategy

- **Standard Settings Forms:** Keep existing controlled state paired with `@choir/contracts` Zod
  validation and
  [useFloatingSaveAction](file:///Users/wesosborn/Downloads/choir-management-cloudflare/apps/web/src/account/useFloatingSaveAction.ts).
  Do not rewrite working forms for the sake of adding a library.
- **Complex Dynamic Forms:** Use React Hook Form + Zod resolver selectively only if a form
  introduces dynamic nested field arrays, multi-step wizards, or severe re-render performance
  bottlenecks.

### 2. Camera / Profile Photo Handling

- Evaluate if standard HTML5 camera capture (`<input type="file" accept="image/*" capture="user">`)
  fulfills user requirements on mobile/desktop.
- If desktop WebRTC stream capture remains required, keep its state machine cleanly encapsulated
  within its dedicated dialog component.

### 3. Worker Route Helper Modularization

- Split oversized generic Worker route helpers into focused modules by responsibility:
  ```text
  apps/worker/src/routes/support/
    authorization.ts
    json.ts
    problems.ts
    pagination.ts
    providerStatus.ts
  ```
- Preserve existing Worker RPC, Durable Object, tenant isolation, queue, and migration boundaries.

---

# Explicit Non-Goals

Do **NOT**:

- **Replace the Application Router with React Router:** The existing router in `App.tsx` is ~380
  lines of clean, deterministic TypeScript that already handles pushState/popstate, subroutes,
  legacy redirects, public/authenticated boundaries, and unsaved change blocking. Migrating adds
  bundle size, library churn, and high regression risk across 19 E2E test suites for no user
  benefit.
- **Mandate React Hook Form Globally:** Avoid disrupting established `useFloatingSaveAction`
  patterns on simple configuration forms.
- **Rewrite Working APIs for Filename Changes Alone:** Migrate consumers incrementally.
- **Wrap Libraries Unnecessarily:** Do not wrap TanStack Query in custom abstractions that obscure
  standard features.
- **Weaken Existing Gates:** Preserve all security, tenancy, D1/DO, queue retry, idempotency, and
  staging qualification checks.

---

# Complexity Checklist

Before introducing any new abstraction, verify:

1. Does this eliminate verified code duplication across at least two real consumers?
2. Does this eliminate accidental React orchestration (e.g., manual timers, abort controllers)?
3. Does this make call sites simpler and easier to understand?
4. Is this using standard, recognizable library/language patterns over custom mini-frameworks?

---

# Verification & Rollout

For every phase:

- Run focused unit and integration checks:
  ```bash
  npm run typecheck
  npm run lint
  npm run format:check
  npm test
  npm run test:integration
  npm run test:e2e
  ```
- If dependencies change, ensure `package-lock.json` is updated and synchronized.
- Ensure all 19 Playwright specs and staging qualification suites pass cleanly before proceeding to
  subsequent phases.
