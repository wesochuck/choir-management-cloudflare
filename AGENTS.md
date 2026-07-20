# AGENTS.md

Mandatory instructions for AI coding agents working in this repository.

## 1. Mission and Sources of Truth

- Execute `docs/2026-07-20-cloudflare-multitenant-rebuild-plan.md` milestone by milestone.
- Treat `docs/goal/GOAL.md` as the durable goal contract and `docs/goal/READINESS.md` as the
  machine/environment handoff.
- The immutable behavioral baseline is legacy commit `6874d43a3c3698ae53218a44d17649bc454ca9ac` in
  the read-only sibling Parity Bridge.
- Use evidence in this order: executable baseline code/tests; these instructions; `CONTEXT.md` and
  ADRs 0003–0015; historical plans as supporting intent only.
- Keep this repository fully standalone. Never import legacy source in builds, tests, CI,
  deployments, or runtime.
- Do not launch production. The active goal ends at a production-ready permanent staging deployment
  with every required gate passing.

## 2. Critical Engineering Rules

- Use strict TypeScript. Do not use `any`, `as any`, `// @ts-ignore`, or blanket lint suppression
  without explicit user approval. Use `unknown` and narrow it.
- Never log or commit secrets, credentials, one-time codes, recovery codes, full signed tokens, or
  provider payloads containing sensitive data.
- One Organization is one tenant. Operational data, files, jobs, tokens, caches, and audit events
  must never cross Organization boundaries.
- Resolve the Organization from the validated hostname and authoritative registry before
  authorization. A client-supplied Organization ID must never select storage.
- Keep operational data in the Organization Durable Object. D1 is control-plane only; KV is derived
  routing cache only; R2 keys must be Organization-scoped.
- All external work is bounded, retryable, idempotent, and attributable to exactly one Organization.
- Prevent O(N^2) bottlenecks. Do not call linear scans inside tight loops or sort comparators;
  precompute `Map` or `Set` lookups.
- Preserve raw provider error details for typed formatters while redacting secrets from logs and
  user-visible output.
- Every schema change is forward-only. Never rewrite an applied migration. Use expand/contract
  changes compatible with rollback.
- Do not weaken a quality, size, security, isolation, accessibility, parity, or migration gate
  merely to make it pass.

## 3. Commands and Verification

Use standard project commands directly. Do not require a machine-specific command wrapper.

The initial scaffold must provide root scripts for at least:

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

Run focused checks while iterating and the complete milestone gate before declaring a milestone
complete. Run `npm ci`, not `npm install`, in CI after the lockfile exists.

Before finishing any material change, report:

- what changed and which plan/parity entries it satisfies;
- which checks ran and their results;
- any check that could not run and the exact reason;
- migration and rollback implications;
- tenant-isolation, external-effect, accessibility, and performance risks;
- any generated artifact and how it was regenerated;
- remaining work in the milestone File Responsibility Map.

## 4. Plan Execution and Parity

- Expand the plan's File Responsibility Map before implementing files not already represented there.
- Verify every file assigned to a milestone before declaring its gate complete.
- Maintain `docs/parity/feature-matrix.yaml` as executable evidence, not a prose checklist.
- Every baseline route, public flow, signed flow, service workflow, export, file behavior, scheduled
  task, responsive state, and accessibility-critical interaction needs a parity entry.
- A historical plan is not proof of implemented behavior. Confirm it against baseline code or tests
  and classify it as implemented, partial, proposed, superseded, or irrelevant.
- Copy only approved contracts, fixtures, screenshots, CSV specifications, glossary entries, and
  ADRs from the Parity Bridge.
- New signed-link bytes need not match PocketBase, but purpose, authorization, Organization binding,
  expiry/revocation behavior, and constant-time verification must be covered.

## 5. Tenancy, Authorization, and Audit

- D1 owns global identity, Better Auth state, Organization registry, memberships, invitations,
  domains, Platform Administrator grants, and integration routing metadata only.
- One SQLite-backed Durable Object owns each Organization's operational records and scheduler state.
- Verify membership or scoped Platform Administrator elevation before invoking operational methods.
- Platform Administrator access is Organization-at-a-time, never impersonated, visibly elevated for
  edits, time-bounded, and attributed to the actual actor.
- Audit events are append-only through application APIs and include safe actor, Organization,
  action, target, request, timestamp, and change-summary fields.
- Add adversarial isolation tests for host alteration, Organization-ID alteration, cross-membership
  use, cross-host token replay, R2 key substitution, stale invitations, revoked elevation, queue
  replay, and webhook-account mismatch.

## 6. Cloudflare Data and Background Work

- Use versioned D1 and Organization-store migrations with explicit schema registries.
- Durable Object transactions must remain short; provider calls never occur inside them.
- Organization alarms transactionally create stable jobs and advance the next alarm.
- Queue delivery is at-least-once. Record a stable idempotency key before any repeated delivery can
  create another external effect.
- Use bounded concurrency, exponential backoff, jitter, attempt records, terminal states, and
  dead-letter visibility.
- Public traffic reads versioned Published Projections from R2/edge cache; it must not serialize
  through the Organization object during bursts.
- Private R2 downloads require authorization. Public assets use immutable versioned URLs.
- Validate every untrusted HTTP, queue, webhook, provider, import, and export boundary with Zod and
  explicit size limits.

## 7. TypeScript, React, and Tests

- Keep business rules in `packages/domain`, contracts in `packages/contracts`, and infrastructure
  details out of React.
- Do not import React only for JSX; use type-only imports when needed.
- Follow Hook purity and exhaustive-dependency rules. Do not place hooks below early returns or call
  impure functions directly during render.
- Do not blindly synchronize query data into local state; background refetches must not erase
  unsaved input.
- Shared query keys belong in one typed registry.
- Tests must cover success, authorization failure, validation failure, retry/replay, rollback
  compatibility, and tenant isolation where applicable.
- Use deterministic clocks, provider fakes, and local Cloudflare bindings. Do not wait on real
  timers in unit tests.

## 8. UI, Accessibility, and Product Language

- Use repository-owned shadcn-style components built on Radix primitives. Do not copy Shoelace/Web
  Awesome implementation dependencies.
- Use Tailwind and semantic theme variables. Avoid raw dark-mode overrides when semantic tokens
  express the intent.
- Preserve responsive table/card layouts, mobile dialogs, focus management, keyboard use,
  destructive confirmation patterns, and meaningful loading/error/empty states.
- Destructive actions require danger-styled confirmations with a visible Cancel action.
- Icon-only controls require accessible labels; decorative icons are hidden from assistive
  technology.
- Use `DataTable` for tabular data and preserve mobile-card behavior for complex rows.
- Use the exact product language in `CONTEXT.md`: Organization, Organization Profile, Organization
  Membership, Platform Administrator, On Break in the UI, and `Idle` in storage/API/CSV.
- Performer eligibility is a non-empty `voicePart`, not an authorization role.

## 9. Security, Providers, and Environments

- There is no public registration. Email one-time code is primary sign-in; users may set their own
  password; Platform Administrators require MFA and recovery codes.
- Custom public domains never host authenticated administration, member, account-management, or
  Platform Administrator routes.
- Stripe uses Organization-owned connected accounts and direct charges. The platform takes no
  application fee and has no subscription system.
- Platform transactional email and Organization campaign/SMS delivery are separate provider lanes.
- Local and preview environments must not send real messages or create real charges.
- Staging and production use isolated resources and secrets. Production promotes the identical
  staging-qualified commit and lockfile.
- Store developer OAuth credentials in supported keyrings. Store deployed secrets in Worker/GitHub
  environment secret stores, never tracked files.
- Do not modify hosted resources, domains, data, or provider configuration without authenticated
  environment context and authorization consistent with the active goal.

## 10. Pause Conditions

Continue autonomously through safe, in-scope implementation and verification. Pause only when:

- interactive account authorization is required;
- a secret must be entered by the user through a secure provider flow;
- a genuinely product-changing decision is absent from the accepted plan/ADRs;
- an external account lacks a required paid product, entitlement, zone, or permission;
- production launch or a destructive hosted-data operation would be required.

When paused, record the exact blocker and completed work in `docs/goal/READINESS.md` before
reporting it.
