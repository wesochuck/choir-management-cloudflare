# Choir Management Cloudflare

Standalone, multi-Organization Cloudflare choir management application.

## Repository relationship

Local development may inspect the sibling parity worktree, but this repository's install, checks, tests,
builds, CI, and deployments are standalone. The parity worktree is never a runtime or build
dependency.

Read these files before feature work:

1. `AGENTS.md`
2. `docs/goal/GOAL.md`
3. `docs/goal/READINESS.md`
4. `docs/2026-07-20-cloudflare-multitenant-rebuild-plan.md`
5. `CONTEXT.md`
6. `docs/adr/0003-*.md` through `docs/adr/0015-*.md`
7. `docs/parity/feature-matrix.yaml`

## Local setup

Requirements: Node.js 22.12 or newer and npm 11 or newer. Chromium is optional and needed only when
you intentionally run the local Playwright suite.

```bash
npm ci
cp .dev.vars.example apps/worker/.dev.vars
npm run dev
```

Generate two independent local secrets with separate `openssl rand -base64 48` invocations and
replace the `BETTER_AUTH_SECRET` and `SIGNED_LINK_SECRET` placeholders in the untracked
`apps/worker/.dev.vars` file. Never reuse either local value in staging or production, and never use
the Better Auth secret to sign public or private links.

Wrangler writes task-local logs beneath `.wrangler/logs`; project scripts set `WRANGLER_LOG_PATH` so
sandboxed development does not attempt to write macOS preference directories.

## Quality gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run check:parity
npm run build
npm audit --audit-level=high
```

Playwright E2E tests are intentionally opt-in and local-only. Install Chromium with
`npx playwright install chromium` and run `npm run test:e2e` only when browser coverage is
warranted. `npm run check:ci` is the browser-free gate; `npm run check:release` is the full release
qualification (check:ci plus the Chromium E2E suite) required before production promotion. Workerd
integration tests and exact deployed-version API checks remain the deployment qualification gates.

`npm run test:integration` starts workerd on loopback and may require an execution environment that
allows local ports. Regenerate Worker binding declarations after changing `wrangler.jsonc`:

```bash
npm run wrangler -- types apps/worker/worker-configuration.d.ts \
  --config apps/worker/wrangler.jsonc --include-runtime=false
```

## Staging operations

Local Wrangler OAuth is stored through its supported macOS keyring flow. Do not copy that credential
into this repository. Routine staging releases run only through GitHub Actions after `main` passes
CI; there is no local direct-deploy shortcut.

CI builds the Worker bundle and web assets once, records their hashes with the commit and lockfile,
and uploads that immutable release artifact. The staging workflow downloads and verifies those same
bytes, applies forward-only D1 migrations, uploads a tagged Cloudflare Worker Version, shifts 100%
of staging traffic, applies version-external triggers, and checks health/readiness on the product
and seeded Organization hosts. Failed API qualification automatically restores the prior Worker
Version when one exists. No browser smoke test runs in this path.

Staging external effects remain captured/fake until provider sandbox credentials and allowlists are
configured. The deployment currently uses:

- D1: `choir-management-control-staging`
- Durable Object export: `OrganizationStore`
- R2: `choir-management-staging`
- KV: `choir-management-routing-staging`
- Queue: `choir-management-jobs-staging`
- Dead-letter queue: `choir-management-jobs-dlq-staging`
- Workflow: `choir-management-provisioning-staging`

The first Platform Administrator grant is an explicit, staging-only operator action. It uses the
authenticated local Wrangler session and refuses to target production by construction:

```bash
npm run bootstrap:staging-platform-admin -- \
  --email platform-administrator@example.com \
  --name "Platform Administrator"
```

The command is idempotent for an existing identity/grant and writes an audit event only when it adds
the grant. It does not create a password, session, one-time code, or MFA secret. After platform
email is enabled, the user signs in by email code, enrolls TOTP, saves the generated recovery codes,
and confirms enrollment before any Platform Administrator route authorizes the session.

Production configuration is deliberately inert and must not be deployed as part of the active goal.
