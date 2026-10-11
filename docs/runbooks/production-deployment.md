# Production Provisioning and Deployment Runbook

This runbook outlines the required sequence for provisioning, configuring, and launching the
production environment for `choir-management-cloudflare`.

> [!IMPORTANT] **Production Launch Precondition:** Production launch is governed by Milestone 7 of
> `docs/2026-07-20-cloudflare-multitenant-rebuild-plan.md`. It must not be executed until all
> Milestone 6 staging qualification gates pass, the parity matrix is 100% verified, and explicit
> stakeholder approval is granted.

---

## 1. Production Prerequisites

Before creating production resources or deploying code:

1. All 206 parity entries in `docs/parity/feature-matrix.yaml` must be `status: verified`.
2. Staging qualification suites (`npm run qualify:staging:all`) must pass with 100% success.
3. The full release qualification (`npm run check:release`, which runs the browser-free
   `npm run check:ci` gate plus the Playwright Chromium E2E suite) must pass on a clean `main`
   branch matching `origin/main`. `npm run check:ci` alone is the browser-free subset and is not
   sufficient for production promotion.
4. Production domains (`musicsite.org`, `*.musicsite.org`, and Cloudflare Email Sending domains)
   must be registered in the production Cloudflare account.

---

## 2. Cloudflare Resource Provisioning

Provision isolated production Cloudflare platform resources:

### A. D1 Control-Plane Database

```bash
npx wrangler d1 create choir-management-control-production
```

Record the resulting `database_id` and update `apps/worker/wrangler.jsonc` in the `production`
environment.

### B. KV Routing Cache Namespace

```bash
npx wrangler kv:namespace create choir-management-routing-cache-production
```

Record the resulting namespace ID and update `apps/worker/wrangler.jsonc`.

### C. R2 Storage Bucket

```bash
npx wrangler r2 bucket create choir-management-production
```

### D. Cloudflare Queues & Dead-Letter Queues

```bash
npx wrangler queues create choir-management-jobs-production
npx wrangler queues create choir-management-jobs-dlq-production
npx wrangler queues create choir-management-email-events-production
npx wrangler queues create choir-management-email-events-dlq-production
```

### E. Cloudflare Email Sending

Enable Email Sending for the production sending subdomain and verify DNS SPF, DKIM, and DMARC:

```bash
npx wrangler email sending enable mail.musicsite.org
npx wrangler email sending list
npx wrangler email sending settings mail.musicsite.org
```

---

## 3. Production Secrets Configuration

Set the production Worker secrets via Wrangler (never commit secrets to git or chat):

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put SIGNED_LINK_SECRET --env production
npx wrangler secret put STRIPE_SECRET_KEY --env production
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
npx wrangler secret put STRIPE_V2_EVENT_DESTINATION_SECRET --env production
npx wrangler secret put BREVO_API_KEY --env production
npx wrangler secret put CLOUDFLARE_API_TOKEN --env production
```

---

## 4. Control-Plane Database Migration

Apply all forward-only D1 migrations against the production database:

```bash
npx wrangler d1 migrations apply CONTROL_DB --env production --remote
```

Verify that all migrations (`0001` through `0015+`) apply cleanly.

---

## 5. First Platform Administrator Bootstrap

Bootstrap the initial Platform Administrator identity in the production control-plane D1:

```bash
node scripts/bootstrap-staging-platform-admin.mjs --env production --email <admin-email>
```

1. Sign in to the production product host (`https://musicsite.org/login`).
2. Complete mandatory TOTP MFA enrollment.
3. Securely store the generated recovery codes in a password manager.

---

## 6. Build-Once Promotion of the Staging-Qualified Artifact

Build and qualify once on staging, then promote those exact bytes. Staging success never promotes
production automatically; production requires its own explicit approval after manual staging review.

1. Qualify staging once and retain its bytes:

   ```bash
   npm run release:staging -- --yes
   # Review staging / conduct any manual acceptance tests.
   ```

   This runs the full `npm run check:release` gate a single time, uploads the verified Worker bundle
   plus `apps/web/dist` to staging, qualifies the exact `BUILD_VERSION`, and retains the immutable
   artifact under `.wrangler/releases/artifacts/<sha>/` with a separate staging receipt
   `.wrangler/releases/staging-<sha>.json`.

2. Promote the qualified artifact without rebuilding:

   ```bash
   npm run release:promote -- --yes
   # Or, when several staging receipts exist: npm run release:promote -- --sha <full-sha> --yes
   ```

   The promotion command never runs a fresh build or the full release suite when all preconditions
   are met. It refuses missing/failed/rolled-back/stale qualification, a changed or missing
   artifact, an incorrect commit or lockfile, an ambiguous SHA, or an unexpected staging Worker
   version. A new commit pushed to `main` after qualification cannot be substituted silently: the
   command promotes the receipt's SHA explicitly and warns when local `HEAD` differs. `--yes` is
   intentional approval, not a bypass for integrity or qualification checks.

   On success it applies forward-only production D1 migrations and version-external triggers,
   uploads the exact staged `index.js` plus static-asset bytes with production bindings, secrets,
   domains, queues, and `BUILD_VERSION`, shifts production traffic only after the upload, qualifies
   production health/readiness and the exact deployed SHA at 100%, and writes a separate production
   receipt `.wrangler/releases/production-<sha>.json` recording the source staging receipt and
   artifact hashes. The production Worker version ID differs from staging by design.

   A failed production smoke check restores the captured prior production Worker code. That rollback
   does not reverse already-applied D1 migrations, trigger/route/schedule changes, or external
   provider effects; keep those changes backward compatible and follow `docs/runbooks/rollback.md`
   for manual recovery.

Legacy `npm run deploy:production -- --yes` remains available for exceptional independent rebuilds
(it still runs `check:ci` plus E2E, rebuilds, and now writes `production-<sha>.json` so it can never
overwrite a staging receipt), but build-once `release:promote` is the preferred path. There is no
`--skip-checks` or `--force-unqualified` bypass; do not add one.

---

## 7. Post-Deployment Verification & Smoke Tests

1. Verify public health endpoints:
   - `https://musicsite.org/api/health` -> HTTP 200 with matching `BUILD_VERSION`.
   - `https://musicsite.org/api/ready` -> HTTP 200.
2. Verify tenant isolation:
   - Unregistered wildcard subdomain (e.g. `https://unknown-org.musicsite.org`) -> HTTP 404.
3. Provision the first production Organization via the Platform Admin portal.
4. Validate live Stripe Connect onboarding, transactional emails, and DNS routing.
