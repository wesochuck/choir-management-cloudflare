# Choir Management Cloudflare

Standalone, multi-Organization choir management application built on Cloudflare Workers, SQLite
Durable Objects, D1, R2, KV, Queues, and Workflows.

## Architecture and repository structure

Each **Organization** is a strict tenant boundary. The Gateway Worker terminates all browser, API,
webhook, queue, scheduled, and Workflow traffic, resolves the Organization from the validated
hostname and authoritative D1 control-plane registry (with derived KV routing cache), and dispatches
operational work to that Organization's SQLite Durable Object (`OrganizationStore`) via Cloudflare
Workers RPC. Public pages and media use versioned Published Projections and Organization-scoped R2
storage.

The monorepo is organized into workspaces:

- `apps/worker` — Cloudflare Worker gateway, `OrganizationStore` Durable Object, D1 control plane,
  Queues (`jobs` and `email-events`), Workflows (`ProvisioningWorkflow`, `FleetSchemaWorkflow`,
  `CustomDomainWorkflow`), and provider integrations (Cloudflare Email Sending, Stripe Connect,
  Brevo SMS, Cloudflare for SaaS).
- `apps/web` — React single-page application for public websites, ticketing, donations, auditions,
  signed-link views (`/player`, `/rsvp`, `/poll`, `/auditions`, `/unsubscribe`), member portal, and
  Organization/Platform administration.
- `packages/contracts` — Shared Zod validation schemas and TypeScript transport contracts.
- `packages/domain` — Pure domain rules (roster balance, status automation, RSVP/attendance
  reconciliation, loudnorm/audio helpers, permissions, and formatting).
- `packages/ui` — Repository-owned accessible React UI primitives built on Radix.
- `packages/testkit` — Deterministic fixtures, relative date factories, and provider fakes.

### Authoritative sources of truth

Legacy PocketBase parity tracking has been retired
(`docs/adr/0049-retire-legacy-parity-tracking-and-adopt-cloudflare-source-of-truth.md`). This
repository's code, contracts, tests, and accepted ADRs are standalone and authoritative.

Read these documents before making changes:

1. `AGENTS.md` (and scoped `apps/web/AGENTS.md`, `apps/worker/AGENTS.md`, `packages/AGENTS.md`)
2. `docs/goal/GOAL.md` and `docs/goal/READINESS.md`
3. `docs/architecture/` (`runtime.md`, `data-model.md`, `environments.md`,
   `signed-link-behavior.md`, `csv-contracts.md`)
4. `CONTEXT.md` (ubiquitous domain language)
5. Architectural Decision Records under `docs/adr/`

## Local setup

Requirements: Node.js 22.12 or newer and npm 11 or newer. Chromium is needed for the local
Playwright E2E suite and release qualification.

```bash
npm ci
cp .dev.vars.example apps/worker/.dev.vars
npm run dev
```

Generate two independent local secrets with separate `openssl rand -base64 48` invocations and
replace the `BETTER_AUTH_SECRET` and `SIGNED_LINK_SECRET` placeholders in the untracked
`apps/worker/.dev.vars` file. Never reuse either local value in staging or production, and never use
the Better Auth secret to sign public or private links.

For optional local MCP and staging qualification credential setup (stored outside git in
`~/.gemini/config/mcp_config.json` and `.env.staging.local`), run:

```bash
npm run setup:env
```

Wrangler writes task-local logs beneath `.wrangler/logs`; project scripts set `WRANGLER_LOG_PATH` so
sandboxed development does not attempt to write macOS preference directories.

## Verification and quality gates

Three verification levels govern local development:

1. **Focused development iteration:**

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

   Additional static boundary checks include `npm run check:routes`, `npm run check:do-runtime`,
   `npm run check:contracts:exports`, `npm run check:csp`, `npm run check:no-eyebrows`,
   `npm run check:spacing`, and `npm run check:control-alignment`.

2. **Browser-free comprehensive gate (`npm run check:ci`):** Runs dependency audits, lockfile
   verification, Durable Object runtime boundary checks, formatting, ESLint, Knip, contract exports,
   route integrity, unit and UI tests, build/artifact packaging verification, and workerd
   integration tests without launching browsers. For local development during a transient npm
   registry audit outage, `npm run check:ci:dev` runs the same checks and reports a degraded pass
   when only the audit endpoint is unreachable (`docs/runbooks/dependency-audit-outage.md`).

3. **Complete release qualification (`npm run check:release`):** Required on a clean committed
   candidate before pushing `main` or promoting to staging. Runs `npm run check:ci` followed by the
   full desktop and mobile Chromium Playwright E2E suites with `RELEASE_QUALIFICATION=1`. On a clean
   committed tree, `check:release` writes `.wrangler/releases/qualification.json`, which staging
   deployment can reuse for up to four hours when all inputs and artifact hashes match
   (`docs/adr/0051-reuse-local-release-qualification.md`).

`npm run test:integration` builds `@choir/web` and runs the workerd integration suite on loopback
(`npm run test:integration:prepared` runs workerd directly when the web build is already prepared).

Regenerate Worker binding declarations after changing `apps/worker/wrangler.jsonc`:

```bash
npm run wrangler -- types apps/worker/worker-configuration.d.ts \
  --config apps/worker/wrangler.jsonc --include-runtime=false
```

## Staging deployment and operations

The active deployment target is permanent staging (`staging.musicsite.org` and
`{slug}.staging.musicsite.org`). GitHub Actions is disabled for this repository; release checks and
deployments run locally from an authenticated maintainer workstation via Wrangler's supported
keyring session. Do not use raw `wrangler deploy`.

The standard release flow (detailed in `docs/runbooks/staging-deployment.md`) is:

1. Commit changes locally on `main`.
2. Qualify the clean commit:
   ```bash
   npm run check:release
   ```
3. Push `main` to `origin/main`.
4. Promote to permanent staging:
   ```bash
   npm run deploy:staging -- --yes
   ```
   (`npm run release:staging -- --yes` is an alias; pass `--force-release-checks` to force a fresh
   full gate run instead of reusing recent qualification evidence.)

The guarded staging deployment verifies a clean `main` checkout matching `origin/main`, verifies or
runs `check:release`, creates and hashes one immutable release artifact, applies forward-only D1
migrations and version-external triggers, uploads and deploys a new Cloudflare Worker Version, and
runs API-only post-deploy qualification (health/readiness, exact `BUILD_VERSION`, seeded
Organization host resolution, and safe anonymous boundary probes). A real Worker qualification
failure automatically rolls traffic back to the prior Worker Version.

Hosted staging qualification suites can also be run against permanent staging:

```bash
npm run qualify:staging
npm run qualify:staging:evidence
npm run qualify:staging:all
```

### Permanent staging resources

- **Product domain:** `staging.musicsite.org` (`*.staging.musicsite.org`)
- **D1:** `choir-management-control-staging`
- **Durable Object:** `OrganizationStore` (SQLite-backed)
- **R2:** `choir-management-staging`
- **KV:** `choir-management-routing-staging`
- **Queues & DLQs:** `choir-management-jobs-staging` (`choir-management-jobs-dlq-staging`),
  `choir-management-email-events-staging` (`choir-management-email-events-dlq-staging`)
- **Workflows:** `choir-management-provisioning-staging`, `choir-management-fleet-schema-staging`,
  `choir-management-custom-domain-staging`
- **Email & AI bindings:** `PLATFORM_EMAIL` (`auth@mail.staging.musicsite.org` with staging
  recipient allowlist), Workers `AI`

### Bootstrapping a staging Platform Administrator

The first Platform Administrator grant is an explicit, staging-only operator action that uses the
authenticated local Wrangler session and refuses to target production:

```bash
npm run bootstrap:staging-platform-admin -- \
  --email platform-administrator@example.com \
  --name "Platform Administrator"
```

The command is idempotent and records an audit event only when adding a grant. It does not create a
password, session, one-time code, or MFA secret. The administrator signs in via passkey or email
one-time code, enrolls TOTP MFA, saves recovery codes, and confirms enrollment before any Platform
Administrator route authorizes the session.

## Production boundary

Production resources are isolated from staging and must not be launched or modified without explicit
user authorization and an updated goal contract. When authorized, production promotion
(`docs/runbooks/production-deployment.md`) promotes the exact staging-qualified artifact without
rebuilding.
