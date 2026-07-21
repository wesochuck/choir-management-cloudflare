# Goal Readiness and Operating State

**Prepared:** July 20, 2026 **Status:** Active; Milestone 0 parity capture is complete, Milestone 1
is complete except for GitHub-hosted provenance/promotion proof, and the Milestone 2 identity,
tenant-boundary, provisioning, scoped-elevation, and Public Website Domain registration core is
deployed to permanent staging. Production is not launched.

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
- Current verified Worker version: `79559921-2881-40dd-bdab-3b7fbab5851d`
- D1: `choir-management-control-staging` (`9f543949-192f-49a7-aa59-7cf589b4a62f`), migration
  `0001_initial.sql` through `0005_profile_link.sql` applied; no migrations pending
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
- `/api/auth/get-session` returned HTTP 200 with no session, proving the request-scoped Better Auth
  handler can initialize against remote D1 and the stored Worker secret.
- `/api/auth/sign-up/email` returned HTTP 404, proving public email/password registration remains
  disabled in staging.
- Anonymous `/api/platform/context` and `/api/platform/organizations` requests were denied. The
  Organization provisioning smoke request created no D1 Organization row.
- Organization-scoped Platform context/elevation routes rejected the global workers.dev base host,
  as required before a registered canonical Organization hostname exists.
- Organization MFA policy/verification routes rejected the global workers.dev base host, and the
  scoped assertion table was verified in remote D1 without creating an Organization.
- The Membership-to-Profile route rejected the global base host, and remote D1 confirmed the unique
  Organization/Profile linkage index without creating an Organization.
- Public Website Domain registration rejected the global workers.dev base host because no canonical
  Organization hostname was present. Remote D1 still contained zero Organizations, and no D1
  migrations were pending after the deployment.
- `/` returned the deployed Vite application shell.

## Completed foundation checks

- `npm run check:parity`: 145 inventory entries validated.
- `npm run typecheck`: passed across all six workspaces after Better Auth integration.
- `npm run lint`: passed.
- `npm test`: 3 files / 8 tests passed.
- `npm run test:integration`: 2 files / 20 workerd tests passed.
- `npm run test:e2e`: desktop and mobile Chromium smoke tests passed.
- `npm run build`: Vite and Wrangler dry-run builds passed.
- `npm audit --audit-level=high`: zero known vulnerabilities.

The current identity proof uses Better Auth `1.6.23` directly against D1. It covers no public
registration, invitation-created pending identities, hashed email OTP storage and sign-in, optional
password support, session retrieval/listing/revocation, multi-Organization selection without tenant
selection, TOTP/recovery-code enrollment, mandatory recent session-specific MFA for Platform
Administrators, revoked Platform Administrator denial, stale invitation denial, client
Organization-ID alteration, cross-membership denial, and D1 confirmation of poisoned KV route hints.
It also covers completed Organization provisioning Workflows and session-bound, Organization-scoped
Platform edit elevation, cross-Organization denial, explicit revocation, and actor attribution.
Optional Organization MFA is Owner-controlled and its 12-hour assertions are bound to the exact
Organization, user, and session; email OTP alone does not satisfy it. Capture-mode platform email is
bounded and in-memory; codes and recovery values are never logged or persisted by the capture
adapter.

Membership-to-Profile linkage stores only the Profile ID in D1 after confirming the Profile exists
inside the hostname-resolved Organization Durable Object. The linkage is unique within that
Organization and actor-attributed; a Profile in another Organization store is rejected.

Organization Owners may register normalized Public Website Domains as pending D1 routing records
from their canonical product hostname. Registration rejects IP literals, invalid DNS hostnames, the
product namespace, and cross-Organization duplicates. Disabling a domain increments its routing
version, records the actor, and removes its KV hint. A custom public hostname never exposes auth or
Organization administration routes. Domain activation remains intentionally absent until a managed
Cloudflare zone enables validated custom-hostname lifecycle work.

The authentication handler is available on the exact product base hostname. Organization subdomains
must also be registered as active canonical domains in D1; merely matching the product domain suffix
is insufficient.

Run the full current gate again after each material identity/tenancy expansion and before syncing or
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

1. Preserve the verified local identity checkpoint, then authenticate GitHub and publish the private
   repository when the secure interactive login is available.
2. Complete Milestone 1 automatic staging provenance and inert production-promotion proof after the
   GitHub environment exists.
3. Continue Milestone 2 with Platform/session management UI, validated custom-domain activation, and
   the remaining cross-resource isolation probes while provider credentials are pending.
4. Pause only at the conditions listed in `AGENTS.md`; record any new blocker here first.
