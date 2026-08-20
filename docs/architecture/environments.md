# Environment and Promotion Inventory

| Environment | Bindings and data                               | External effects                       | Deployment  |
| ----------- | ----------------------------------------------- | -------------------------------------- | ----------- |
| Local       | Wrangler/Miniflare local D1, DO, R2, KV, queues | deterministic fake/capture             | developer   |
| Preview     | disposable isolated resources                   | disabled or captured                   | PR-only     |
| Staging     | permanent isolated real Cloudflare primitives   | fake providers; allowlisted auth email | `main`      |
| Production  | separate, empty, uncreated/unlaunched resources | real only after separate approval      | out of goal |

## Permanent staging inventory

- Account: `Wes Osborn Account` (`94c9ad3f9675d11eca39ca32ed5241e1`)
- Product URL: `staging.musicsite.org`
- Canonical Organization namespace: `{slug}.staging.musicsite.org`
- Workers.dev fallback: `choir-management-cloudflare-staging.wes-osborn-account.workers.dev`
- D1: `choir-management-control-staging`
- Durable Object: declarative SQLite export `OrganizationStore`
- R2: `choir-management-staging`
- KV: `choir-management-routing-staging`
- Queue/DLQ: `choir-management-jobs-staging` / `choir-management-jobs-dlq-staging`
- Workflow: `choir-management-provisioning-staging`

`musicsite.org` is the product-owned managed zone. Staging uses its isolated `staging` namespace;
the apex and `{slug}.musicsite.org` remain reserved for an eventual same-commit production
promotion. Independently attached Organization domains remain public-only and use the separate
Cloudflare for SaaS lifecycle.

## Promotion invariants

- One clean `main` commit and lockfile are built once by the guarded local staging release. The
  hashed Worker/web artifact is verified before upload without cherry-picking or manual file
  copying.
- Staging and production never share D1, Durable Object state, R2, KV, queues, secrets, domains, or
  provider modes.
- The local release provenance records commit SHA, lockfile hash, migration set, Worker version, and
  qualification result.
- Production deploys only an already staging-qualified commit after environment approval.
- Schema expansion is forward-compatible; rollback changes Worker version, never rewrites an applied
  migration.

Cloudflare Worker Version IDs are scoped to one Worker, so isolated staging and production Workers
receive different version IDs. Promotion identity is the verified artifact manifest: commit SHA,
lockfile SHA-256, Worker bundle hashes, and web-asset hashes must all match. Routes, queue
consumers, schedules, and Workflow triggers are applied separately because Cloudflare does not
version them with Worker code; those changes therefore follow backward-compatible expand/contract
discipline too.

Local OAuth is in the Wrangler/macOS keyring. GitHub Actions is disabled; local release checks and
Cloudflare authentication remain on the maintainer workstation.

## Organization communications sandbox gate

The Worker uses Cloudflare Email Sending for email delivery and a Brevo adapter for SMS. Staging
remains in deterministic `fake` mode until the operator configures the Cloudflare email
binding/sender/allowlist and, if SMS testing is needed, supplies a staging-only Brevo API key, SMS
sender, and an explicit SMS recipient allowlist as Worker secrets/variables. Transactional SMS is
suppressed unless its exact destination is allowlisted. Provider response bodies and credentials are
never copied into delivery failures or logs.

References:
[Cloudflare Email Sending](https://developers.cloudflare.com/email-routing/email-sending/), and
[Brevo transactional SMS API](https://developers.brevo.com/reference/send-async-transactional-sms).
