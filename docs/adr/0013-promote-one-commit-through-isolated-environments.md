# Promote One Commit Through Isolated Environments

The Cloudflare repository will use isolated local, permanent staging, and production environments. A
commit merged to `main` deploys automatically to staging, runs integration and parity gates there,
and requires one approval to deploy the same commit and lockfile with production bindings; staging
and production have separate D1, Durable Objects, R2, queues, secrets, domains, and external-service
modes.

**Why:** A permanent integration environment is necessary for whole-product parity, custom domains,
email/SMS, Stripe Connect, and Cloudflare-native storage behavior, while separate code branches
would create avoidable drift. Same-commit promotion trades the cost of maintaining duplicate
environment resources and forward-compatible migrations for predictable releases, simple approvals,
and rapid rollback to a prior production Worker version.

## Amendment 2026-10-11: build once, promote the verified bytes (issue #134)

The automatic-staging sentence above is aspirational; the implemented path is a guarded local
release. `npm run release:staging -- --yes` (alias `deploy:staging`) runs the full `check:release`
gate once from a clean `main` checkout equal to `origin/main`, uploads the verified Worker bundle
and web assets to staging, qualifies the exact `BUILD_VERSION`, and retains the immutable artifact
under `.wrangler/releases/artifacts/<sha>/` with a separate staging receipt `staging-<sha>.json`.
Only complete success produces a promotable receipt.

`npm run release:promote -- --yes [--sha <commit>]` then uploads those exact bytes to production
with production bindings and secrets, without rebuilding or rerunning the full suite. It refuses
missing, incomplete, stale, or ambiguous staging qualification, changed artifacts, source drift, or
a staging version that moved since qualification. Staging and production receipts are namespaced
(`staging-<sha>.json`, `production-<sha>.json`) so one environment can never overwrite the other's
proof. Staging success never auto-promotes production; `--yes` approves the displayed SHA, artifact
hashes, and qualification timestamp but cannot bypass verification. Production rollback restores
prior Worker code only.
