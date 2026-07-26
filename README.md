# Choir Management Cloudflare

Standalone, multi-Organization Cloudflare rebuild of the choir management application.

The foundation is live in permanent staging:

- Application: <https://choir-management-cloudflare-staging.wes-osborn-account.workers.dev>
- Health: <https://choir-management-cloudflare-staging.wes-osborn-account.workers.dev/api/health>
- Readiness: <https://choir-management-cloudflare-staging.wes-osborn-account.workers.dev/api/ready>

This is a staging-only rebuild. Production has not been launched, and the project does not migrate
PocketBase data.

## Repository relationship

The immutable behavioral baseline is legacy commit `6874d43a3c3698ae53218a44d17649bc454ca9ac`. Local
development may inspect the sibling parity worktree, but this repository's install, checks, tests,
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

Requirements: Node.js 22.12 or newer, npm 11 or newer, and a Chromium runtime installed through
Playwright.

```bash
npm ci
npx playwright install chromium
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

Playwright E2E tests are intentionally local-only so Chromium installation and browser execution do
not delay the GitHub CI-to-staging deployment path. Run `npm run test:e2e` locally when browser
coverage is needed; the remaining checks above are the deploy-blocking GitHub gates.

`npm run test:integration` starts workerd on loopback and may require an execution environment that
allows local ports. Regenerate Worker binding declarations after changing `wrangler.jsonc`:

```bash
npm run wrangler -- types apps/worker/worker-configuration.d.ts \
  --config apps/worker/wrangler.jsonc --include-runtime=false
```

## Staging operations

Local Wrangler OAuth is stored through its supported macOS keyring flow. Do not copy that credential
into this repository.

```bash
npm run wrangler -- d1 migrations apply CONTROL_DB \
  --config apps/worker/wrangler.jsonc --env staging --remote
npm run deploy:staging
```

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
