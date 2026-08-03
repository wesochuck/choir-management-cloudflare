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

- One commit and lockfile build once in CI. The hashed Worker/web artifact is uploaded unchanged to
  each isolated environment without cherry-picking, rebuilding, or manual file copying.
- Staging and production never share D1, Durable Object state, R2, KV, queues, secrets, domains, or
  provider modes.
- CI records commit SHA, lockfile hash, migration set, Worker version, and parity result.
- Production deploys only an already staging-qualified commit after environment approval.
- Schema expansion is forward-compatible; rollback changes Worker version, never rewrites an applied
  migration.

Cloudflare Worker Version IDs are scoped to one Worker, so isolated staging and production Workers
receive different version IDs. Promotion identity is the verified artifact manifest: commit SHA,
lockfile SHA-256, Worker bundle hashes, and web-asset hashes must all match. Routes, queue
consumers, schedules, and Workflow triggers are applied separately because Cloudflare does not
version them with Worker code; those changes therefore follow backward-compatible expand/contract
discipline too.

Local OAuth is in the Wrangler/macOS keyring. GitHub Actions requires a separate least-privilege
Cloudflare API token stored as an environment secret, never copied from the local credential.

## Organization communications sandbox gate

The Worker has a Brevo adapter, but staging remains in deterministic `fake` mode until the operator
supplies a staging-only API key, verifies the Organization email sender, configures an SMS sender,
and records an explicit SMS recipient allowlist as Worker secrets/variables. Email qualification
uses Brevo's documented `X-Sib-Sandbox: drop` request header, which validates the request without
sending or creating an email log. Brevo does not provide the same no-send behavior for transactional
SMS, so sandbox SMS is suppressed unless its exact destination is allowlisted. Provider response
bodies and credentials are never copied into delivery failures or logs.

References: [Brevo email sandbox mode](https://developers.brevo.com/docs/using-sandbox-mode),
[transactional email API](https://developers.brevo.com/reference/send-transac-email), and
[transactional SMS API](https://developers.brevo.com/reference/send-async-transactional-sms).
