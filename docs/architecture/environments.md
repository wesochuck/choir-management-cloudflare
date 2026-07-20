# Environment and Promotion Inventory

| Environment | Bindings and data                               | External effects                  | Deployment  |
| ----------- | ----------------------------------------------- | --------------------------------- | ----------- |
| Local       | Wrangler/Miniflare local D1, DO, R2, KV, queues | deterministic fake/capture        | developer   |
| Preview     | disposable isolated resources                   | disabled or captured              | PR-only     |
| Staging     | permanent isolated real Cloudflare primitives   | fake until provider sandbox gates | `main`      |
| Production  | separate, empty, uncreated/unlaunched resources | real only after separate approval | out of goal |

## Permanent staging inventory

- Account: `Wes Osborn Account` (`94c9ad3f9675d11eca39ca32ed5241e1`)
- URL: `choir-management-cloudflare-staging.wes-osborn-account.workers.dev`
- D1: `choir-management-control-staging`
- Durable Object: declarative SQLite export `OrganizationStore`
- R2: `choir-management-staging`
- KV: `choir-management-routing-staging`
- Queue/DLQ: `choir-management-jobs-staging` / `choir-management-jobs-dlq-staging`
- Workflow: `choir-management-provisioning-staging`

The workers.dev hostname is an accepted generic foundation URL, not a wildcard Organization-domain
solution. Canonical Organization subdomains and Cloudflare for SaaS tests require a managed zone and
safe test hostnames later.

## Promotion invariants

- One commit and lockfile build once and are promoted without cherry-picking or manual file copying.
- Staging and production never share D1, Durable Object state, R2, KV, queues, secrets, domains, or
  provider modes.
- CI records commit SHA, lockfile hash, migration set, Worker version, and parity result.
- Production deploys only an already staging-qualified commit after environment approval.
- Schema expansion is forward-compatible; rollback changes Worker version, never rewrites an applied
  migration.

Local OAuth is in the Wrangler/macOS keyring. GitHub Actions requires a separate least-privilege
Cloudflare API token stored as an environment secret, never copied from the local credential.
