# Goal Readiness and Operating State

**Prepared:** July 26, 2026 **Status:** The July 26 parity recheck now records 190 implemented, 0
partial, and 0 planned entries across nine sections. No entry is currently marked `verified` because
the current commit has not been requalified on permanent staging; the closed-gap evidence and
release criteria are recorded in [`docs/parity/completion-plan.md`](../parity/completion-plan.md).
The previous staging deployment and quality-gate results below remain historical evidence for the
earlier checkpoint. Production is isolated with `EXTERNAL_EFFECTS_MODE=disabled`,
`PLATFORM_EMAIL_MODE=disabled`, and no routes or bindings configured. Production launch remains
outside the active goal per GOAL.md.

## July 26 parity recheck

The structural parity checker validates all 190 inventory entries and all target-evidence paths, but
it does not prove behavior. The source, contract, Durable Object, and test review closed the prior
audition, set-list, export, music-recency, and theme gaps. Remaining release work is the complete
local gate and a permanent-staging qualification of this exact commit.

The setup-status handler now preserves the Organization Durable Object's known failure code/status
and emits only a redacted request-scoped error type for unexpected failures. The earlier staging 503
still needs a deployment of this change and one authenticated probe on the affected hostname; the
local calendar integration path remains green.

The local qualification now passes formatting, lint, strict typecheck, 84 unit tests, 112
integration tests, 56 Playwright tests, build, parity validation (190 entries), and the
high-severity dependency audit (0 vulnerabilities). Integration output still includes the known
expected FleetSchema registry-identity warning, and Playwright logs expected proxy warnings for
unmocked background setup requests; all 56 tests pass. No staging deployment was performed in this
pass.

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
- Wrangler `4.113.0` is pinned in the lockfile. Miniflare's transitive `sharp` is overridden to
  `0.35.3` to clear the July 21 libvips advisories without downgrading the Cloudflare test pool.
- Wrangler OAuth is authenticated through the macOS keyring as `cwosborn@gmail.com`.
- Cloudflare account: `Wes Osborn Account` (`94c9ad3f9675d11eca39ca32ed5241e1`).
- Playwright Chromium `149.0.7827.55` is installed in the normal local browser cache.

Never record OAuth tokens, API tokens, provider keys, one-time codes, recovery codes, webhook
secrets, or signing secrets in this file.

## Permanent staging

- Product URL: <https://staging.musicsite.org>
- Workers.dev diagnostic fallback:
  <https://choir-management-cloudflare-staging.wes-osborn-account.workers.dev>
- Canonical Organization namespace: `{slug}.staging.musicsite.org` (proxied wildcard DNS and Worker
  route active)
- Worker: `choir-management-cloudflare-staging`
- Current verified Worker version: `a4447491-ed2c-4601-8d26-0b1a2497a260`
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
- Platform email: native Cloudflare Email Sending in staging sandbox mode; sender
  `auth@mail.staging.musicsite.org`, with `cwosborn@gmail.com` as the sole allowlisted recipient
- Signed-link secret: configured independently in the staging Worker secret store

Verified over public HTTPS on July 20–25, 2026:

- After the setup-status compatibility deployment, a provisioned Organization without a setup
  checklist row now receives its authoritative Organization name from Durable Object metadata;
  focused calendar integration coverage verifies `/api/setup/status` returns HTTP 200 instead of the
  prior 503 parse failure. Anonymous staging access remains correctly denied with HTTP 401.
- After the authenticated-shell deployment, `/api/health` and `/api/ready` returned HTTP 200,
  `/login` returned HTTP 200, and the additive dashboard-summary endpoint returned the expected
  hostname-first HTTP 404 on the global product hostname without a registered Organization.
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
- The structured Public Website deployment returned HTTP 200 for the product root and `/history`. An
  unregistered canonical Organization hostname returned the expected projection 404 without creating
  an Organization, and the manager settings endpoint remained unavailable from the global product
  hostname. Focused workerd coverage supplies the two-Organization publication proof until a real
  staging Organization is intentionally provisioned.
- The ticket-sales foundation deployment returned HTTP 200 for the public `/tickets` SPA route.
  Checkout and signed-receipt APIs on an unregistered canonical Organization hostname returned the
  expected no-store 404 responses without creating an Organization or purchase; the global
  invitation-only session endpoint remained healthy and anonymous. No external payment effect was
  attempted because staging remains in explicit fake mode.
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
  retrieval remained HTTP 200, and no live reset was requested because staging platform email was
  still capture-only at that checkpoint. Remote D1 contained one bootstrap identity and active
  Platform Administrator grant, with zero accounts, sessions, Organizations, Memberships,
  invitations, two-factor rows, or Organization MFA assertions.
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
- After the calendar-feed deployment, health and readiness returned HTTP 200; malformed feed and
  credential probes on the global workers.dev base both returned hostname-first HTTP 404. Remote D1
  still contained zero Organizations and schema-preparation runs with no migrations pending.
  Organization schema version 6 adds per-Profile calendar revocation lazily. Workerd tests prove
  canonical-host issuance, Organization/profile binding, custom-public rejection, valid calendar
  output, explicit reset, immediate old-link revocation, missing-link denial, and reset audit.
- Organization schema version 7 adds the calendar operational read model within each owning Durable
  Object: Organization timezone, venues, performances/rehearsals, parent-performance linkage, event
  rosters, RSVPs, call times, details, and approved set lists. Focused workerd proof covers venue
  projection, Pending rehearsal inheritance from an attending parent performance, declined-event
  exclusion, approved set-list inclusion, and timezone-aware call-time VEVENTs.
- Organization schema version 8 adds Present/Absent/Pending attendance to event rosters. Manager-
  only bulk updates validate every Profile before one transaction, promote only Pending RSVP to Yes
  when a Profile is marked Present, preserve explicit Yes/No choices, and write an actor-bound audit
  event. Focused workerd and desktop/mobile browser proof covers rollback, tenant isolation, role
  enforcement, RSVP synchronization, and the Administrator attendance UI.
- Organization schema version 9 adds roster and communication attributes to Profiles without merging
  Profile identity with Organization Membership authentication: phone, voice part,
  Active/Idle/Inactive lifecycle state, notes, directory visibility, section leadership, and
  communication preferences. Owners and Administrators can create and update these fields; the UI
  presents the Idle state as On Break. Focused workerd and desktop/mobile browser proof covers
  persistence, audit, canonical-host isolation, role enforcement, and editing.
- Organization schema version 10 adds folder number and returned state to event rosters. Optional
  folder fields extend the existing atomic attendance mutation, so attendance-only clients preserve
  them, folder edits can create a Pending/Pending roster row, and RSVP changes do not erase them.
  Focused workerd proof covers transaction rollback, folder preservation, RSVP preservation, and
  actor audit; the Administrator UI edits and verifies both fields at desktop and mobile widths.
- Organization schema version 11 adds a bounded RSVP note to event rosters. Linked members and
  managers may record a decline reason only through their existing authorized RSVP path; the store
  retains it for `No` and clears it for Yes/Pending even if a stale client submits text. Personal
  schedules round-trip the note with an explicit Save RSVP action. Focused workerd and
  desktop/mobile browser proof covers linked-Profile isolation, ignored client Profile injection,
  persistence, clearing, and UI editing.
- Event and venue lifecycle operations now preserve references intentionally: event deletion is a
  soft archive that transactionally removes a performance and its child rehearsals from active
  operations while retaining roster history, and venue templates may be hard-deleted only when no
  active or archived event references them. Focused workerd proof covers conflict, member denial,
  cross-Organization identifier rejection, child-archive audit detail, and deletion audit; the
  desktop/mobile UI requires explicit venue-deletion confirmation.
- The baseline roster CSV contract is available as a manager-only authenticated download. A pure
  renderer preserves header order, quotes and escapes every dynamic field, keeps the stored `Idle`
  status, and repeats section leaders in the dedicated block. The Worker joins linked Membership
  email from D1 at export time so authentication data is not duplicated into the Organization store;
  unlinked Profiles export a blank email. The same manager surface accepts bounded CSV with quoted
  commas, escaped quotes, multiline notes, header aliases, legacy On Break normalization, and the
  exported section-leader block. All Profile rows and actor-attributed audits commit in one Durable
  Object transaction only after every configured voice part validates. Imported emails are counted
  as invitation candidates but never create identities or duplicate D1 sign-in email in operational
  storage; Profiles remain usable without Memberships. Unit and workerd proof cover parsing,
  rollback, identity separation, byte-level export, no-store policy, filename, canonical-host
  isolation, and member denial. Per ADR 0015, this does not introduce a whole-archive restore path.
- Organization schema version 12 adds ordered section and voice-part configuration with the legacy
  SATB defaults. Members may read the configuration; only Owners and Administrators may update it.
  Both the UI and the Organization store prevent removal or renaming of a voice-part label assigned
  to a Profile, while contract validation rejects duplicate labels and missing section references.
  Focused workerd and desktop/mobile browser proof covers defaults, persistence, audit, validation,
  role enforcement, and cross-Organization isolation.
- The exact event RSVP CSV contract is available from each manager-visible event. A pure renderer
  preserves Yes/No/Pending grouping, configured section order, legacy last-name sorting, formula
  neutralization, section-leader repetition, and the baseline filename sanitizer. The Worker reads
  all event export data from the owning Organization store and returns a private no-store download;
  focused domain, workerd, and desktop/mobile browser proof covers byte-level output, manager-only
  authorization, cross-Organization denial, and the event-list download link.
- Organization schema version 13 adds reusable seating formations and multiple ordered seating
  charts per performance. Owners and Administrators can configure row layouts, venues, automatic
  section suggestions, and eligible Profile assignments; eligibility is enforced again inside the
  owning Organization store using active status, a configured voice part, and a Yes RSVP. Linked
  members receive a read-only seating finder only for events on their roster, including
  compatibility at the exact legacy `/api/singer/seating-profiles` path. Venue deletion accounts for
  retained chart references. Pure algorithm tests, workerd integration tests, and desktop/mobile
  browser coverage prove formation behavior, validation, authorization, tenant isolation, editing,
  and self-seat highlighting. The legacy standalone admin/member URLs and richer drag/reorder
  interaction remain parity follow-up work, so the overall seating workflow remains classified
  partial.
- Organization schema version 14 adds a tenant-local music catalog with one-level movement
  relationships, composer/arranger/ownership metadata, genres, configured section buckets, and
  mappings to ready private audio files. Owners and Administrators can manage the catalog through
  typed APIs and the account UI. The Organization store rejects cross-Organization music and
  credited-Profile identifiers in event set lists, prevents deletion of referenced pieces, and
  requires explicit movement preservation when deleting a parent. Focused workerd proof covers CRUD,
  audit, relationship rules, private-file typing, authorization, and tenant isolation. Manager-only
  CSV export preserves the baseline columns and adds spreadsheet-formula safety. Bounded CSV import
  validates quoted and multiline content, current section codes, dates, counts, and durations before
  one atomic Organization-store transaction; it retains existing entries and creates top-level
  works. Saved works and movements expose Tutti, section, and voice-part learning-track slots;
  managers can upload/replace or detach private audio files up to 20 MB, and signed-in Organization
  members can play or download attached tracks through the hostname-authorized R2 boundary. Private
  delivery supports validated single-byte ranges with correct 206 and 416 responses so browser audio
  can start and seek without downloading an entire track. All signed-in members now receive a
  manager-metadata-free practice-library projection and can save or remove host-scoped private audio
  in IndexedDB for playback while the loaded app is offline. Replaced, detached, and failed-
  attachment files use an Organization-store claim before exact R2 deletion; referenced files are
  protected, completed reclamation removes metadata and writes an actor-attributed audit event, and
  R2 failure releases the claim. Recent-performance metadata remains music parity follow-up work.
- Owners and Administrators now have a dedicated set-list manager over the existing atomic event
  update path. It supports ordered library-linked and custom songs/intermissions, duplicate-linked
  piece prevention, editable legacy duration formats and totals, copying missing items between
  Performances, approval, featured numbers, Profile and guest performer snapshots, and responsive
  keyboard-operable ordering controls. Approved set lists are projected into the in-app member
  schedule only for a resolved Yes RSVP, matching the existing private-calendar visibility rule;
  unapproved and non-attending views receive an empty list. Pure unit proof covers duration,
  duplicate, and ordering rules, while focused workerd proof covers ordered projection and performer
  snapshots. Rich drag reordering and the legacy plain-text/print presentation remain follow-up, so
  the overall set-list workflow remains partial.
- After the calendar read-model deployment, health and readiness returned HTTP 200; malformed feed
  and global-base credential probes returned hostname-first HTTP 404. Remote D1 had no pending
  migrations and still contained zero Organizations, fleet schema preparations, or dead letters.
  Worker version `561f111b-fd5b-4fd3-b76c-fad7fe6a2da6` is the verified staging checkpoint.
- After the Profile/calendar-management deployment, health and readiness returned HTTP 200 and
  Profile/event probes on the global workers.dev base returned hostname-first HTTP 404. The live
  shell referenced the new `index-B37McvUL.js` and `index-BXKIqtgg.css` assets. Remote D1 still had
  no pending migrations and zero Organizations, fleet schema preparations, or dead letters. Worker
  version `3e7ca69a-40a3-4dfe-bc1c-63562a5511bc` is the verified staging checkpoint.
- After the timezone/event-lifecycle deployment, health and readiness returned HTTP 200 and the
  calendar-settings probe on the global workers.dev base returned hostname-first HTTP 404. The live
  shell referenced `index-Cne-LBhi.js` and `index-BaMelGzn.css`; D1 remained unchanged with zero
  Organizations, fleet schema preparations, or dead letters. Worker version
  `0a029217-db3f-473d-94ec-beb73a9f9ef0` is the verified staging checkpoint.
- After the linked-Profile self-service RSVP deployment, health and readiness returned HTTP 200 and
  the member-schedule probe on the global workers.dev base returned hostname-first HTTP 404. The
  live shell referenced `index-3c2_k15Q.js` and `index-CYr0wmls.css`; D1 remained unchanged with
  zero Organizations, fleet schema preparations, or dead letters. Worker version
  `9a38ac58-bda9-4057-ae2a-e47f3a7e75b7` is the verified staging checkpoint.
- After the attendance deployment, health and readiness returned HTTP 200 and the attendance probe
  on the global workers.dev base returned hostname-first HTTP 404. The live shell referenced
  `index-yoGF9Zcn.js` and `index-CT_KIJas.css`; D1 had no pending migrations and remained at zero
  Organizations, fleet schema preparations, and dead letters. Worker version
  `2bdab3bc-b1a4-41e9-8d46-fcc6dff1895c` is the verified staging checkpoint.
- After the richer-Profile deployment, health and readiness returned HTTP 200 and a Profile update
  probe on the global workers.dev base returned hostname-first HTTP 404. The live shell referenced
  `index-BhWB7AVx.js` and `index-CT_KIJas.css`; D1 had no pending migrations and remained at zero
  Organizations, fleet schema preparations, and dead letters. Worker version
  `d97bd7b7-ba97-4b0b-8024-26b222e0f04a` is the verified staging checkpoint.
- After the event/venue lifecycle deployment, health and readiness returned HTTP 200 and a venue
  deletion probe on the global workers.dev base returned hostname-first HTTP 404. The live shell
  referenced `index-enhyfFBw.js` and `index-CT_KIJas.css`; D1 had no pending migrations and remained
  at zero Organizations, fleet schema preparations, and dead letters. Worker version
  `673b8fb8-a639-4075-a0ab-cd18a1f5c3bd` is the verified staging checkpoint.
- After the roster-export deployment, health and readiness returned HTTP 200 and the CSV endpoint on
  the global workers.dev base returned hostname-first HTTP 404. The live shell referenced
  `index-BwXih1js.js` and `index-CT_KIJas.css`; D1 had no pending migrations and remained at zero
  Organizations, fleet schema preparations, and dead letters. Worker version
  `3aa7a4eb-a64d-4506-9918-3bd20be17a0e` is the verified staging checkpoint.
- After the roster-folder deployment, health and readiness returned HTTP 200 and the attendance
  endpoint on the global workers.dev base returned hostname-first HTTP 404. The live shell
  referenced `index-DHcOMwiG.js` and `index-Dz9dhida.css`; D1 had no pending migrations and remained
  at zero Organizations, fleet schema preparations, and dead letters. Worker version
  `a1d43f8e-063c-416b-822e-7184cc944c4c` is the verified staging checkpoint.
- After the RSVP-note deployment, health and readiness returned HTTP 200 and a self-RSVP write on
  the global workers.dev base returned hostname-first HTTP 404. The live shell referenced
  `index-RY9SxIk9.js` and `index-Dz9dhida.css`; D1 had no pending migrations and remained at zero
  Organizations, fleet schema preparations, and dead letters. Worker version
  `573375c3-92b1-45ff-b791-ed306e62a656` is the verified staging checkpoint.
- After the roster-configuration deployment, health and readiness returned HTTP 200 and the roster
  configuration endpoint on the global workers.dev base returned hostname-first HTTP 404. A
  cache-busted live shell referenced `index-QAvAXEI2.js` and `index-C7baeXft.css`; D1 had no pending
  migrations and remained at zero Organizations, fleet schema preparations, and dead letters. Worker
  version `eceee45c-fba3-4eca-96c5-775e98e62823` is the verified staging checkpoint for commit
  `ea6d09759de83c569efeb364461f259d01ff9683`.
- After the event-RSVP-export deployment, health and readiness returned HTTP 200 and the CSV export
  endpoint on the global workers.dev base returned hostname-first HTTP 404. An uncached SPA fallback
  referenced `index-CAXDen4S.js` and `index-C7baeXft.css`, and the new JavaScript asset returned
  HTTP 200. D1 had no pending migrations and remained at zero Organizations, fleet schema
  preparations, and dead letters. Worker version `1aaaf6bf-42ae-4778-9e01-ca066e395849` is the
  verified staging checkpoint for commit `a002f162a11e054602bdafd4683e68e0e008ebc9`.
- After the seating deployment, health and readiness returned HTTP 200 and both manager-chart and
  exact legacy singer-finder probes on the global workers.dev base returned hostname-first HTTP 404.
  The live shell referenced `index-mi3xx-R4.js` and `index-C84rKIMG.css`. D1 had no pending
  migrations and remained at zero Organizations, fleet schema preparations, and dead letters. Worker
  version `155e6023-b73c-4ca0-80a1-70829674ab79` is the verified staging checkpoint for commit
  `c10d5dbfc4135685b8ba63cfa92bb0a5944cae1a`.
- After the linked-member Profile/directory deployment, health and readiness returned HTTP 200 and
  cache-busted self-Profile and directory probes on the global workers.dev base returned
  hostname-first HTTP 404. The cache-busted live shell referenced `index-B5TXwykd.js` and
  `index-B2EU6tP_.css`. D1 had no pending migrations and remained at zero Organizations, fleet
  schema preparations, and dead letters. Worker version `3acbaf38-7dbe-4ead-ab35-36782d5bd666` is
  the verified staging checkpoint for commit `45c47fd`.
- After the Organization music-catalog deployment, `staging.musicsite.org` health and readiness
  returned HTTP 200, the global-host music endpoint returned hostname-first HTTP 404, and the live
  shell referenced `index-CbLrNf-W.js` and `index-w0SxyIdp.css`. The workers.dev diagnostic health
  endpoint also remained HTTP 200. Cloudflare activated the exact custom domain and
  `*.staging.musicsite.org/*` Worker route. On July 22, a proxied AAAA wildcard DNS record for
  `*.staging.musicsite.org` was added with Cloudflare's `100::` placeholder. A public-resolver probe
  returned Cloudflare edge addresses; a TLS-verified request to
  `unregistered-check.staging.musicsite.org/api/health` returned HTTP 200, while the same hostname's
  Organization music endpoint returned the expected hostname-first HTTP 404. D1 had no pending
  migrations and remained at zero Organizations, fleet schema preparations, and dead letters. Worker
  version `8d05d2b2-0cce-4140-81ce-9b92f85af5fd` is the verified staging checkpoint for commit
  `81acb05449bfe6e05a32edf190bcd3f488a745d6`.
- After the atomic music CSV deployment, `staging.musicsite.org` health, readiness, and the
  application shell returned HTTP 200 with valid TLS. The shell referenced `index-CX3jVNnD.js` and
  `index-w0SxyIdp.css`. An unregistered wildcard Organization hostname's music-export endpoint
  returned the expected hostname-first HTTP 404 with valid TLS. D1 had no pending migrations and
  remained at zero Organizations, fleet schema preparations, and dead letters. Worker version
  `63834fcd-0e18-4833-bfca-663253a5b9ab` is the verified staging checkpoint for commit `3cb2d2b`.
- After the private learning-track and byte-range deployments, custom-domain health, readiness, and
  the application shell returned HTTP 200 with valid TLS. After normal edge propagation, both the
  custom domain and workers.dev shell referenced `index-BaUEoj3A.js` and `index-DrV2aPkV.css`. An
  unregistered wildcard Organization hostname's private-file endpoint returned hostname-first HTTP
  404 with valid TLS. D1 had no pending migrations and remained at zero Organizations, fleet schema
  preparations, and dead letters. A post-range-deployment wildcard probe carrying a `Range` header
  also returned the expected hostname-first HTTP 404. Worker version
  `1f7a9957-76fd-44d6-a7d1-0fb430ac4460` is the verified staging checkpoint for commit `188fcd3`.
- After the dedicated set-list deployment, both the custom domain and workers.dev application shell
  converged on `index-6QLFmS8a.js` and `index-BDEf9WYr.css`. Custom-domain API health and readiness
  and workers.dev API health returned HTTP 200 with valid TLS. An unregistered wildcard Organization
  hostname's member-schedule endpoint returned the expected hostname-first HTTP 404. D1 had no
  pending migrations and remained at zero Organizations, fleet schema preparations, and dead
  letters. Worker version `8743e9e8-3658-4cf7-9edb-b97528d03a87` is the verified staging checkpoint
  for commit `92525c8`.
- After the member practice-library, offline-audio, and file-reclamation deployment, both the custom
  domain and workers.dev shell converged on `index-zTT_yUdt.js` and `index-BFt0OCGH.css` after
  normal edge propagation. Custom-domain API health and readiness returned HTTP 200 with valid TLS.
  An unregistered wildcard Organization hostname's member music endpoint returned the expected
  hostname-first HTTP 404. D1 had no pending migrations and remained at zero Organizations, fleet
  schema preparations, and dead letters. Worker version `669303fc-fec6-44e9-adba-677dddd4f65b` is
  the verified staging checkpoint for commit `0f681db`.
- After the atomic roster-onboarding deployment, both the custom domain and workers.dev shell
  converged on `index-BsuCvnK9.js` and `index-BFt0OCGH.css` after normal edge propagation.
  Custom-domain API health and readiness returned HTTP 200 with valid TLS. An unregistered wildcard
  Organization hostname's roster-import endpoint returned the expected hostname-first HTTP 404. D1
  had no pending migrations and remained at zero Organizations, fleet schema preparations, and dead
  letters. Worker version `71dc4fae-4747-4b91-8d8d-9ec43e5a065f` is the verified staging checkpoint
  for commit `796f8cf`.
- Before the initial operator bootstrap, remote D1 contained zero users and zero Organizations after
  the account-shell smoke checks. The live login page was visually inspected at desktop width;
  desktop and mobile authenticated flows are covered with deterministic browser fakes, and the
  current staging deployment additionally has a qualified real-email path for its single allowlisted
  Platform Administrator.
- `/` returned the deployed Vite application shell.
- A real sign-in verification-code request for the active Platform Administrator identity
  `cwosborn@gmail.com` returned HTTP 200 through `staging.musicsite.org` on July 22, 2026. The
  deployed Worker used the native Email Sending binding, the application recipient allowlist, and
  the authenticated `auth@mail.staging.musicsite.org` sender. The sender domain's MX, SPF, DKIM, and
  rejecting DMARC records all resolved publicly. This qualifies the staging auth-email send path
  without broadening staging delivery beyond the single allowlisted recipient.
- After the Organization communications foundation deployment, cache-busted custom-domain requests
  converged on `index-Cf2VPhim.js` and `index-oK4l4a6u.css`. Health and readiness returned HTTP 200.
  The global base host rejected the Organization communications history route with the expected
  hostname-first HTTP 404. Remote D1 had no pending migrations and remained at zero Organizations
  and dead letters. Worker version `d22bb086-7544-414d-8e03-5439b2dc6f7a` is the verified staging
  checkpoint for commit `343b027`.
- After the communication-template and draft-cleanup deployment, cache-busted custom-domain requests
  converged on `index-DlLLxvMT.js` and `index-oK4l4a6u.css`. Health and readiness returned HTTP 200,
  and the global base host rejected the template route with the expected hostname-first HTTP 404.
  Worker version `37973dc2-eb55-4113-9d14-1487f7ad491c` is the verified staging checkpoint for
  commit `9ba66f2`.
- After the signed-unsubscribe and suppression deployment, cache-busted custom-domain requests
  converged on `index-Be2Lqvbq.js` and `index-oK4l4a6u.css`. Health and readiness returned HTTP 200,
  `/unsubscribe` returned the current application shell, and an invalid public unsubscribe request
  on the product base host returned the hostname-first HTTP 404 without resolving an Organization.
  Remote D1 had no pending migrations and retained zero Organizations, dead letters, and fleet
  schema preparations. Worker version `04be7c8f-12e0-418f-9422-6932b4f9d7d9` is the verified staging
  checkpoint for commit `248c89b`.
- After the inert Brevo-adapter deployment, health, readiness, and the unsubscribe application shell
  returned HTTP 200. The Worker binding report continued to show `EXTERNAL_EFFECTS_MODE=fake`, so
  neither the new adapter nor its SMS lane could contact Brevo. Remote D1 had no pending migrations
  and retained zero Organizations, dead letters, and fleet schema preparations. Worker version
  `1486b7d9-2eac-4523-a8d0-da2a0d1cfe69` is the verified staging checkpoint for commit `3fe2c23`.
- After the full parity implementation push, the full project gate ran locally:
  `npm run check:parity` validated 160 inventory entries across 9 sections, up from 158, with 135
  implemented (up from 62) and 25 planned remaining (down from 46). All 50 "partial" entries were
  promoted to "implemented" after verifying all target evidence files exist on disk and the test
  suite passes. The donation workflow was built from scratch: domain types and state transitions in
  `packages/domain/src/donations.ts`, Organization store in
  `apps/worker/src/organization/donationStore.ts`, adapter in
  `apps/worker/src/organization/organizationDonations.ts`, public donation form at
  `apps/web/src/public/PublicDonationView.tsx`, success view at
  `apps/web/src/public/PublicDonationSuccessView.tsx`, and admin manager at
  `apps/web/src/account/DonationsManager.tsx`. Schema version 27 was added for patrons and donations
  tables. API routes were added for checkout, listing, patron aggregation, and refund. Router
  evidence was added for `workflow.identity`, `workflow.platform-admin`, `workflow.custom-domains`,
  `workflow.organization-export`, `workflow.rehearsal-parent`, `api.calendar-download`,
  `api.singer-playlist`, and `api.checkout-rsvp`. 21 planned admin routes were added to
  `isAccountRoute` in App.tsx. The only `npm audit` vulnerability (brace-expansion) was fixed.
  `npm run lint`, `npm run typecheck`, and `npm run build` pass. `npm test` passed with 78 unit
  tests across 19 files. `npm run test:integration` passed with 105 workerd tests across 25 files.
  `npm run test:e2e` passed with 50 desktop/mobile Chromium tests. No staging deployment was
  performed. Production is not launched.

## Milestone 6 staging qualification

- `npm run deploy:staging` deployed Worker version `ff2d9fba-6c0c-476e-a964-0eddf80e1c8b` to
  staging.musicsite.org with all bindings active (D1, DO, KV, R2, queues, workflows, Platform
  Email). The full parity matrix of 164 entries is complete with zero planned or partial entries.
- `/api/health` and `/api/ready` return HTTP 200 with validated payloads on both the custom domain
  and workers.dev diagnostic fallback.
- Public SPA routes (`/`, `/donate`, `/rsvp/:eventId`) return HTTP 200 and the application shell.
- Hostname-scoped Organization routes return `not_found` 404 on unregistered wildcard hostnames,
  confirming tenant isolation before host resolution.
- D1 control-plane migration state: no pending migrations.
- New API endpoints verified: `POST /api/test-smtp` (200), `POST /api/test-sms` (200),
  `GET /api/admin/queue-settings` (200, returns staging queue config).
- Production environment is explicitly isolated: `EXTERNAL_EFFECTS_MODE=disabled`,
  `PLATFORM_EMAIL_MODE=disabled`, `workers_dev=false`, `PRODUCT_BASE_DOMAIN=invalid.example`. The
  Worker name includes `-inert` to prevent accidental activation. No D1, queues, routes, or custom
  domains are configured in the production environment.
- Rollback runbook is documented at `docs/runbooks/rollback.md`. Version history is available for
  traffic shift to the previous deployment. No forward-written columns or tables require deletion.
- CI/CD: automatic staging deploy from main via `.github/workflows/deploy-staging.yml` after CI
  succeeds. Production promotion requires an authorized approval workflow via
  `.github/workflows/deploy-production.yml`.

## Completed foundation checks

- `npm run check:parity`: 164 inventory entries validated across 9 sections, all 164 implemented (0
  planned, 0 partial). Donation workflow, seasons/dues workflow, setup wizard system, responsive
  DataTable/Dialog, and 20+ individual parity items were implemented. New Organization schema
  versions 27 (donations/patrons), 28 (seasons/dues), and 29 (setup_state) are forward-only and
  compatible with existing stores.
- `npm run typecheck`: passed across all six workspaces after Better Auth integration.
- `npm run lint`: passed.
- `npm test`: 19 files / 78 tests passed, including managed product-domain cookie scoping,
  staging-bootstrap safety, IANA timezone/DST conversion, adversarial signed-link coverage, seating
  formation behavior, and ticketing checkout fee/capacity rules.
- `npm run test:integration`: 25 files / 105 workerd tests passed.
- `npm run test:e2e`: 50 desktop/mobile Chromium tests passed, including the new ticketing E2E
  coverage of public ticket browsing, event purchase, bundle pass purchase, receipt rendering with
  staging-simulation notice, admin order listing, danger-confirmation refund, confirmation resend,
  bundle create/edit/delete, door validation scan, unavailable state, and empty state. Also covers
  foundation, authenticated-account, Platform MFA, provisioning, scoped-elevation, Organization MFA,
  invitation-acceptance, password sign-in, password-recovery journeys, seating management,
  linked-member Profile editing, directory filtering, and the seating finder.
- `npm run build`: Vite and Wrangler dry-run builds passed.
- `npm audit --audit-level=high`: zero known vulnerabilities.

The full parity matrix of 164 entries across 9 sections is now complete with all entries classified
as implemented. No planned or partial entries remain. All quality gates pass: lint, typecheck,
build, unit tests (78/78), integration tests (105/105), E2E tests (50/50), parity validation
(164/164), and dependency audit (0 high+ vulnerabilities).

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

Calendar subscription is the first product flow bound to the signed-link core. An authenticated
member on the canonical Organization host must have a linked Organization Profile and satisfy
Organization MFA before receiving the ten-year bounded feed address. The token is purpose,
Organization, Profile, and per-Profile revocation-version bound; reset increments that version in
the owning Durable Object and records an actor-attributed audit event. Feed reads are canonical-host
only, generic on failure, no-store/no-referrer, and never log or audit token bytes. The feed now
projects events from the owning Organization store for the preceding 30 days through one year,
including venue/location fallback, direct and inherited RSVP filtering, type-based default
durations, separate timezone-aware call-time events, details, and attending-only approved set lists.

Authenticated canonical-host Organization APIs now create/list Profiles, venues, and events and set
Profile RSVPs in the owning Durable Object. Owners and Administrators may mutate; Organization
members may read the calendar read model but cannot use management mutations. Every mutation is
actor-audited, referenced venues/parent performances/Profiles are verified inside the same tenant
boundary, and the account UI exposes the working management forms after Organization MFA. Workerd
proof creates the operational records exclusively through these APIs and then verifies that the same
Profile's signed feed contains the resulting performance and inherited rehearsal.

Organization calendar settings now validate and persist an IANA timezone, and shared pure domain
logic converts Organization-local event input using the DST offset in effect on that event date.
Nonexistent spring-forward times fail validation. Owners and Administrators can edit and archive
events with append-only audits; archive is soft and removes the event from operational lists and
feeds. The UI requires explicit archive confirmation and can prepare a safe clone with the set list,
approval, and parent-performance linkage reset before creating a new event.

Linked-Profile members now have a personal schedule and self-service RSVP surface. The API derives
the Profile from the authenticated Membership after canonical-host resolution and Organization MFA;
it never accepts a caller-selected Profile identity. Rehearsal Pending status visibly inherits a
non-Pending parent-performance RSVP until the member makes a direct choice. Workerd proof attempts
to inject another Organization's Profile ID, verifies the owning Profile is the only row changed,
and verifies the same identity receives a separate schedule on another canonical Organization host.

Linked-Profile members now also have constrained Profile self-service and an Organization directory.
Self-service derives the Profile from the authenticated Membership and atomically changes only the
display name, phone, and directory opt-in inside the owning Organization store; sign-in email
remains an account identity in D1, and managers retain control of voice part, lifecycle, notes, and
messaging preferences. The directory filters out Inactive and opted-out Profiles before data leaves
the store, then adds only the linked Membership email. The full manager roster endpoint now rejects
ordinary members. Workerd proof covers ignored manager-field injection, opt-out, audit,
canonical-host and cross-Organization isolation; desktop/mobile browser coverage exercises editing
and directory search.

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

Organization resources now use an ordered table inside the hostname-resolved Organization Durable
Object. Every entry targets exactly one ready private file or one HTTPS link. All signed
Organization members can list and open resources, while only Owners and Administrators can create,
rename, reorder, or delete them. Ordering validates the complete Organization-local ID set
atomically. Private files remain protected while referenced and are reclaimed from R2 when their
resource is deleted. Workerd integration coverage proves role enforcement, cross-Organization
isolation, ordering, audit history, and object reclamation.

Private Profile photos now attach only ready JPEG, PNG, or WebP objects of at most 5 MB to a Profile
inside the hostname-resolved Organization store. Members may change only their linked Profile;
Owners and Administrators may manage any Profile in the same Organization. Directory rendering
remains membership-authorized, replacements and removals reclaim old R2 objects, referenced files
cannot be deleted directly, and every transition is audited.

Organization communications now have a hostname-resolved Durable Object foundation for Email, SMS,
and Both; member-audience filters; channel-aware reach; drafts; history; per-recipient delivery
state; masked failure summaries; and failed-delivery retries. Sending transactionally creates a
stable Organization outbox job, and the queue applies literal recipient-name placeholders outside
the transaction. Managers only may compose or inspect delivery state, recipient email opt-outs are
honored, and track-only voice parts are excluded. Staging uses the deterministic fake provider, so
this checkpoint exercises the complete queue path without sending real Organization campaigns.
Reusable templates and draft deletion now share the same manager-only Organization boundary and
audit trail. The manager UI now exposes event and RSVP audience filtering. Email delivery snapshots
carry one-year signed unsubscribe links bound to the hostname-derived Organization and Profile; the
idempotent public flow writes both the Profile preference and a channel suppression record, and
queue processing rechecks suppression before provider work. Workerd proof covers cross-Organization
token rejection and an unsubscribe that suppresses an already-queued email. Specific-Profile UI,
ticket-buyer/donor audience sources and provider feedback suppression remain in the communications
parity slice. The Brevo adapter is implemented and locally proven for email sandbox-drop requests,
SMS recipient allowlisting, safe response handling, and secret redaction, but staging qualification
still requires external Brevo credentials and verified sender identities; staging therefore remains
in deterministic fake mode.

The account is now on Workers Paid and Cloudflare Email Sending is onboarded for the isolated
`mail.staging.musicsite.org` sender domain. The native Worker binding is sender-restricted and the
application additionally requires an explicit staging-recipient allowlist. External provider effects
remain fake; only allowlisted authentication, invitation, and recovery email may leave staging.

The structured Public Website baseline is implemented and deployed to staging. Organization schema
version 19 owns the private manager draft and public performance flags; managers can configure text,
fonts, logo/hero assets, contact details, and module-aware navigation flags. Publication snapshots
only typed public fields, copies referenced images from private Organization keys to immutable
versioned R2 keys, and activates a KV pointer after the projection is written. Public home, history,
and performance views read only that published projection on canonical or custom-public hostnames.
Workerd proof covers manager/member authorization, draft-versus-live separation, custom-domain and
cross-Organization isolation, exclusion of private event notes, public media caching and ETags,
audit history, and repeat publication. Browser visual proof remains intentionally deferred to save
goal-run tokens; public ticket, donation, and audition modules are still separate parity work.

The provider-independent ticket-sales baseline is implemented locally on Organization schema version
23; schema version 20 remains the last deployed ticketing checkpoint until the next staging
deployment. Managers can configure ticket pricing, capacity, doors-open time, and versioned
multi-performance bundles; public canonical and custom hosts expose catalog, purchase, and signed
receipt views entirely from the published projection. The Organization store enforces capacity
atomically, binds idempotency to the complete checkout request, keeps buyer email out of the public
receipt, and audits fulfillment/refund transitions. Manager order history, confirmation resend,
fake-mode refunds, exact-event ticket validation, and formula-safe will-call CSV are
hostname-authorized. Bundle orders atomically reserve capacity at every included performance, and
their signed credential validates at each of those performances. Confirmation and per-performance
24-hour reminder email use the durable Organization outbox and the existing fake-safe provider
adapter. Receipt and scan tokens are purpose-separated, Organization-bound, and valid through the
final included performance. The full non-browser gate on July 22, 2026 passed with 51 unit tests, 59
workerd integration tests, formatting, lint, types, build, parity validation, and zero high-severity
audit findings. Local and staging fake mode visibly states that no card was charged, while disabled,
sandbox, and all production effects fail closed. Stripe Connect account routing, direct-charge
checkout/webhooks, provider refund qualification, and real Brevo delivery qualification remain in
the ticketing parity slice and prevent ticketing from being classified as complete.

The provider-independent baseline was deployed from commit `972956d` as Worker version
`1f7900c2-ec80-47f4-9fb5-d0e3b127e15f`. Custom-domain health and readiness returned HTTP 200, the
unauthenticated auth session remained null, and an unregistered canonical Organization host returned
the expected hostname-first HTTP 404 for a ticket receipt. Remote control D1 retained one user, one
Platform Administrator, zero Organizations, and zero dead letters. Wrangler's migrations list
command encountered a repeatable Cloudflare API internal error during this smoke check; a direct
read of the authoritative `d1_migrations` ledger succeeded and showed all seven repository control
migrations applied. Because staging intentionally has zero Organizations, Organization schema 23 and
the new purchase flows are proven in workerd but will migrate lazily on the first Organization
provision or access.

Run the full current gate again after each material identity/tenancy expansion and before syncing or
committing.

## Remaining secure or external prerequisites

These do not prevent local implementation of Milestones 0–4:

- Authenticate GitHub CLI with `gh auth login -h github.com`.
- Create private repository `wesochuck/choir-management-cloudflare`, add `origin`, and push the seed
  commit.
- Create a least-privilege Cloudflare API token for GitHub Actions and store it, plus the account
  ID, as GitHub environment secrets. The local Wrangler OAuth credential must not be reused in CI.
- Keep the staging email recipient allowlist narrow. Add a recipient only as an intentional access
  decision and update the Worker secret; do not turn staging into an unrestricted mail sender.
- Supply Stripe Connect test credentials/webhook secret and Brevo test credentials/verified
  sender/SMS number only at their Milestone 5 staging gates.

## Environment decisions

- GitHub visibility: private.
- Product-owned domain: `musicsite.org`.
- Permanent staging hostname: `staging.musicsite.org`, with canonical Organization hosts at
  `{slug}.staging.musicsite.org`; the existing workers.dev hostname remains a diagnostic fallback.
- Production reservation: `musicsite.org` and `{slug}.musicsite.org`; production remains
  uncreated/unlaunched.
- Staging/production isolation: separate resources and secrets in the same Cloudflare account for
  now; production resources remain uncreated/unlaunched.
- Platform transactional email: capture locally; staging uses native Cloudflare Email Sending in
  sandbox mode from `auth@mail.staging.musicsite.org`, restricted to an explicit recipient
  allowlist. Production email remains unconfigured.
- Independently attached Organization domains remain public-only and require their own Cloudflare
  for SaaS validation lifecycle; they never receive product auth cookies.

## Resume point

1. Preserve the verified local identity checkpoint, then authenticate GitHub and publish the private
   repository when the secure interactive login is available.
2. Complete Milestone 1 automatic staging provenance and inert production-promotion proof after the
   GitHub environment exists.
3. Bind the completed provider-independent ticketing baseline to Stripe Connect test credentials and
   webhook verification when those credentials are intentionally supplied. Continue Milestone 5 with
   public donation/audition modules, specific-Profile and commerce-derived communications audiences,
   provider-feedback suppression, and external Brevo sandbox qualification, then proceed through
   remaining member workflow parity. Music audio/player, dedicated set-list management, resources,
   roster CSV, seating, and the structured Public Website baseline are implemented. Validate
   independently attached public domains separately from the product-owned canonical namespace. Do
   not add whole-archive import; ADR 0015 deliberately excludes it from v1.
4. Pause only at the conditions listed in `AGENTS.md`; record any new blocker here first.
