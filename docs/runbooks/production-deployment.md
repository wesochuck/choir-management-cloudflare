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
3. The local release gate (`npm run check:ci` and `npm run test:e2e`) must pass on a clean `main`
   branch matching `origin/main`.
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

Onboard `auth@mail.musicsite.org` as a verified sender domain in Cloudflare Email Service with
appropriate SPF, DKIM, and DMARC records.

---

## 3. Production Secrets Configuration

Set the production Worker secrets via Wrangler (never commit secrets to git or chat):

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put SIGNED_LINK_SECRET --env production
npx wrangler secret put STRIPE_SECRET_KEY --env production
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
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

## 6. Immutable Artifact Promotion

Promote the exact staging-qualified commit SHA and lockfile hash:

1. Build the immutable release artifact locally:
   ```bash
   npm run check:ci
   ```
2. Upload the inactive Worker version to production:
   ```bash
   npx wrangler versions upload --config apps/worker/wrangler.jsonc --env production
   ```
3. Deploy the uploaded Worker version at 100% traffic:
   ```bash
   npx wrangler versions deploy <version-id>@100% --config apps/worker/wrangler.jsonc --env production
   ```

---

## 7. Post-Deployment Verification & Smoke Tests

1. Verify public health endpoints:
   - `https://musicsite.org/api/health` -> HTTP 200 with matching `BUILD_VERSION`.
   - `https://musicsite.org/api/ready` -> HTTP 200.
2. Verify tenant isolation:
   - Unregistered wildcard subdomain (e.g. `https://unknown-org.musicsite.org`) -> HTTP 404.
3. Provision the first production Organization via the Platform Admin portal.
4. Validate live Stripe Connect onboarding, transactional emails, and DNS routing.
