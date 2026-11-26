# AGENTS.md

## Scope and sources

The current user request defines the task. Permanent staging is the active deployment target.
Production requires separate authorization under the release rules below.

Use repository evidence in this order:

1. Current security, tenancy, architecture, and environment decisions in this file,
   [GOAL.md](docs/goal/GOAL.md), and applicable accepted, non-superseded [ADRs](docs/adr/).
2. Current executable contracts in `packages/contracts`, code, tests, migrations, and gates.
3. Active [architecture contracts](docs/architecture/).
4. [CONTEXT.md](CONTEXT.md) for domain concepts and product language.

[READINESS.md](docs/goal/READINESS.md) tracks the environment and handoff. Record architectural
decisions in ADRs. Current decisions govern implementation, and current code takes precedence over
historical documents. ADR 0049 retired legacy parity tracking. Treat PocketBase and its pinned
commit as historical reference only. Keep legacy source out of routine research, builds, tests, CI,
deployment, and runtime.

Follow the scoped instructions in [apps/web](apps/web/AGENTS.md),
[apps/worker](apps/worker/AGENTS.md), and [packages](packages/AGENTS.md). Keep operational
procedures in [runbooks](docs/runbooks/). Verify time-sensitive provider steps against authoritative
documentation before changing hosted resources.

## Engineering

- Use strict TypeScript and narrow `unknown`. Explicit user approval is required for `any`,
  `as any`, `// @ts-ignore`, or blanket lint suppression.
- Keep secrets, credentials, one-time and recovery codes, full signed tokens, and sensitive provider
  payloads out of logs and Git. Retain raw provider errors for typed internal formatters and redact
  secrets from logs and user-visible output.
- One Organization is one tenant. Isolate operational data, files, jobs, tokens, caches, and audit
  events. Resolve the Organization from the validated hostname and authoritative registry before
  authorization. Never let a client-supplied Organization ID select storage.
- D1 is control-plane only. Each Organization Durable Object owns its operational data. KV is
  derived routing cache only. Scope every R2 key to its Organization.
- External work must be bounded, retryable, idempotent, and attributable to exactly one
  Organization. Keep provider calls outside Durable Object transactions. Use Workers RPC
  (`stub.methodName(...)`) for new Durable Object features and operations.
- Use forward-only, rollback-compatible expand/contract migrations. Never edit an applied migration.
- Avoid quadratic work with precomputed `Map` or `Set` lookups in hot loops and sort comparators.
  Use a selective index or a strict partition or filter for recurring metered queries over growing
  tables. Justify each new D1 or Durable Object SQLite index with a concrete access path.
- Keep code reachable from `OrganizationStore.ts` hibernation-friendly. No external fetches,
  provider I/O, outbound sockets, long-lived timers, `waitUntil()`, or OrganizationStore WebSockets.
  `npm run check:do-runtime` governs exceptions for initialization and migration barriers via
  `blockConcurrencyWhile` and bounded scheduler handoff to `JOBS_QUEUE`. Keep alarm ownership in
  `scheduler.ts` and request work through the shared wake helpers.
- Preserve quality, size, security, isolation, accessibility, and migration gates. Follow the web
  design system and keep eyebrow kickers out (`npm run check:no-eyebrows`).

## Git and verification

Check Git status before editing. Preserve unrelated changes and untracked files. Use destructive Git
or filesystem commands only when the user explicitly requests the exact operation and target. If
committing, group changes with their regression tests and verification. Stage `package-lock.json`
with `package.json` changes.

Classify the work by risk. When uncertain, treat it as material.

- **Routine.** For docs, copy, isolated styling, and tightly scoped behavior outside contract,
  route, schema, provider, queue, authentication, and tenancy boundaries, run focused tests and
  relevant formatting, lint, or type checks.
- **Material.** For application behavior, shared components, contracts, Worker logic, persistence,
  authentication, payments, communications, queues, or tenant data, run focused tests and affected
  build and integration gates.
- **Release-bound.** Qualify the clean committed candidate before pushing `main` or promoting to
  staging. Only the staging deploy command may reuse matching qualification under ADR 0051.

For material and release-bound work, report goal or architecture coverage, checks and reasons for
skips, migration and rollback implications, tenant isolation, external effects, accessibility,
performance, and how any artifacts were regenerated. Report remaining milestone work only during
active milestone execution.

Use standard project commands directly and `npm ci` in automation and test environments after the
lockfile exists. Keep the root commands `npm run format:check`, `npm run lint`, `npm run typecheck`,
`npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run build`, and
`npm audit --audit-level=high` available.

- **Development.** Run focused tests and relevant static and contract checks as you iterate.
- **Comprehensive.** `npm run check:ci` is the strict browser-free gate. A recognized npm registry
  outage runs the remaining checks but exits nonzero. For development, `npm run check:ci:dev` may
  report DEGRADED when only the audit is unverified. See the
  [dependency audit outage runbook](docs/runbooks/dependency-audit-outage.md).
- **Release.** `npm run check:release` runs strict CI and full desktop/mobile Chromium E2E with
  `RELEASE_QUALIFICATION=1`, which forbids focused `.only` tests and captures failure artifacts. Run
  focused checks, commit, qualify the clean commit, push, then run `npm run deploy:staging -- --yes`
  when authorized. Commit fixes and qualify the resulting clean commit before pushing. Local commits
  can precede full qualification. Dirty runs cannot save reusable evidence. An explicit release
  check always reruns. Let the canonical gate own full qualification and avoid duplicating its CI,
  test, or build steps immediately beforehand.

Build the deployable artifact before `npm run test:integration:prepared`. Inspect build output,
address bundle-size and build warnings, and preserve route-level code splitting.

For route changes, run `npm run check:routes`. Maintain route tests and safe boundary coverage
(`npm run qualify:staging:evidence`) when changing endpoints. Follow the
[signed-link contract](docs/architecture/signed-link-behavior.md) for purpose, authorization,
Organization binding, expiry, revocation, and constant-time verification. Follow the
[CSV contract](docs/architecture/csv-contracts.md) for imports and exports. Update the plan's File
Responsibility Map when milestone work adds an unrepresented responsibility or a fix changes
ownership.

## Deployment

- Keep local and preview messaging and charges simulated. Staging uses isolated resources and
  secrets. Use supported developer keyrings and deployed Worker secret stores.
- Modify hosted resources, domains, data, or provider configuration only with authenticated
  environment context and explicit in-scope authorization. GitHub Actions is disabled. Adding
  repository workflows requires explicit user approval.
- Use the guarded local `npm run deploy:staging -- --yes` path from clean `main` exactly matching
  `origin/main`. It runs full qualification or verifies matching evidence at most four hours old,
  verifies one immutable artifact with commit, lockfile, Worker, and web asset hashes, and retains
  the prior Worker Version for rollback. See the
  [staging deployment runbook](docs/runbooks/staging-deployment.md).
- The guarded path uses `wrangler versions upload` followed by `wrangler versions deploy`. Direct
  `wrangler deploy` is prohibited. Apply non-versioned routes, schedules, queue consumers, and
  Workflow triggers explicitly and keep them compatible with the prior version.
- Qualify staging through the API with direct Worker health and readiness, exact `BUILD_VERSION`,
  and seeded Organization-host resolution. Custom-domain HTTP 403 is degradable only when direct
  Worker checks pass. A healthy previous version throughout the window may indicate propagation
  delay. Worker failures require rollback.
- Retry transient deployment or qualification failures at one layer. When the orchestrator retries,
  use a single inner attempt (for example, `STAGING_QUALIFY_ATTEMPTS=1`).
- Production requires a separate explicit user decision, an updated goal contract, independently
  resolved resources and secrets, and release approval. Use the identical staging-qualified commit
  and lockfile.

## Pauses and handoffs

Continue through safe, in-scope implementation and verification. Pause only for interactive
authorization, secure secret entry, unavailable external entitlement or permission, a
product-changing decision unresolved by the goal or ADRs, production launch, or a destructive
hosted-data operation.

- Keep secrets out of chat. Before directing the user to enter credentials, codes, or commands in a
  specific surface, verify that exact surface is visibly open and usable by them in the current
  turn. Only claim a prompt, page, or panel is open with current-turn evidence.
- Coding-tool terminals, background jobs, queued sessions, and inferred browser tabs are agent-only.
  Keep secrets in the verified provider surface or the user's own terminal. When visibility cannot
  be verified, provide a direct navigation path or the complete command for the user's own terminal.
  Keep interactive authentication out of coding-tool terminals.
- Verify the non-secret result after the user reports completing a handoff step.

Update [READINESS.md](docs/goal/READINESS.md) only for blockers affecting active milestone
completion or requiring a durable handoff. Report temporary and local-only interruptions directly.
