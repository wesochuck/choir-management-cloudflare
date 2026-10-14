# Cloudflare Application Goal Contract

## Outcome

Operate and maintain the standalone `choir-management-cloudflare` multi-tenant application through a
production-ready permanent staging deployment. Deliver high reliability, strict tenant isolation,
responsive and accessible web interfaces, and robust provider integrations on Cloudflare Workers,
Durable Objects, and D1. Legacy parity tracking has been retired (ADR 0049); contemporary Cloudflare
code, contracts, tests, and ADRs are authoritative. The active deployment target is permanent
staging. Do not launch production without explicit authorization and an updated goal contract.

## Required Execution

1. Read `AGENTS.md`, this goal contract, `docs/goal/READINESS.md`, `CONTEXT.md`, and accepted ADRs
   under `docs/adr/`.
2. Follow strict development iteration and canonical qualification gates (`npm run check:ci`,
   `npm run check:release`).
3. Maintain route integrity with `npm run check:routes` whenever API endpoints change.
4. Keep staging qualification suites functional and validated (`npm run qualify:staging:all`).
5. Keep this repository's CI, tests, builds, deployment, and runtime fully standalone.
6. Use local/fake external effects until an explicitly configured staging gate requires real
   Cloudflare primitives or provider sandbox/test modes.
7. Continue through safe implementation and verification. Pause only for interactive authorization,
   secure secret entry, absent external entitlement/permission, or a genuinely product-changing
   decision not resolved by accepted ADRs.

## Hard Constraints

- One Organization is the tenant and operational authorization boundary.
- Control-plane D1, per-Organization SQLite Durable Objects, Organization-scoped R2, derived KV
  routing cache, Queues, Workflows, and per-Organization alarms retain the responsibilities defined
  in architecture ADRs.
- The web frontend uses repository-owned Radix-based primitives (`@choir/ui`) and maintains
  accessible, responsive behavior.
- Strict TypeScript, forward-only expand/contract migrations, bounded network work, idempotent
  external effects, secret redaction, accessibility, responsive behavior, and tenant-isolation
  testing are mandatory.
- Staging and production are isolated. Production promotion requires the identical staging-qualified
  commit and lockfile, but production deployment is outside this goal.

## Completion Criteria

Operating criteria are satisfied when: permanent staging is healthy on real Cloudflare primitives
and provider sandbox/test modes; supported scale, tenant isolation, custom-domain behavior, platform
email, queues/dead letters, Stripe/Brevo webhooks, exports, schedulers, observability, migrations,
security checks, dependency audit, and qualification suites (`npm run qualify:staging:all`) pass; no
unresolved critical/high security finding remains; and production resources remain isolated and
unlaunched.

## Goal Invocation

Use a short persistent objective that points here:

> Execute `docs/goal/GOAL.md`. Treat its outcome, constraints, and criteria as the persistent
> definition of done. Keep `docs/goal/READINESS.md` current, continue autonomously through safe
> work, and do not launch production.
