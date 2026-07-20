# Cloudflare Rebuild Goal Contract

## Outcome

Create and execute the standalone `choir-management-cloudflare` application through a
production-ready permanent staging deployment. Preserve every implemented module, workflow, export,
public behavior, responsive/accessibility behavior, and recognizable visual characteristic from
legacy baseline commit `6874d43a3c3698ae53218a44d17649bc454ca9ac`. Implement the accepted
multi-Organization Cloudflare architecture in the rebuild plan. Do not migrate PocketBase data and
do not launch production.

## Required Execution

1. Read `AGENTS.md`, this goal contract, `docs/goal/READINESS.md`, the rebuild plan, `CONTEXT.md`,
   and ADRs 0003–0015 completely.
2. Verify the read-only sibling parity worktree is exactly the recorded baseline and report
   unexpected changes before using it as evidence.
3. Execute Milestones 0–6 in order. Maintain the File Responsibility Map and parity matrix as work
   progresses.
4. Keep this repository's CI, tests, builds, deployment, and runtime independent of the legacy
   checkout.
5. Use local/fake external effects until an explicitly configured staging gate requires real
   Cloudflare primitives or provider sandbox/test modes.
6. Continue through safe implementation and verification. Pause only for interactive authorization,
   secure secret entry, absent external entitlement/permission, or a genuinely product-changing
   decision not resolved by the plan and ADRs.

## Hard Constraints

- One Organization is the tenant and operational authorization boundary.
- Control-plane D1, per-Organization SQLite Durable Objects, Organization-scoped R2, derived KV
  routing cache, Queues, Workflows, and per-Organization alarms retain the responsibilities defined
  in the plan.
- Whole-product parity is required; internal milestones are not partial production releases.
- The new frontend uses repository-owned Radix-based components and preserves visual/interaction
  parity without copying Shoelace implementation dependencies.
- Strict TypeScript, forward-only expand/contract migrations, bounded network work, idempotent
  external effects, secret redaction, accessibility, responsive behavior, and tenant-isolation
  testing are mandatory.
- Staging and production are isolated. Production promotion would use the identical
  staging-qualified commit and lockfile, but production deployment is outside this goal.

## Completion Criteria

The goal is complete only when Milestone 6's whole-product staging gate passes: the full parity
matrix is approved; permanent staging uses real Cloudflare primitives and provider sandbox/test
modes; supported scale, tenant isolation, custom-domain behavior, platform email, queues/dead
letters, Stripe/Brevo webhooks, exports, schedulers, observability, migrations, security checks,
dependency audit, and rollback drill are validated; no unresolved critical/high security finding
remains; and production resources remain isolated and unlaunched.

## Goal Invocation

Use a short persistent objective that points here:

> Execute `docs/goal/GOAL.md` to completion. Treat its outcome, constraints, milestone gates, and
> completion criteria as the persistent definition of done. Keep `docs/goal/READINESS.md` current,
> continue autonomously through safe work, and do not launch production.
