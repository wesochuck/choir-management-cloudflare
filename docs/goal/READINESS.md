# Goal Readiness and Operating State

**Prepared:** July 20, 2026 **Status:** Active; Milestone 0 parity capture is complete and Milestone
1 foundation is partially complete. Permanent staging foundation is healthy. Production is not
launched.

## Repository topology

- Writable target: `/Users/wesandlaura/Downloads/choir-management-cloudflare`
- Current task working mirror:
  `/Users/wesandlaura/Documents/Codex/2026-07-20/prior-conversation-with-codex-conversation-role/choir-management-cloudflare-work`
- Legacy planning checkout: `/Users/wesandlaura/Downloads/choir-management-tool`
- Read-only parity worktree: `/Users/wesandlaura/Downloads/choir-management-tool-parity`
- Immutable parity commit: `6874d43a3c3698ae53218a44d17649bc454ca9ac`
- Local parity tag: `parity-baseline-2026-07-20`

The Downloads target remains authoritative. The task mirror exists only because this Codex task's
filesystem root does not include Downloads; sync it back after verified changes. Never implement in
the parity worktree.

The parity worktree is detached at the correct commit, but `pocketbase/pb_hooks/main.pb.js` contains
four added/two removed generated lines from a prior regeneration. Source and test files are clean.
Use committed Git objects for generated-hook evidence; do not reset, edit, or treat the changed
generated file as baseline truth.

## Verified tooling and authentication

- Git is installed; local identity is `wesochuck <cwosborn@gmail.com>`.
- Node.js `v26.5.0` and npm/npx `11.17.0` are installed.
- GitHub CLI `2.96.0` is installed but is not authenticated.
- The Codex GitHub connector is authenticated as `wesochuck` for the legacy repository.
- Wrangler `4.112.0` is pinned in the lockfile.
- Wrangler OAuth is authenticated through the macOS keyring as `cwosborn@gmail.com`.
- Cloudflare account: `Wes Osborn Account` (`94c9ad3f9675d11eca39ca32ed5241e1`).
- Playwright Chromium `149.0.7827.55` is installed in the normal local browser cache.

Never record OAuth tokens, API tokens, provider keys, one-time codes, recovery codes, webhook
secrets, or signing secrets in this file.

## Permanent staging

- URL: <https://choir-management-cloudflare-staging.wes-osborn-account.workers.dev>
- Worker: `choir-management-cloudflare-staging`
- Current verified Worker version: `3cf3ba50-44f1-4f17-974e-63109fa5a46f`
- D1: `choir-management-control-staging` (`9f543949-192f-49a7-aa59-7cf589b4a62f`), migration
  `0001_initial.sql` applied
- Durable Object: declarative SQLite export `OrganizationStore`
- R2: `choir-management-staging`
- KV: `choir-management-routing-staging` (`9c7f20b2c8024b1b98d17a682c70cf97`)
- Queue: `choir-management-jobs-staging`
- Dead-letter queue: `choir-management-jobs-dlq-staging`
- Workflow: `choir-management-provisioning-staging`
- External effects: `fake`
- Platform email: `capture`

Verified over public HTTPS on July 20, 2026:

- `/api/health` returned HTTP 200 and a validated staging health payload.
- `/api/ready` returned HTTP 200 after querying the migrated D1 binding.
- `/` returned the deployed Vite application shell.

## Completed foundation checks

- `npm run check:parity`: 145 inventory entries validated.
- `npm run typecheck`: passed across all six workspaces.
- `npm run lint`: passed.
- `npm test`: 2 files / 5 tests passed.
- `npm run test:integration`: 1 file / 2 workerd tests passed.
- `npm run test:e2e`: desktop and mobile Chromium smoke tests passed.
- `npm run build`: Vite and Wrangler dry-run builds passed.
- `npm install` audit: zero known vulnerabilities.

Run the full current gate again after the remaining documentation/CI changes and before syncing or
committing.

## Remaining secure or external prerequisites

These do not prevent local implementation of Milestones 0–4:

- Authenticate GitHub CLI with `gh auth login -h github.com`.
- Create private repository `wesochuck/choir-management-cloudflare`, add `origin`, and push the seed
  commit.
- Create a least-privilege Cloudflare API token for GitHub Actions and store it, plus the account
  ID, as GitHub environment secrets. The local Wrangler OAuth credential must not be reused in CI.
- Select or add a Cloudflare zone before wildcard Organization subdomains and Cloudflare for SaaS
  custom-hostname validation. The workers.dev URL is the accepted generic base for foundation work.
- Enable the paid Cloudflare Email Sending entitlement and a verified platform sender domain before
  platform-email staging qualification. `wrangler email sending list` currently returns unauthorized
  code 2036; Email Routing has no configured zones.
- Record allowlisted staging recipients and the initial Platform Administrator email identity
  without placing credentials here.
- Supply Stripe Connect test credentials/webhook secret and Brevo test credentials/verified
  sender/SMS number only at their Milestone 5 staging gates.

## Environment decisions

- GitHub visibility: private.
- Generic foundation hostname: the workers.dev URL above.
- Canonical Organization hostname: deferred until a managed Cloudflare zone is selected; never infer
  a wildcard under workers.dev.
- Staging/production isolation: separate resources and secrets in the same Cloudflare account for
  now; production resources remain uncreated/unlaunched.
- Platform transactional email: capture locally/staging until Email Sending and a verified domain
  are enabled.
- Custom domains: staging validation waits for a safe Cloudflare zone and disposable subdomain/apex/
  `www` hostnames.

## Resume point

1. Create the local seed commit, then authenticate GitHub and publish the private repository when
   the secure interactive login is available.
2. Complete Milestone 1 automatic staging provenance and inert production-promotion proof after the
   GitHub environment exists.
3. Continue Milestone 2 identity/control-plane/tenancy proof while provider credentials are pending.
4. Pause only at the conditions listed in `AGENTS.md`; record any new blocker here first.
