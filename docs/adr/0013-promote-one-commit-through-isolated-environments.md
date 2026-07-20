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
