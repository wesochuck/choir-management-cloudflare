# AGENTS.md

Mandatory instructions for AI coding agents working in this repository.

## 1. Current Mission and Scope

- The user's current request defines the immediate task scope. The rebuild plan governs how in-scope
  work is implemented; it does not authorize unrelated milestone work.
- The Cloudflare rebuild is nearing completion. Treat legacy parity as a focused source for the
  remaining documented gaps, not as a reason to restart broad legacy discovery or rebuild completed
  areas.
- Execute the applicable work in milestones 0–6 of
  `docs/2026-07-20-cloudflare-multitenant-rebuild-plan.md`. Milestone 7, production launch, is out
  of scope unless the user explicitly authorizes it and the goal contract is updated.
- The active deployment target is permanent staging. Do not launch or modify production.
- Treat `docs/goal/GOAL.md` as the durable goal contract and `docs/goal/READINESS.md` as the
  machine/environment handoff.
- Keep this repository fully standalone. Never import legacy source into builds, tests, CI,
  deployments, or runtime.

## 2. Sources of Truth

Within repository evidence, apply this order:

1. Current security, tenancy, architecture, and environment decisions in this file,
   `docs/goal/GOAL.md`, and applicable accepted, non-superseded architectural decision records under
   `docs/adr/`.
2. Current executable contracts, code, tests, migrations, and parity gates.
3. For unresolved behavioral-parity questions only, legacy commit
   `6874d43a3c3698ae53218a44d17649bc454ca9ac` in the read-only sibling Parity Bridge.
4. `CONTEXT.md` for product language and historical plans for supporting intent.

An explicit current decision may intentionally supersede legacy behavior. Record that outcome in the
parity ledger or an ADR instead of reproducing unsafe or obsolete behavior. An executable
implementation cannot silently override an explicit current architectural decision, nor should
historical documents override current code.

## 3. Scoped Instructions

More specific instructions inherit this file and apply by directory:

- `apps/web/AGENTS.md` — React, browser behavior, accessibility, and styling.
- `apps/worker/AGENTS.md` — Worker, Durable Object, tenancy, queue, and provider rules.
- `packages/AGENTS.md` — domain, contract, UI primitive, and testkit boundaries.

Operational procedures belong in `docs/runbooks/`, not in this root policy. Verify time-sensitive
provider instructions against current authoritative documentation before changing hosted resources.

## 4. Non-Negotiable Engineering Rules

- Use strict TypeScript. Do not use `any`, `as any`, `// @ts-ignore`, or blanket lint suppression
  without explicit user approval. Use `unknown` and narrow it.
- Never log or commit secrets, credentials, one-time codes, recovery codes, full signed tokens, or
  sensitive provider payloads.
- One Organization is one tenant. Operational data, files, jobs, tokens, caches, and audit events
  must never cross Organization boundaries.
- Resolve the Organization from the validated hostname and authoritative registry before
  authorization. A client-supplied Organization ID must never select storage.
- D1 is control-plane only. Each Organization Durable Object owns that Organization's operational
  data. KV is derived routing cache only, and every R2 key must be Organization-scoped.
- All external work must be bounded, retryable, idempotent, and attributable to exactly one
  Organization.
- Keep provider calls outside Durable Object transactions.
- Implement new Durable Object features and operational methods using Cloudflare Workers RPC
  (`stub.methodName(...)`) instead of internal HTTP `fetch()` routing.
- Every schema change is forward-only. Never rewrite an applied migration. Use expand/contract
  changes compatible with rollback.
- Preserve raw provider errors for typed internal formatters while redacting secrets from logs and
  user-visible output.
- Prevent O(N^2) bottlenecks. Do not run linear scans inside tight loops or sort comparators;
  precompute `Map` or `Set` lookups.
- Do not weaken a quality, size, security, isolation, accessibility, parity, or migration gate
  merely to make it pass.
- Do not introduce eyebrow kickers into the web design system. Headings carry their own context;
  `npm run check:no-eyebrows` enforces this.
- Avoid recurring, unbounded table scans in metered storage (D1 queries, scheduled tasks, queue
  consumers, and Durable Object SQLite). Where a query runs repeatedly over a growing table, ensure
  it is supported by a selective index or bounded by a strict partition/filter.
- Every index added to Durable Object SQLite or D1 must be justified by an access path. Do not add
  indexes speculatively; each index adds write cost to every insert/update for that table.
- Keep the Organization Durable Object runtime boundary hibernation-friendly. Runtime code reachable
  from `OrganizationStore.ts` must not perform external fetches, provider I/O, outbound sockets,
  long-lived timers, or other operations prohibited by `npm run check:do-runtime`. The executable
  checker is authoritative for narrowly approved exceptions (constructor initialization and
  migration barriers via `blockConcurrencyWhile`, and bounded scheduler handoff to `JOBS_QUEUE`). Do
  not use `waitUntil()` in a Durable Object; it does not extend DO lifetime. OrganizationStore
  WebSockets are outside the current architecture. Alarm ownership stays in `scheduler.ts`; store
  code requests scheduler work through the shared alarm helpers. `npm run check:do-runtime` enforces
  these boundaries.

## 5. Worktree and Git Safety

- Inspect Git status before editing. Existing changes belong to the user unless the task clearly
  places them in scope.
- Preserve unrelated modifications and untracked files. Never discard, rewrite, stage, or commit
  unrelated work merely to obtain a clean tree.
- Group a change with its regression tests and required parity evidence in one cohesive commit.
- Always stage `package-lock.json` with a `package.json` change. The pre-commit hook and local
  verification gate enforce lockfile synchronization.
- Do not use destructive Git or filesystem commands unless the user explicitly requests the exact
  operation and target.

## 6. Change Classes and Verification

Classify work by its actual risk:

- **Routine:** documentation, copy, isolated styling, or a tightly scoped behavior change without a
  contract, route, schema, provider, queue, authentication, or tenancy boundary. Run focused checks
  plus formatting, lint, or typecheck as relevant.
- **Material:** changes to application behavior, shared components, contracts, Worker logic,
  persistence, authentication, payments, communications, queues, or tenant-scoped data. Run focused
  tests and the affected build/integration gates. Report risks and rollback implications.
- **Release-bound:** anything being pushed to `main` or promoted to staging. Run the complete local
  release gate described below.

When uncertain, treat the change as material.

Three clearly differentiated verification levels govern local work:

1. **Development iteration:** Run focused unit/UI tests, contract checks, and relevant static checks
   (`npm run lint`, `npm run typecheck`, or focused vitest runs) while modifying code.
2. **Browser-free comprehensive check:** Run `npm run check:ci`. This is the canonical browser-free
   local verification gate. It runs dependency audits, lockfile verification, DO runtime checks,
   formatting, lint, Knip, contracts, parity checks, unit tests, artifact packaging verification,
   and workerd integration tests without launching browser processes.
3. **Complete release qualification:** Run `npm run check:release`. This is the canonical
   pre-promotion release gate required before pushing `main` or promoting to staging. It runs
   `npm run check:ci`, followed by the full Chromium desktop and mobile E2E suites with
   `RELEASE_QUALIFICATION=1`, which rejects committed `.only` tests and captures failure artifacts.

Required root scripts must remain available:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
npm audit --audit-level=high
```

Additional rules:

- Use standard project commands directly; do not require a machine-specific wrapper.
- In automated scripts or test environments, use `npm ci`, not `npm install`, after the lockfile
  exists.
- Run focused checks while iterating.
- After any route or parity-ledger change, run both `npm run check:parity` and
  `npm run check:parity:implementation`.
- Build the deployable artifact before `npm run test:integration:prepared`.
- Before pushing `main` or promoting to staging, run `npm run check:release`. Do not manually
  reproduce release qualification with separate ad-hoc commands.
- Treat bundle-size and build-output warnings as actionable. Preserve route-level code splitting and
  inspect generated output.

Before finishing a material or release-bound change, report:

- what changed and which goal, plan, or parity entries it satisfies;
- checks run, results, and exact reasons for any skipped check;
- migration and rollback implications;
- tenant-isolation, external-effect, accessibility, and performance risks;
- generated artifacts and how they were regenerated;
- remaining milestone work only when the task is part of active milestone execution.

## 7. Plan and Parity Maintenance

- Update the plan's File Responsibility Map when milestone work introduces a responsibility not
  represented there. Routine fixes do not require map edits unless ownership changes.
- Maintain `docs/parity/feature-matrix.yaml` as executable evidence, not a prose checklist.
- Every remaining baseline route, public or signed flow, service workflow, export, file behavior,
  scheduled task, responsive state, and accessibility-critical interaction needs parity evidence.
- When a Worker route is renamed or removed, update the parity matrix, route inventory, and
  route-level tests atomically.
- A historical plan is not proof of behavior. Confirm it against executable evidence and classify it
  as implemented, partial, proposed, superseded, or irrelevant.
- Copy only approved contracts, fixtures, screenshots, CSV specifications, glossary entries, and
  ADRs from the Parity Bridge.
- New signed-link bytes need not match PocketBase, but purpose, authorization, Organization binding,
  expiry, revocation, and constant-time verification must be covered.

## 8. Staging Deployment Contract

- Local and preview environments must not send real messages or create real charges.
- Staging uses isolated resources and secrets. Store developer credentials in supported keyrings and
  deployed secrets in Worker secret stores, never tracked files.
- The sole permanent-staging release path is the guarded local command
  `npm run deploy:staging -- --yes`. It must run from a clean `main` checkout that exactly matches
  `origin/main`, execute the complete local release gate, create and verify one immutable artifact
  containing commit, lockfile, Worker bundle, and web asset hashes, and retain the prior Worker
  Version for rollback. Follow `docs/runbooks/staging-deployment.md`.
- GitHub Actions is disabled for this repository. Release checks run locally through
  `npm run check:release`; repository workflows must not be added without explicit user approval. Do
  not use direct `wrangler deploy` for promotion.
- Promote with `wrangler versions upload` followed by `wrangler versions deploy`. Apply
  non-versioned routes, schedules, queue consumers, and Workflow triggers explicitly and keep them
  backward compatible with the previously deployed Worker Version.
- Qualification is API-only: direct Worker health/readiness, exact `BUILD_VERSION`, and seeded
  Organization-host resolution. Browser smoke tests do not belong in release promotion.
- A custom-domain HTTP 403 may be reported as degraded only when direct Worker probes pass. A
  healthy previous version throughout the qualification window may be reported as propagation delay.
  Real Worker failures remain hard failures and trigger rollback.
- Deduplicate deployment retries: retry transient failures at exactly one layer — either at the
  outermost orchestrator OR at the inner transport, never both. When orchestrating qualification or
  deployment steps, configure inner helpers with a single attempt (e.g. `{ outerMaxAttempts: N }`
  setting inner `STAGING_QUALIFY_ATTEMPTS: "1"`) so outer retry limits strictly bound total attempts
  and prevent cascading timeout blowups.
- Do not modify hosted resources, domains, data, or provider configuration without authenticated
  environment context and explicit in-scope authorization.
- Production requires a separate explicit user decision, updated goal contract, independently
  resolved resources and secrets, and release approval. It must promote the identical
  staging-qualified commit and lockfile. Staging authorization never implies production
  authorization.

## 9. Pause Conditions

Continue autonomously through safe, in-scope implementation and verification. Pause only when:

- interactive account authorization is required;
- a secret must be entered through a secure provider flow;
- a genuinely product-changing decision is absent from the accepted goal or ADRs;
- an external account lacks a required paid product, entitlement, zone, or permission;
- production launch or a destructive hosted-data operation would be required.

### Interactive handoff rule

Never ask or direct the user to enter credentials, codes, or commands into a surface unless that
exact surface has been verified to be visibly open and usable by the user in the current turn. Agent
terminals, background execution tasks, queued tool sessions, or inferred browser tabs are agent-only
and are not user-facing surfaces.

Mandatory preflight rules:

- Never ask the user to paste one-time codes, recovery codes, passwords, cookies, tokens, or other
  secrets into chat. Keep those values in the verified provider or user-owned terminal surface.
- Treat every terminal launched by coding tools as agent-only and non-interactive for the user.
  Never start an interactive authentication command there and ask the user to type into it; provide
  the complete command for the user to run in their own terminal instead.
- Do not claim a prompt, browser page, or panel is open unless verified by current-turn evidence. If
  surface visibility cannot be verified, provide a self-contained command or direct navigation path.
- After the user reports completing an action, verify the resulting non-secret postcondition before
  proceeding. Treat a report or completion notice as a signal to verify, not proof of success.

Update `docs/goal/READINESS.md` only when a blocker affects active milestone completion or must
survive a handoff. For a temporary question or local-only interruption, report the blocker without
creating an unrelated documentation change.
