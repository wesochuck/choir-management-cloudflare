# Goal Readiness and Operating State

**Prepared:** July 21, 2026 **Status:** Active; Milestone 0 parity capture is complete, Milestone 1
is complete except for GitHub-hosted provenance/promotion proof, and the Milestone 2 identity,
tenant-boundary, provisioning, scoped-elevation, Public Website Domain registration, and browser
OTP/session/MFA/password-recovery/Platform-operations core is deployed to permanent staging. The
Milestone 3 queue retry/idempotency/isolation foundation is now in progress. Production is not
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
- Current verified Worker version: `e7402804-b514-4c0d-913f-84f65f855d71`
- D1: `choir-management-control-staging` (`9f543949-192f-49a7-aa59-7cf589b4a62f`), migration
  `0001_initial.sql` through `0007_fleet_schema.sql` applied; no migrations pending
- Durable Object: declarative SQLite export `OrganizationStore`
- R2: `choir-management-staging`
- KV: `choir-management-routing-staging` (`9c7f20b2c8024b1b98d17a682c70cf97`)
- Queue: `choir-management-jobs-staging`
- Dead-letter queue: `choir-management-jobs-dlq-staging`
- Workflow: `choir-management-provisioning-staging`
- Fleet schema Workflow: `choir-management-fleet-schema-staging`
- External effects: `fake`
- Platform email: `capture`
- Signed-link secret: configured independently in the staging Worker secret store

Verified over public HTTPS on July 20–21, 2026:

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
- `/login` returned the deployed invitation-only OTP interface. Anonymous session retrieval returned
  HTTP 200 with `null`, while `/api/account/organizations` returned HTTP 401 without a session.
- `/api/platform/mfa/status` and `/api/platform/mfa/confirm-enrollment` returned HTTP 401 without a
  session after the MFA account deployment. The first status probe briefly reached the prior Worker
  during edge propagation; a cache-busting retry reached the verified current version.
- `/api/account/security` and `/api/account/password` returned HTTP 401 without a session after the
  account-password deployment. Remote D1 still contained no account or password rows, so the smoke
  requests did not mutate the bootstrapped identity.
- `/api/platform/context` and both GET/POST forms of `/api/platform/organizations` returned HTTP 401
  without a session after the Platform operations deployment. Remote D1 still contained zero
  Organizations and zero scoped elevations, so the smoke requests had no control-plane side effects.
- `/api/organization/auth-status`, `/api/organization/auth-policy`, and
  `/api/organization/mfa/verify` returned HTTP 404 on the global workers.dev base after the
  Organization MFA browser deployment, proving hostname resolution precedes policy or factor work.
  Remote D1 still contained zero Organization MFA assertions and zero two-factor rows.
- `/accept-invitation` returned the deployed application shell. Native invitation detail and accept
  endpoints returned HTTP 401 anonymously, invitation creation returned HTTP 404 on the global base
  host, and public email/password registration remained HTTP 404. Remote D1 still contained zero
  invitations, Memberships, Organizations, and sessions.
- `/login`, `/forgot-password`, and `/reset-password` returned HTTP 200 and rendered their expected
  deployed browser views; the tokenless reset route showed only the safe invalid/expired-link state.
  A synthetic fragment token was removed from the live browser URL while the reset form retained it
  in memory; it was not submitted. Health and readiness remained HTTP 200, anonymous session
  retrieval remained HTTP 200, and no live reset was requested because staging platform email is
  capture-only. Remote D1 still contained one bootstrap identity and active Platform Administrator
  grant, with zero accounts, sessions, Organizations, Memberships, invitations, two-factor rows, or
  Organization MFA assertions.
- After the invitation-lifecycle deployment, health and readiness returned HTTP 200. A browser-
  shaped request to Better Auth's native Organization invitation endpoint returned the application's
  generic HTTP 404, proving browser callers cannot supply an Organization ID around the hostname-
  bound wrapper. The custom invitation list returned HTTP 404 on the global workers.dev base before
  session or invitation processing. Remote D1 retained zero invitations, Memberships, Organizations,
  and sessions, and migrations `0001` through `0005` remained fully applied with none pending.
- After the queue-retry deployment, health and readiness again returned HTTP 200. The forward-only
  Organization schema registry now adds version 3's nullable job-failure timestamp lazily when an
  Organization store is next opened; old Worker code safely ignores the additive column. No live
  synthetic queue message was sent because staging has no Organization records, while real workerd
  queue/SQLite binding tests prove failed-attempt recording, higher-attempt reclamation, terminal
  completion, duplicate acknowledgment, malformed-message acknowledgment, and isolation of the same
  idempotency key across two Organization stores. Remote D1 remained unchanged with no migrations
  pending.
- After the dead-letter-visibility deployment, health and readiness returned HTTP 200, the new D1
  table was empty, staging still contained zero Organizations, and the unauthenticated Platform
  endpoint returned HTTP 401. The deployed Worker is now the active consumer for both the main jobs
  queue and its dead-letter queue. Workerd tests prove idempotent metadata capture without a payload
  or body column; the browser/API surface requires the product base hostname, an active Platform
  Administrator grant, and recent session-specific MFA.
- After the published-projection deployment, health and readiness returned HTTP 200 and the global
  workers.dev base returned the hostname-first HTTP 404 from `/api/public/projection` after edge
  propagation. Remote D1 still contained zero Organizations and domains, so staging had no
  Organization projection to publish or fetch. Workerd tests use the real KV, R2, and D1 bindings to
  prove canonical/custom-public reads, immutable version retention, conditional ETags, and rejection
  of both a cross-Organization KV-key substitution and a mismatched R2 body under the expected key.
- After the private-file deployment, health returned HTTP 200 and both upload and download probes on
  the generic workers.dev base returned hostname-first HTTP 404. The rejected upload did not create
  an Organization or invoke an Organization store. Organization schema version 4 will add its
  private-file metadata table lazily when a provisioned store is opened. Workerd tests prove member
  authorization, canonical-host-only access, ignored client Organization-ID substitution, custom-
  public-host rejection, per-Organization R2 prefixes, metadata/R2 agreement, and actor-attributed
  upload audit. Cross-Organization file IDs and deliberately poisoned metadata keys fail closed
  without returning the other Organization's bytes.
- After the Organization-scheduler deployment, health and readiness returned HTTP 200 and remote D1
  remained Organization-empty. No live alarm was manufactured because staging has no provisioned
  Organization store. Organization schema version 5 will add its stable scheduled-job outbox lazily
  on first store access. Workerd alarm tests prove provisioning schedules the alarm, one due
  interval creates a bounded stable job, and an uncertain enqueue acknowledgment resends the same
  job ID and Organization-scoped idempotency key instead of creating another logical job.
- The independent signed-link secret was streamed directly into the staging Worker secret store and
  was never written to a repository file or command output. After deployment, health and readiness
  returned HTTP 200, proving the required startup binding is present. Focused unit tests cover
  tampering, truncation, oversized inputs, expiry, future issuance, and Organization, purpose,
  subject, resource, and revocation-version mismatches.
- After the fleet-schema deployment, health and readiness returned HTTP 200, the recent-MFA Platform
  endpoint returned HTTP 401 anonymously after edge propagation, and D1 had no pending migrations,
  Organizations, or schema-preparation runs. Staging now has a separate fleet schema Workflow
  binding. Workerd tests prepare 21 stale Organization stores as bounded 20+1 chained instances,
  verify each Durable Object identity before advancing D1, and mark a mismatched registry/store run
  failed so another run is not permanently blocked.
- Before the initial operator bootstrap, remote D1 contained zero users and zero Organizations after
  the account-shell smoke checks. The live login page was visually inspected at desktop width;
  desktop and mobile authenticated flows are covered with deterministic browser fakes because
  staging email remains capture-only.
- `/` returned the deployed Vite application shell.

## Completed foundation checks

- `npm run check:parity`: 145 inventory entries validated.
- `npm run typecheck`: passed across all six workspaces after Better Auth integration.
- `npm run lint`: passed.
- `npm test`: 5 files / 13 tests passed, including staging-bootstrap safety and adversarial
  signed-link coverage.
- `npm run test:integration`: 7 files / 37 workerd tests passed.
- `npm run test:e2e`: 16 desktop/mobile Chromium foundation, authenticated-account, Platform MFA,
  provisioning, scoped-elevation, Organization MFA, invitation-acceptance, password sign-in, and
  password-recovery journeys passed.
- `npm run build`: Vite and Wrangler dry-run builds passed.
- `npm audit --audit-level=high`: zero known vulnerabilities.

The current identity proof uses Better Auth `1.6.23` directly against D1. It covers no public
registration, invitation-created pending identities, hashed email OTP storage and sign-in, optional
password support, non-enumerating single-use password recovery with session revocation, password
sign-in with native TOTP or recovery-code challenge completion, session
retrieval/listing/revocation, multi-Organization selection without tenant selection,
TOTP/recovery-code enrollment, mandatory recent session-specific MFA for Platform Administrators,
revoked Platform Administrator denial, stale invitation denial, client Organization-ID alteration,
cross-membership denial, and D1 confirmation of poisoned KV route hints. It also covers completed
Organization provisioning Workflows and session-bound, Organization-scoped Platform edit elevation,
cross-Organization denial, explicit revocation, and actor attribution. Optional Organization MFA is
Owner-controlled and its 12-hour assertions are bound to the exact Organization, user, and session;
email OTP alone does not satisfy it. Capture-mode platform email is bounded and in-memory; codes and
recovery values are never logged or persisted by the capture adapter.

Queue consumers now replace the producer's attempt hint with Cloudflare's trusted delivery-attempt
counter, claim work only in the Organization store named by the validated job envelope, and persist
failed state before requesting a bounded exponential-backoff retry. A later attempt can reclaim a
failed or interrupted claim, while completed work and same-attempt duplicates are acknowledged
without another external effect. Completion and failure transitions match the job ID, idempotency
key, and attempt. The same idempotency key is intentionally independent in another Organization's
Durable Object. Sandbox provider effects remain unconfigured and staging continues in fake mode.
Messages that exhaust the main queue retry policy now enter a separately consumed dead-letter queue.
Its consumer writes only bounded operational identifiers and timestamps to D1, upserts repeated
observations idempotently, and acknowledges only after persistence. Platform Administrators can see
the most recent records without exposing or copying Organization message payloads into the control
plane.

Public projection publication validates a one-megabyte boundary, writes immutable versioned JSON
only beneath `organizations/{organizationId}/published/`, and advances the KV pointer only after R2
succeeds. Public reads first resolve and confirm the request hostname from authoritative D1, then
require the pointer Organization ID, exact derived key, version, and stored projection Organization
ID/version to agree. Poisoned KV and R2 values fail closed with a generic 404. Successful reads are
short-cacheable by host and ETag and do not invoke the Organization Durable Object.

Private file uploads require a validated UUID, encoded safe display name, explicit content type,
matching content length, a ten-megabyte limit, and an active hostname-derived Organization
Membership (including Organization MFA when policy requires it). The owning Organization store
reserves metadata before R2 is written and atomically marks it ready with an append-only audit
event; failed finalization removes both the new object and its pending reservation. Downloads derive
the R2 key from the authoritative hostname Organization plus file ID, require ready metadata in that
exact Organization store, and verify stored size and R2 Organization/file metadata before streaming.
Custom public hosts and client-supplied Organization IDs cannot select private storage.

Each provisioned Organization store now owns a daily alarm and a bounded ten-job SQLite outbox. A
due alarm transactionally creates one stable stale-checkout-cleanup envelope and advances the next
due time before enqueueing; it never calls a provider inside the transaction. Queue failure leaves
the row pending and schedules a one-minute retry. A crash after enqueue but before marking the row
replays the same job ID/idempotency key, which the owning Organization's consumer ledger
deduplicates. The actual stale-checkout domain behavior remains intentionally partial until the
ticketing parity wave.

The signed-link core now issues bounded version-1 HS256 envelopes with Organization and purpose
binding, optional exact subject/resource/revocation matching, purpose-separated derived keys, and a
fixed 32-byte signature comparison. Product routes will bind this core to their own authoritative
resource and revocation checks as each signed public flow is implemented; no product flow is marked
complete merely because the shared cryptographic foundation exists.

Recent-MFA Platform Administrators on the product base hostname can now start and inspect one fleet
schema-preparation run at a time. Each Workflow instance loads at most 20 stale active
Organizations, asks the exact named Durable Object to verify its stored Organization identity and
applied schema, then advances D1 and idempotently creates one continuation. Deterministic identity
conflicts fail closed without retry churn; transient step failures retain Workflow retries.
Completion and failure both release the single-running-run constraint, and run-level
start/completion events are audited.

Membership-to-Profile linkage stores only the Profile ID in D1 after confirming the Profile exists
inside the hostname-resolved Organization Durable Object. The linkage is unique within that
Organization and actor-attributed; a Profile in another Organization store is rejected.

Organization Owners may register normalized Public Website Domains as pending D1 routing records
from their canonical product hostname. Registration rejects IP literals, invalid DNS hostnames, the
product namespace, and cross-Organization duplicates. Disabling a domain increments its routing
version, records the actor, and removes its KV hint. A custom public hostname never exposes auth or
Organization administration routes. Domain activation remains intentionally absent until a managed
Cloudflare zone enables validated custom-hostname lifecycle work.

The deployed browser shell now provides non-enumerating invitation-only email-code sign-in, safe
session listing/revocation, sign-out, and a D1 membership-derived Organization chooser. Client
Organization IDs cannot influence this list, Better Auth session tokens are never rendered or
persisted by the page, and account routes are unavailable on custom public hosts. `workers.dev`
sessions intentionally remain host-only; cross-subdomain cookies must not be enabled until a managed
product domain is selected and explicitly reviewed.

The account shell now detects the signed-in user's own Platform Administrator grant, supports new or
interrupted TOTP enrollment, regenerates recovery codes when necessary, requires explicit recovery-
code acknowledgment, and opens only a 15-minute factor-bound Platform session. Enrollment secrets
and recovery codes remain in React memory only and disappear from the page after confirmation. If
the user has added a password, Better Auth requires that current password before enrollment or
recovery-code replacement; OTP-only identities may leave the field blank.

Signed-in users may optionally add or change only their own password from the account shell. Better
Auth performs hashing and current-password verification; plaintext passwords are never returned or
logged, and no administrator-assigned-password surface exists. Email code remains the primary
sign-in method. Password sign-in completes Better Auth's second-factor challenge for MFA-enabled
accounts. Recovery requests return the same result for known and unknown email addresses; links are
single-use, expire after 30 minutes, keep the token in a browser fragment that is removed into React
memory before rendering, and revoke every existing session after a successful reset.

After recent Platform Administrator MFA, the product base host now exposes a bounded, cursor-
paginated Organization metadata directory and audited provisioning form. A canonical Organization
host instead exposes the hostname-derived scope as read-only and allows a reasoned 15-minute edit
elevation with explicit revocation. The browser never sends an Organization ID to select either the
directory or the scoped elevation, and workers.dev canonical hostnames remain visibly pending.

On a canonical Organization host, a signed member can now see only that hostname-derived
Organization's authentication policy, enroll an authenticator while retaining recovery codes, and
create a 12-hour assertion bound to the Organization, identity, and current session. Owners alone
can enable the policy; disabling it requires a valid current Organization assertion plus a visible
browser confirmation with Cancel. The status bootstrap endpoint does not expose operational data or
bypass MFA on protected Organization routes.

Organization Owners and Administrators now have a hostname-scoped invitation form; only Owners may
select the Owner role, and an active Organization MFA policy blocks creation until the current
session is verified. Pending invitations are listed only for the hostname-derived Organization and
can be canceled with visible confirmation; Administrators cannot cancel an Owner invitation.
Invitation email links return to `/accept-invitation`; an anonymous recipient signs in by email
code, and Better Auth reveals details, accepts, or rejects only after matching the verified session
email, pending state, expiry, inviter membership, membership limit, and hostname-derived
Organization. All native Better Auth Organization HTTP endpoints except read-only membership listing
and active- Organization selection are hidden from browser callers, while internal typed API calls
remain available to the wrappers. Create, cancel, accept, and reject transitions are
actor-attributed in the Platform audit log. A failed pending-identity write compensates by canceling
the just-created invitation. Stale, cross-host, native-bypass, and wrong-recipient cases are covered
in workerd.

The first staging Platform Administrator identity is now provisioned through the production-refusing
`npm run bootstrap:staging-platform-admin` operator command. Its second identical invocation wrote
zero rows. Remote D1 verification found exactly one user, one active Platform Administrator grant,
one bootstrap audit event, one pending MFA enrollment, zero sessions, and zero Organizations. The
identity email is stored in D1 and is intentionally not repeated in this handoff. No password, OTP,
session, TOTP secret, or recovery code was created by bootstrap.

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
- Record allowlisted staging recipients before platform-email qualification. The initial Platform
  Administrator identity is already provisioned in D1 but cannot enroll until email delivery works.
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
3. Continue Milestone 3 by binding the signed-link core to calendar-feed revocation and the first
   concrete product flows. Return to validated custom-domain activation when a managed zone is
   available.
4. Pause only at the conditions listed in `AGENTS.md`; record any new blocker here first.
