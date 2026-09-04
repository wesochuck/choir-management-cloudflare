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
   `docs/goal/GOAL.md`, and accepted ADRs 0003–0015.
2. Current executable contracts, code, tests, migrations, and parity gates.
3. For unresolved behavioral-parity questions only, legacy commit
   `6874d43a3c3698ae53218a44d17649bc454ca9ac` in the read-only sibling Parity Bridge.
4. `CONTEXT.md` for product language and historical plans for supporting intent.

An explicit current decision may intentionally supersede legacy behavior. Record that outcome in the
parity ledger or an ADR instead of reproducing unsafe or obsolete behavior.

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

## 5. Worktree and Git Safety

- Inspect Git status before editing. Existing changes belong to the user unless the task clearly
  places them in scope.
- Preserve unrelated modifications and untracked files. Never discard, rewrite, stage, or commit
  unrelated work merely to obtain a clean tree.
- Group a change with its regression tests and required parity evidence in one cohesive commit.
- Always stage `package-lock.json` with a `package.json` change. The pre-commit hook and CI enforce
  lockfile synchronization.
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
- In CI, use `npm ci`, not `npm install`, after the lockfile exists.
- Run focused checks while iterating.
- After any route or parity-ledger change, run both `npm run check:parity` and
  `npm run check:parity:implementation`.
- Build the deployable artifact before `npm run test:integration:prepared`.
- Before pushing `main`, run `npm run check:ci`. If browser-visible behavior changed, ensure
  Chromium is installed and then run `npm run test:e2e`.
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
  `npm run check:ci` and `npm run test:e2e`; repository workflows must not be added without explicit
  user approval. Do not use direct `wrangler deploy` for promotion.
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

Never tell the user to enter a code into a terminal, browser, panel, or prompt unless that exact
surface has been verified to be visibly open and usable by the user in the current turn. A
background command session, queued panel tab, tool session, or inferred browser tab is not a
user-facing surface. If visibility cannot be verified, either ask for the required value directly in
chat only when that is safe and explicitly permitted, or provide a complete command for the user to
run in their own terminal. Do not claim that a prompt or page was opened merely because a tool
reported that it was queued or created. Before requesting user interaction, report the exact
surface, URL or command, and how the user can confirm that it is visible; otherwise continue with
non-interactive work or pause at the authorization boundary.

Apply this as a strict preflight, not as a best-effort suggestion:

- Treat every terminal launched through Codex tooling as agent-only and non-interactive for the
  user, even when a tool offers to open, queue, or display that terminal. Never start an
  authentication command there and then ask the user to type into it. Give the user the complete
  command to run in their own terminal instead.
- First identify the user-facing surface by evidence from the current turn. A tool session ID,
  `browser.tabs.new` result, background `exec` process, or queued app action is agent-side evidence
  only; it does not prove that the user can see or control anything.
- Do not say “a prompt is open,” “enter the code,” or “click the new tab” until the visible surface,
  exact location, and required control have been verified. If the surface cannot be verified, say so
  plainly and give the user a self-contained command or navigation path they can run themselves.
- After the user reports completing the action, verify the resulting non-secret postcondition before
  proceeding. Treat “entered,” “done,” or a tool completion message as a report to check, not as
  proof that authentication or deployment succeeded.
- Never ask the user to paste one-time codes, recovery codes, passwords, cookies, tokens, or other
  secrets into chat. Keep those values in the verified provider or user-owned terminal surface.

Update `docs/goal/READINESS.md` only when a blocker affects active milestone completion or must
survive a handoff. For a temporary question or local-only interruption, report the blocker without
creating an unrelated documentation change.
