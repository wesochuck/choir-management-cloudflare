# Retire Legacy Parity Tracking and Adopt Cloudflare Source of Truth

**Status:** Accepted  
**Supersedes:** [ADR 0010](file:///Users/wesosborn/Downloads/choir-management-cloudflare/docs/adr/0010-require-whole-product-parity-before-cloudflare-release.md)  
**Date:**
2026-10-14

## Context

The initial multi-tenant rebuild of Choir Management on Cloudflare Workers and Durable Objects was
guided by whole-product parity tracking
([ADR 0010](file:///Users/wesosborn/Downloads/choir-management-cloudflare/docs/adr/0010-require-whole-product-parity-before-cloudflare-release.md))
against the legacy PocketBase baseline commit `6874d43a3c3698ae53218a44d17649bc454ca9ac`, maintained
via `docs/parity/feature-matrix.yaml` and parity audit scripts.

With all core modules, workflows, tenant isolation boundaries, passkey authentication, public
ticketing, media streaming, compliance catalog, and administrative controls implemented and verified
on the modern Cloudflare architecture, maintaining the 216-entry legacy parity ledger, legacy
baseline checkout references, and migration-era scaffolding has become redundant overhead.

## Decision

1. **Authoritative Source of Truth:** Cloudflare application code, typed contracts
   (`packages/contracts`), current automated test suites, and accepted contemporary ADRs under
   `docs/adr/` are the sole authoritative sources of truth for product behavior and architecture.
   The legacy PocketBase codebase and its pinned commit are historical reference material only,
   never a feature requirement or default agent research step.
2. **Retire Parity Matrix and Matrix Scripts:** Retire `docs/parity/feature-matrix.yaml`,
   `scripts/check-parity-matrix.mjs`, and `scripts/audit-parity-implementation.mjs`.
3. **Cloudflare-Native Route Integrity:** Enforce Worker route integrity using
   `scripts/check-routes.mjs` (`npm run check:routes` in `check:ci`), verifying that all Worker
   route modules export standard Hono route registrations, validate URL path syntax, and prevent
   duplicate route definitions.
4. **Preserve Security and Boundary Qualification:** Transition staging qualification probes
   (`scripts/route-probe-plan.mjs` and `scripts/qualify-staging-evidence.mjs`) to source-derived
   application routes, preserving all safe anonymous boundary checks, cross-Organization isolation
   sweeps, and typed error assertions.
5. **Preserve Active Architectural Contracts:** Transition CSV formatting rules and signed-link
   security specifications into active architecture documentation
   (`docs/architecture/csv-contracts.md` and `docs/architecture/signed-link-behavior.md`).

## Consequences

- Coding agents and developers focus on current Cloudflare architecture, contracts, and tests rather
  than inspecting historical PocketBase implementations.
- Eliminates the need to maintain an out-of-band 3,500-line YAML matrix.
- Preserves all regression safeguards, security boundary sweeps, and tenant isolation guarantees.
- Retains historical decision records accurately without rewriting past milestone history.
