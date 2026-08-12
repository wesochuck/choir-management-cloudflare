# Permanent staging qualification evidence — August 11, 2026

This record covers the current permanent staging deployment only. It does not authorize or describe
a production launch.

## Current exact-release follow-up — August 12, 2026

The local staging release for source commit `1a72f961c8422ed242adac98189de820fee52226`
(`Allow staging auth email delivery to verified recipient`) was promoted as Worker version
`47098ef8-a24b-4cd4-b1fc-78932fb506a6` in deployment `b83ced77-fc30-46ed-bc01-575994f4001e` at 100%
traffic. The exact release passed all 13 local CI-mirror steps, 193 Workerd integration tests, and
94 Chromium E2E tests.
`STAGING_EXPECTED_VERSION=1a72f961c8422ed242adac98189de820fee52226 npm run qualify:staging` passed
all four direct Worker health/readiness probes both during promotion and on a fresh follow-up.

The release also passed the anonymous staging boundary sweep: 148 safe requests across both seeded
Organization hosts with statuses 200=3, 400=28, 401=112, 404=4, and 503=1. No D1 migration was
pending, version-external triggers were synchronized, and the prior Worker version
`e0348b56-3791-460a-bb5b-32828f7ae519` remains the rollback target. This confirms the deployment
path and exact runtime, but does not promote any of the remaining authenticated or provider-gated
parity entries.

Using the authenticated Organization Admin session against the same release, the LCC Roster surface
filtered the 94-profile roster to exactly 12 Alto 2 profiles when the `A2 12` balance control was
selected. The profile editor exposed organization-scoped profile fields, status management,
performance RSVPs, dues, folder numbers, and messages without leaving the dialog. The roster CSV
import dialog exposed its format guidance and kept import disabled until a file was selected. The
filter and dialogs were closed without saving, importing, or changing staging data. These are
authenticated UI observations and do not promote the complete `workflow.roster` entry, which still
requires the full CRUD/import/export/directory success and failure evidence.

The authenticated LCC member Schedule surface showed separate Yes and No RSVP buttons, the current
No state, the decline-note field, and a signed HTTPS calendar address with a separate reset control.
No RSVP save or calendar reset was activated. This confirms the current member UI shape but does not
promote `api.calendar-feed-reset` or the full `workflow.rsvp-attendance` entry.

A fresh targeted local Workerd run of `calendarManagement.integration.test.ts` passed the large
Organization summary case: 5,000 active Profiles and 500 upcoming events returned exact counts and
five bounded next events within the one-second assertion. This remains local scale evidence; the
deployed 100,000-record and 250-concurrent-request envelope is still open.

Read-only Wrangler checks against the current staging account confirmed the exact deployment at 100%
traffic, four staging queues with one active consumer each (and the jobs queue with one producer),
both registered staging Workflows, the `choir-management-staging` R2 bucket, and no pending remote
D1 migrations. The staging Email Sending feedback subscription remains enabled for all six delivery
feedback events and targets the staging email-events queue. These checks confirm resource liveness
and configuration only; queue replay, Workflow execution, provider delivery, and dead-letter
behavior remain unverified.

The user then entered a fresh Platform Administrator TOTP in the visible staging Security page. The
page reported `Platform access is ready` for the bounded 15-minute session. Read-only Platform
overview checks showed build `6c60a3990e25a53548ca3133329a1461c23be5ff`, two Organizations, the
configured startup/control-plane/MFA/sandbox-email checks, Organization schema version 68 with
preparation complete, eight background jobs requiring review, and Stripe intentionally unavailable
without staging provider credentials. The Organization directory showed both seeded Organizations as
Ready, and the scoped-access route showed its expected host-selection boundary. Queue dead letters
and global email suppressions loaded with their filters and action controls; no provisioning, scoped
elevation, Retry, Dismiss, Release block, or provider action was invoked. This removes the
fresh-factor observation blocker for Platform UI inspection but does not promote the remaining
Platform API, queue-replay, provider, or external-effect entries.

The corresponding local contract follow-up passed four focused Workerd integration files with 19
tests: Platform authorization/queue controls, reconciliation reporting, ticketing maintenance, and
job/dead-letter behavior. This strengthens implementation evidence for the affected routes but is
not a substitute for the remaining permanent-staging success, failure, and isolation observations.

The user authorized `cwosborn@gmail.com` as an additional staging-only Platform email recipient. The
source configuration includes that address in both the application recipient allowlist and the
Cloudflare Email Sending destination allowlist. After promotion, a fresh OTP was delivered and the
authenticated staging qualification passed with 3 product reads and 74 Organization-host reads; the
session identity matched the allowlisted recipient. Using the same ephemeral session, the extended
parity probe passed 11 entries and skipped 14 fixture/elevation entries. The passing entries were
`api.setup-progress`, `api.rsvp-details`, `api.quick-rsvp`, `api.unsubscribe`,
`api.generate-rsvp-tokens`, `api.checkout-ticket`, `api.checkout-dues`, `api.checkout-donation`,
`api.stripe-webhook`, `api.singer.profile-email-change`, and `api.account.email-change-confirm`. The
ten validation probes returned their expected typed `400` responses without side effects, and the
Stripe probe returned its expected typed `503 stripe_webhook_unavailable` fail-closed response.
These results promote those 11 API entries from `implemented` to `verified`.

In the same authenticated LMC member session, the visible calendar subscription initially returned
HTTP 200 with one `VEVENT`. The confirmed `Reset calendar address` action produced a different
signed address; fetching the old address then returned HTTP 404, while the replacement returned HTTP
200 with a valid `VCALENDAR`. Signed URL values were not recorded. This promotes
`api.calendar-feed-reset` from `implemented` to `verified` without introducing provider or
production effects.

The secure Platform qualification then used the same staging account with a fresh Platform factor.
`api.queue-settings`, `api.queue-settings-generate`, and `api.platform.reconciliation-report` all
passed with HTTP 200 and their expected response shapes; the reconciliation report was checked on
`lcc`. No maintenance, provisioning, queue retry, or provider action was invoked. These three
entries are promoted from `implemented` to `verified`.

The same authenticated LCC session exercised the public audition signup flow with a synthetic,
non-deliverable inquiry. The public form loaded the LCC audition details, accepted the required
contact, performer, and preferred-time fields, and reported `Inquiry Received`. The Organization
Admin Auditions page then showed the inquiry as `Pending Review` with the selected performer and
requested time. The inquiry was removed through the custom `Delete audition?` confirmation dialog,
and the admin table no longer contained the fixture. This supports the public/admin audition
surfaces, but it does not promote `signed.audition` or the complete audition workflow because the
signed-link contract and complete authorization/isolation evidence were not exercised in this batch.

The LCC Roster surface created a temporary no-email profile, assigned voice part S1, updated it to
Inactive with manual status management, and hid it from the directory. The roster CSV export
download contained the created profile with its updated status and blank email, while the public
directory omitted it after hiding. The import dialog opened and displayed its format guidance, but
the in-app browser could not attach a local file to the hidden file chooser, so no import was
submitted. No public roster deletion control exists; the temporary profile remains inactive and
hidden in staging. This is supporting evidence for `workflow.roster`, not a promotion; import,
remaining full CRUD/cleanup, and isolation evidence are still required.

The authenticated LCC session then created one temporary rehearsal linked to the existing `test`
Performance. With a temporary voice part and parent RSVP of Yes, the member dashboard showed the
Rehearsal as Attending with its RSVP controls disabled and the parent-performance explanation.
Declining the parent removed the linked Rehearsal from the dashboard; attending again restored it.
The linked member's attendance also persisted through Pending, Present, Absent, and Pending in the
Attendance manager. The member's original no-part/declined state was restored and the temporary
Rehearsal was archived. This supports `workflow.rsvp-attendance` and `workflow.rehearsal-parent` but
does not promote either entry: scheduler/reminder execution, complete finalization, and the
remaining authorization/isolation evidence are still required.

The push-triggered GitHub Actions CI run `31568021282` failed before starting jobs because GitHub
reported a failed recent payment or insufficient spending limit. It did not affect the successful
local staging deployment, and the manual-only hosted staging workflow was not invoked.

## Historical exact-release and classification audit — August 11, 2026

The latest exact runtime release recorded here is `0d4d9e7253e2e9d0363dd472d0d33efd63760845`
(`refresh qualification release provenance`). Hosted CI run `31547239564` and staging release run
`31547439614` both completed successfully. Deployment `bff1c054-abd8-4d41-b608-cb3e92640301` serves
Worker version `cfff7bbd-779c-4a9b-b972-9c81183d2557` at 100% traffic, with the commit recorded as
its annotation.
`STAGING_EXPECTED_VERSION=0d4d9e7253e2e9d0363dd472d0d33efd63760845 npm run qualify:staging` passed
the exact Worker health/readiness probes. A fresh anonymous boundary sweep passed 148 safe requests
across both seeded Organization hosts with statuses 200=3, 400=28, 401=112, 404=4, and 503=1.

Read-only staging infrastructure checks found all four staging queues (jobs, jobs DLQ, email events,
and email-events DLQ) with one active consumer each, the staging R2 bucket present, and both
registered staging Workflows active. These are configuration and liveness observations; they do not
replace message replay, retry, dead-letter, or Workflow success-path evidence.

A bounded, read-only direct Worker scale smoke against the exact release completed 200 health
requests with 20 concurrent workers. All 200 returned HTTP 200 with the expected staging health
payload; latency was 20 ms p50, 405 ms p95, and 675 ms maximum. This is useful propagation and
light-concurrency evidence, but it is not a substitute for the larger supported-scale data test. The
remote staging D1 migration ledger reported no migrations to apply, and the release trigger
deployment completed successfully; no migration or operational data was changed by these checks.

The current matrix has 205 entries: 159 `verified` and 46 `implemented`. The 23 genuinely
provider-deferred IDs are `route.auth.confirm-email-change`, `api.test-email`, `api.resend-ticket`,
`api.singer.profile-email-change`, `api.account.email-change-confirm`, `signed.email-change`,
`workflow.identity`, `api.test-sms`, `api.checkout-ticket`, `api.checkout-dues`,
`api.checkout-donation`, `api.stripe-webhook`, `api.refund-ticket`, `api.refund-donation`,
`api.refund-dues`, `task.message-queue`, `task.event-reminder`, `task.post-event-report`,
`task.ticket-reminder`, `workflow.communications`, `workflow.ticketing`, `workflow.donations`, and
`workflow.seasons-dues`. Their exact external prerequisites remain the isolated Stripe test account
and connected-account/webhook fixtures, an isolated SMS sender/recipient credential, or an
already-authorized staging email recipient for the link/delivery success path. No such credential
was requested or configured.

The 23 provider-independent IDs still needing permanent-staging success or isolation evidence are
`api.setup-claim`, `api.setup-progress`, `api.setup-complete`, `api.setup-recover-admin`,
`api.rsvp-details`, `api.quick-rsvp`, `api.unsubscribe`, `api.generate-rsvp-tokens`,
`api.queue-settings`, `api.queue-settings-generate`, `api.platform.reconciliation-report`,
`api.calendar-feed-reset`, `api.maintenance`, `task.cleanup`, `signed.rsvp`, `signed.audition`,
`signed.unsubscribe`, `workflow.roster`, `workflow.roster-status-automation`,
`workflow.rsvp-attendance`, `workflow.rehearsal-parent`, `workflow.custom-domains`, and
`file.profile-photo`. The current blockers are explicit: the preserved Platform Security tab still
requires a fresh factor after the Verify action; the separate authenticated member runner still
waits at its secure sign-in prompt; the browser URL policy blocks the old-calendar-token rejection
navigation; and the in-app browser does not expose the hidden profile-photo file chooser. No staging
data was changed by the failed chooser or blocked calendar probe.

## Latest provider-independent file qualification batch — August 11, 2026

This batch was exercised against source commit `af585d572e3dc206db5e409b2de0f2cc091f5537`
(`record provider-independent staging qualification`), deployed by hosted CI run `31542978888` and
staging release run `31543236494` as Worker version `3dbe8508-625e-4b2f-bcf2-a4b5b3163027` at 100%
traffic. The exact direct Worker qualification reported the expected source commit, and the
anonymous boundary sweep passed 148 safe requests across both seeded Organization hosts. The hosted
custom-domain probes retained the documented Cloudflare edge warning. No provider credential or
production resource was changed.

The LCC Organization Admin Music Library uploaded a temporary audio fixture to a section learning
track, showed the second track in the Practice tracks editor, exposed the Organization-scoped
download link, and exercised the track player. The temporary track was removed afterward, restoring
the original catalog state. Together with the existing member offline-player evidence and the
focused file/music integration coverage, this promotes `file.music-audio`.

The LCC Public Website editor uploaded the same non-sensitive staging fixture as the Organization
logo and hero image, saved a draft, published an immutable public version, and confirmed the
published logo rendered on `lcc.staging.musicsite.org`. Both media entries were then removed and a
clean draft was republished; the public site is clean. This promotes `file.public-media`.

The profile-photo chooser could not be exercised because the in-app browser did not expose the
hidden label-backed file input's chooser event. `file.profile-photo` therefore remains implemented
and is not being promoted from local tests alone. The current matrix snapshot is 205 entries: 159
`verified` and 46 `implemented`.

## Latest follow-up batch — RSVP, audition, ticket, and attendance workflows

This batch was exercised against source commit `aecc94e07d6006093bf97f8231b36fd71717cfe1`
(`record deployed staging provenance`), deployed by hosted CI run `31535430633` and staging release
run `31535720059` as Worker version `5ea5f531-847b-46c7-aacf-2ddf073fb679` at 100% traffic. The
exact direct Worker qualification for that artifact had already passed; the hosted custom-domain
probes retain the documented Cloudflare edge 403 warning. No production resource or provider secret
was changed.

The LCC member dashboard changed a temporarily eligible member from Declined to Attending and
reported `Your RSVP was updated.` The member response was restored to Declined, the temporary voice
part was removed, and the admin RSVP view again showed the no-voice-part guard. This promotes
`api.singer-rsvp`.

The RSVP balance controls filtered the roster to 12 Alto 2 profiles and 23 Alto profiles. Attendance
was exercised through Pending → Present → Absent → Pending with immediate persistence, and the
`Mark remaining present` action displayed its destructive confirmation before it was cancelled. The
workspace reported live updates every 30 seconds. These checks support the remaining RSVP/attendance
workflow evidence but do not by themselves promote the full `workflow.rsvp-attendance` entry.

A synthetic scheduled audition was converted to an Organization Profile through the admin
confirmation flow and reported `Audition converted to an Organization Profile.` The resulting
staging-only profile was set Inactive with manual status management. This promotes
`api.organization.audition-convert`.

A temporary zero-dollar public performance was published with ticket sales enabled, a complimentary
order was completed without payment, and its signed door credential was rejected for the wrong
performance and accepted for the correct performance. Repeating the scan returned the application's
valid result again; no duplicate-payment effect was created. The order was then refunded
successfully (`Ticket order refunded.`), and ticket publication and sales were disabled again. This
promotes `api.ticket-validate` and `signed.ticket-scan`; it does not qualify Stripe payment-provider
behavior.

The current matrix snapshot is 205 entries: 157 `verified` and 48 `implemented`. The four newly
promoted entries are `api.singer-rsvp`, `api.organization.audition-convert`, `api.ticket-validate`,
and `signed.ticket-scan`.

Two staging cleanup items remain explicit: the qualification event `test` is still dated Aug 20,
2026 at 5:41 PM rather than its original Aug 11 fixture date because the browser-native datetime
control did not commit a manually entered replacement, and Platform Administrator qualification is
still waiting for a fresh factor in the open security page. The separate authenticated email runner
is still waiting at its secure six-digit sign-in prompt.

## Previous follow-up batch — platform elevation and member links

The current exact staging runtime is source commit `22c4453d434cb21ee709b6b315ed03c06ecb8bb9`
(`record final staging qualification artifact`), deployed by hosted CI run `31534839702` and staging
release run `31535094317` as Worker version `e8b1b0d0-4f22-46fe-b028-5fa0507ac681` at 100% traffic.
Direct qualification of the exact Worker version passed. The GitHub-hosted custom-domain probes
received the known Cloudflare edge 403 and were recorded as the allowed degraded warning; recheck
those domains from an allowlisted or interactive network. No application code, provider secret, or
production resource was changed by this follow-up.

An interactive Platform Administrator factor verification was accepted during this pass. The
Platform overview loaded the deployed build and configuration checks, and the Queue dead-letter
workspace loaded the existing records. One existing dead-letter record was retried through the
custom confirmation flow with an explicit staging qualification reason; the UI reported that a fresh
queue attempt was created and recorded the retry once. This promotes
`api.platform.job-dead-letters.retry`.

The LCC member dashboard generated a personalized poll link for the active qualification poll. The
link opened the signed poll surface, a Yes response was submitted, and the UI reported that the vote
was recorded. This confirms the deployed member-dashboard token generation path for
`api.organization.poll-tokens`; `signed.poll` was already verified.

The LCC member dashboard opened the authorized practice player from an event. The player rendered
the approved set list and an available learning track. The member Practice page then saved the track
offline, showed `Saved offline`, and removed the local copy successfully. These interactions promote
`api.singer-practice-link` and `workflow.player-offline`. The temporary voice-part fixture used
while inspecting RSVP eligibility was restored to `Not assigned`; no new event was created.

The current matrix snapshot is 205 entries: 153 `verified` and 52 `implemented`. The four newly
promoted entries are `api.organization.poll-tokens`, `api.platform.job-dead-letters.retry`,
`api.singer-practice-link`, and `workflow.player-offline`.

The calendar reset control accepted its danger confirmation and rendered a replacement calendar
address. The browser client blocked direct API navigation for the old-address revocation probe, so
`api.calendar-feed-reset` remains implemented pending a direct old-token rejection observation;
existing local calendar integration coverage remains green.

## Current follow-up context

- The prior exact permanent-staging artifact is source commit
  `f7ee50d59ac19054023480a4c3c1236e2afc91a1` (`record exact calendar qualification`). Hosted CI run
  `31530391876` and release-ready artifact run `93909611878` passed, and staging release run
  `31530681787` deployed Worker version `b346cffe-34c7-49a7-adb5-9a2bf8a159dd` at 100% traffic.
  Exact direct qualification passed all six probes, and the exact anonymous boundary sweep passed
  148 safe requests. The GitHub-hosted custom-domain probes were blocked by the known Cloudflare
  edge rule and recorded as the allowed degraded warning. This record-only release carries the
  behavior qualified by `51caefeb9748530665030b3c650fc8726e64cc61`; it has no provider credential or
  production effect.
- An earlier permanent-staging artifact is source commit `51df3e7f0f8582edbae760680690e9d5c1700865`
  (`record signed poll staging qualification`), promoted as Worker version
  `a433f697-fb74-46db-b2ab-069a8aa41454`. Hosted CI run `31521959330` and staging release run
  `31522215667` passed; the exact immutable artifact is at 100% traffic. This commit contains only
  qualification documentation, parity evidence, and the evidence-plan guard update; it has no
  runtime behavior, schema, route, or provider changes.
- The behavior-qualified runtime is source commit `039bf9f8ef6e60350f4c1c15ccd4d672d55c655a`
  (`fix signed poll link submission`), promoted to staging as Worker version
  `c68b8811-895e-4ad5-8d50-251d0819040f`. Hosted CI run `31520853731` and staging release run
  `31521120904` passed; the exact immutable artifact is at 100% traffic. Direct Worker qualification
  passed. The GitHub-hosted custom-domain probes were blocked by the known Cloudflare edge rule, and
  the interactive LCC recheck below passed. The release contains no Stripe or SMS credential changes
  and does not touch production.
- The historical matrix snapshot after the calendar follow-up was 205 entries: 149 `verified` and 56
  `implemented`. The earlier qualification batch narrative below remains historical evidence; the
  previous follow-up batch records 153/52, and the latest batch above records 157/48.
- The latest qualified runtime before this record-only evidence update is source commit `54c423b`
  (`Fix scoped Platform access routing`), promoted to staging as Worker version
  `4b70c369-8b65-48a0-bcc7-1dde2cce97b0`. Hosted CI run `31513358856` and staging release run
  `31513630409` passed; the exact immutable artifact is at 100% traffic. The release includes no
  Stripe or SMS credential changes and does not touch production.
- This follow-up started from the prior recorded 119 `verified` / 86 `implemented` matrix and, after
  the evidence below, reaches 144 `verified` / 61 `implemented`.

## Historical working sets and follow-up evidence

- The current exact staging artifact is source commit `f7ee50d59ac19054023480a4c3c1236e2afc91a1`
  (`record exact calendar qualification`), deployed as Worker version
  `b346cffe-34c7-49a7-adb5-9a2bf8a159dd` by release run `31530681787`. Direct qualification with the
  exact `BUILD_VERSION` and the 148-request anonymous boundary sweep both passed against this
  release. All four GitHub-hosted custom-domain probes received the known Cloudflare edge block; the
  deployment succeeded with the documented degraded warning.
- A fresh anonymous boundary sweep against that exact staging release passed 148 safe requests
  across `lcc` and `lmc`: 3 public HTTP 200 responses, 28 typed validation 400 responses, 112 typed
  authorization 401 responses, 4 expected invalid-link/not-found 404 responses, and the typed
  `stripe_webhook_unavailable` 503. No request fell through to an unhandled route or exposed
  cross-Organization data. This evidence does not promote authenticated or fixture-backed entries.
- The signed-in LMC member schedule exposed a calendar subscription link. Fetching that link on its
  Organization host returned HTTP 200 with `text/calendar`, a valid `VCALENDAR`, and organization-
  scoped `VEVENT` records. Reusing the same signed value on the LCC host and changing its final
  signature character both returned typed HTTP 404 `not_found` responses. The token value was not
  recorded. This promotes `api.calendar-feed` and `signed.calendar`.
- The current remaining working sets are explicit. The 23 provider-deferred entries are
  `route.auth.confirm-email-change`, `api.test-email`, `api.resend-ticket`,
  `api.singer.profile-email-change`, `api.account.email-change-confirm`, `signed.email-change`,
  `workflow.identity`, `api.test-sms`, `api.checkout-ticket`, `api.checkout-dues`,
  `api.checkout-donation`, `api.stripe-webhook`, `api.refund-ticket`, `api.refund-donation`,
  `api.refund-dues`, `task.message-queue`, `task.event-reminder`, `task.post-event-report`,
  `task.ticket-reminder`, `workflow.communications`, `workflow.ticketing`, `workflow.donations`, and
  `workflow.seasons-dues`. Email entries require an already-authorized staging recipient and a valid
  delivery/confirmation observation; SMS requires a staging SMS credential and verified
  sender/recipient; payment entries require an isolated Stripe test account, connected-account
  setup, signed webhook fixtures, and refund/replay evidence. No such credentials were requested or
  configured.
- The 29 provider-independent entries that remain to qualify are `api.setup-claim`,
  `api.setup-progress`, `api.setup-complete`, `api.setup-recover-admin`, `api.rsvp-details`,
  `api.singer-rsvp`, `api.quick-rsvp`, `api.unsubscribe`, `api.generate-rsvp-tokens`,
  `api.queue-settings`, `api.queue-settings-generate`, `api.platform.reconciliation-report`,
  `api.ticket-validate`, `api.calendar-feed-reset`, `api.maintenance`,
  `api.organization.audition-convert`, `task.cleanup`, `signed.rsvp`, `signed.audition`,
  `signed.unsubscribe`, `signed.ticket-scan`, `workflow.roster`,
  `workflow.roster-status-automation`, `workflow.rsvp-attendance`, `workflow.rehearsal-parent`,
  `workflow.custom-domains`, `file.profile-photo`, `file.music-audio`, and `file.public-media`.
- At the earlier inspection before the latest interactive factor assertion, a staging browser review
  found that the Platform Security page required a fresh factor. The latest pass accepted that
  factor and exercised the Platform overview and one queue retry, while direct reconciliation API
  navigation remains unavailable through the browser client. The current LMC Organization member
  fixture is signed in but has no assigned voice part, so singer RSVP success cannot be claimed
  without changing that staging fixture. Both Organizations currently have no ticket orders, so
  ticket validation requires a deliberate staging purchase-like fixture. The browser file-chooser
  flow also did not expose a usable chooser for a non-sensitive repository image, so upload success
  remains unverified. These are evidence/fixture blockers, not provider claims. The calendar
  signed-flow evidence was the only matrix promotion from that earlier inspection; the latest
  follow-up batch is recorded above.

## Release and starting point

- Qualified runtime source commit: `44e3f36b247b8a04b33bb15c8307ab83ee7fc095`
- Worker version: `b1abb7c9-293e-47ef-9bb9-ca48e9a714b0`
- Environment: staging
- Canonical hosts checked: `staging.musicsite.org`, `lcc.staging.musicsite.org`, and
  `lmc.staging.musicsite.org`
- Starting parity inventory for this follow-up qualification: 205 entries — 84 `verified`, 121
  `implemented` (the initial record began at 74 `verified`, 131 `implemented`).
- Ending parity inventory: 205 entries — 119 `verified`, 86 `implemented`.
- No Stripe or SMS credentials were requested, entered, stored, or changed. Production resources
  were not accessed or modified.

The runtime includes the RSVP eligibility fix from `6343f2f` and the Organization resource file
replacement fix in this release. CI run `31502437584` and staging deployment run `31502710837`
verified the exact immutable artifact and promoted it to 100% traffic as Worker version
`b1abb7c9-293e-47ef-9bb9-ca48e9a714b0`. A fresh `npm run qualify:staging` run passed all six
exact-version API health/readiness probes. The GitHub-hosted runner's custom-domain probes were
blocked by the expected Cloudflare edge rule, so those probes remain an interactive-network
follow-up rather than a claimed failure.

The record-only release commit `177799328bdd4b70c5012b07326a949a7f6b79c0` passed CI run
`31503643685` and staging deployment run `31503941589`; Worker version
`16bf8eff-e170-4a06-9f3e-26aa022458eb` is at 100% traffic. That deployment reused the same qualified
application behavior, passed exact-version direct Worker qualification, and retained the expected
GitHub-hosted custom-domain warning. The additional evidence below was gathered against that
qualified staging runtime; this next parity-record update changes evidence classification only.

The previous evidence commit `b49f8a588dcba8792e20b40313e8af97d8b4b4da` passed CI run `31507587095`
and staging deployment run `31507886134`; Worker version `709655ee-359c-41d5-9b77-526c2f49fe99` is
at 100% traffic. It contains no application behavior or schema change beyond the parity evidence
classification and the evidence-plan regression guard. Exact-version direct Worker qualification
passed; the hosted runner again reported only the expected custom-domain edge warning.

The previous record-only release commit `126c6471b4a21d0c1cfc78e16947ed888a9d3d0f` passed CI run
`31508287775` and staging deployment run `31508576957`; Worker version
`7b31bef2-bb19-45bd-9a48-4211cdf4de96` is at 100% traffic. It contains no application behavior or
schema change beyond this provenance correction. Exact-version direct Worker qualification passed;
the hosted runner again reported only the expected custom-domain edge warning.

The current record-only release commit `5112ba4fe15cf75a9916664b6d3636589cd75f08` passed CI run
`31509036866` and staging deployment run `31509962666`; Worker version
`05778a29-469c-4c41-99d1-195c3961288b` is at 100% traffic. It contains no application behavior or
schema change beyond this final provenance alignment. Exact-version direct Worker qualification
passed; the hosted runner again reported only the expected custom-domain edge warning.

## Qualifiable now

### Deployment and boundary checks

- `npm run qualify:staging` passed all six direct Worker and seeded custom-domain health/readiness
  probes for the exact release version.
- The anonymous evidence sweep passed 148 expected requests across both seeded Organization hosts: 3
  HTTP 200 responses, 28 validation failures, 112 authorization failures, 4 typed invalid-link or
  not-found responses, and the expected fail-closed Stripe configuration response. There were no
  unexpected 5xx responses or router-level 404s.
- The signed-in LCC Organization Admin sweep loaded the Organization Admin surfaces without a
  persistent alert or route error. The member/public sweep loaded the corresponding signed-in and
  public surfaces without a router error. LMC remained a separate Organization host and the current
  LMC session did not expose Organization Admin access.
- Platform Administrator routes remain behind the fresh-factor boundary. No factor was copied or
  logged; the open security page currently asks for a 6-digit code.

### RSVP regression qualification

- On LCC `/admin/rsvp`, assigned performers retain Attending, Declined, and Reset actions.
- A profile without a voice part rendered the `—` performer value and
  `Assign a voice part before managing RSVP.` with no RSVP action buttons.
- The existing local CI gate covers the server-side 422 contract and the automatic RSVP
  reconciliation guard, so a direct API call cannot bypass the UI eligibility rule.

### Provider-independent staging workflows

- Polls: created a temporary LCC poll, confirmed the required expiration and three-day default,
  edited it, toggled the archived-poll filter without the reported load error, created a sandbox
  communications draft through Share with members, confirmed the personalized-link placeholder in
  the draft preview, and removed the temporary draft through the custom confirmation flow. No
  message was queued or sent.
- Discount codes: created `QUALIFY11`, confirmed it in the Discount Codes table, edited its
  percentage, and deactivated it through the custom confirmation. The code is inactive and no
  checkout or payment effect was created.
- Music Folder Report: selected two performances, confirmed the multi-performance summary and
  zero-assigned-folder state on LCC, and confirmed that export becomes available only after a
  performance is selected. No folder number or return state was changed.
- Organization export: started an LCC export, observed the queued/processing transition, waited for
  the UI to report `Export ready to download`, and activated the download control. The browser
  client did not expose response bytes for inspection, so checksum/payload-byte assertions remain
  supported by the local Workerd suite rather than claimed from this browser step.
- CSV/report surfaces: the current staging UI exposed the authorized export controls and the
  existing dated evidence captured roster, music-library, repertoire, donations, RSVP, and music
  folder report headers/row counts without retaining member or payment values.
- Follow-up CSV artifacts from the qualified staging runtime produced populated, authorized
  downloads for roster (98 non-empty lines; `Name,Email,Phone,Performer,Status`), music library (36
  non-empty lines; the 11-column baseline header), RSVP (100 non-empty lines; the five-column event
  roster header plus the `Section Leaders` marker), and repertoire (36 non-empty lines; the
  five-column repertoire header). The local contract and authorization/isolation tests passed in the
  same CI gate. Attendance remained intentionally unpromoted because every available performance
  reported no linked rehearsals and kept its export disabled; the empty music-folder export likewise
  remains unpromoted.
- Organization resources: in the authenticated LCC staging UI, a non-sensitive fixture upload was
  replaced successfully after the backend fix, the resource pointed to the new private file, and
  deleting the resource reclaimed the fixture. The existing authorized private-resource download
  path was exercised separately. The prepared `resources.integration.test.ts` and
  `files.integration.test.ts` suites also verified replacement cleanup, Organization-scoped R2 keys,
  cross-Organization substitution rejection, and poisoned metadata rejection. The fixture records
  and objects were removed after verification.
- At a 390px staging viewport, public home/history/performance, the authenticated roster DataTable,
  setup, and communications pages had no horizontal overflow or persistent alert. The roster
  rendered mobile cards rather than a desktop table. The responsive browser suite also passed its
  breakpoint ladder and setup continuation checks in CI.
- Responsive/read-only surfaces: the dated staging browser evidence covers 390px checks for the
  Organization Admin, member, public, communications, ticketing, reports, seating, poll, and setup
  surfaces. Known layout candidates remain recorded in `READINESS.md`; they are not hidden by this
  qualification record.

### Additional provider-independent qualification batch

The following staging interactions were completed against the qualified runtime. Temporary audition,
rehearsal, export, resource, and folder fixtures were removed or archived after each check; no real
message, payment, SMS, or external recipient effect was created.

- Organization export reached the queued/ready state and its authorized download control emitted a
  browser download event. The browser tool did not inspect export bytes; local Workerd coverage
  remains the source of checksum and payload assertions.
- Will-call CSV download emitted a browser download event. Donations and Attendance exports exposed
  their authorized controls and expected headers; their data-URL downloads did not emit a browser
  download event in the tool, so no bytes were retained. Existing local CSV contract tests cover
  quoting, headers, and empty/populated rows.
- Music Folder Report selected a Performance, edited a folder number, marked it returned, observed
  the summary move from Outstanding to Returned, and cleared the temporary number. The report
  detail, return-status, export, and multi-Performance paths were exercised without retaining member
  values.
- Auditions covered public details/inquiry/submit, settings read/save, admin
  create/list/update/delete, a validation failure for an unscheduled status change, and the
  corresponding audit-trigger paths.
- The practice player generated and opened an authorized player route with the expected playlist
  heading and no error surface. Signed-token bytes were not copied or retained.
- Responsive checks at 390px covered checkout and Music Folder Report state selection/detail
  behavior, with no alert or horizontal overflow. The viewport override was reset afterward.

This batch promotes these evidence entries to `verified`: the 21 audited organization/player/public
audition/music-folder API entries (`api.organization.donations`, `api.organization.dues`,
`api.organization.patrons`, `api.organization.seasons`, `api.player-token`, `api.player-playlist`,
`api.organization.export-download`, the three public audition APIs, the six admin audition APIs, and
the five Music Folder Report APIs); `signed.player`; `csv.donations`, `csv.attendance`,
`csv.will-call`, and `csv.music-folder-report`; `hook.audition-create` and `hook.audition-update`;
`workflow.music-folder-report`, `workflow.polls`, `workflow.auditions`, `workflow.resources`, and
`workflow.organization-export`; and `responsive.music-folder-report` and `responsive.checkout`.

Platform Administrator operations remain behind the fresh-factor boundary in the current browser
session. Profile-photo, music-audio, and public-media upload success paths were not promoted because
the browser file chooser was not available for a safe fixture upload. No status was inferred from
either limitation.

### Follow-up Organization workflow qualification batch

After the scoped Platform routing fix was deployed, an authenticated LMC Organization Admin session
completed and cleaned up these provider-independent staging workflows:

- Communications saved a temporary draft, updated its subject, and removed both temporary draft
  records through the custom confirmation. The UI reported `Draft saved.` after both writes. No
  message was queued, delivered, or sent.
- Events cloned the existing Performance, reported `Event created.`, and archived the temporary
  clone through the destructive confirmation. The clone no longer appeared in the active event list.
- Seating opened the new-chart dialog, used the default RSVP-Yes singer count, changed the row
  count, observed the live per-row summary, created `Qualification seating`, opened Profile lookup,
  and deleted the temporary chart through its confirmation. The selected chart returned to its prior
  state.
- Set lists inserted a temporary custom entry, edited its title, saved it, approved the set list,
  removed the entry, and restored the prior unapproved empty state. The UI reported
  `Set list saved.` and no temporary item remained.
- Music Catalog created a temporary catalog piece, saved it, opened its editor, and deleted it
  through the confirmation. No audio file was selected and no catalog fixture remained.
- Public Website saved and published a temporary hero headline, confirmed the live public host
  rendered the published text, then restored and republished the original headline. The public
  projection now again reads `Welcome to Our Choir`.

This batch promotes `api.list-ticket-discount-codes`, `api.create-ticket-discount-code`,
`api.update-ticket-discount-code`, and `api.deactivate-ticket-discount-code` from the earlier
staging discount-code lifecycle fixture; `hook.message-create` and `hook.message-update` from the
draft create/update writes; and `workflow.event-clone`, `workflow.music`, `workflow.setlists`,
`workflow.seating`, and `workflow.public-site`. The separate `file.music-audio` entry remains
unpromoted because this batch did not select or upload an audio file.

The same authenticated Organization session also loaded the setup checklist, module-state page,
member dashboard, calendar subscription page, seating profile data, and Polls list without a load
error. Existing staging poll create/update/archive evidence was retained. This promotes
`api.setup-status`, `api.module-state`, `api.setup-health`, `api.singer-dashboard`,
`api.calendar-feed-url`, `api.seating-profiles`, `api.organization.polls`,
`api.organization.poll-create`, `api.organization.poll-update`, and `api.organization.poll-archive`.

An earlier authenticated Platform Administrator session also read the Email suppressions and Queue
dead letters surfaces, exercised their sort/filter controls, and dismissed one staging dead-letter
record with an audit reason. Retry and provider-release actions were intentionally not invoked. This
supports `api.platform.email-suppressions`, `api.platform.job-dead-letters`, and
`api.platform.job-dead-letters.dismiss`; the remaining mutating Platform operations still require
their own focused evidence.

The fresh factor assertion then loaded Platform Organizations on the product base hostname. The LMC
Manage access link stayed on `https://lmc.staging.musicsite.org/platform/access`; after the initial
workspace data settled, the page showed the selected Organization, read-only Platform access, and a
bounded 15-minute edit control. Enabling edits with a staging-only reason reported
`Platform edits enabled.`; ending access returned the page to `Read-only Platform access`. No
Organization provisioning, queue retry, provider release, or production action was performed. This
verifies `workflow.platform-admin` for its bounded scoped-elevation behavior; the remaining Platform
API operations below still require their own focused evidence.

### Signed poll link regression follow-up

The deployed poll-link flow was rechecked after the staging release for `039bf9f`. The authenticated
LCC dashboard's existing `Qualification poll 2026-08-11` link opened the poll heading and response
options on the Organization host without the prior render exception, and did not fall into the
tokenless or invalid-link states. The browser recheck intentionally did not submit the existing
qualification response. The new focused browser test submits a mocked valid signed poll response;
the prepared Workerd suite covers valid details, vote persistence, invalid/expired/wrong-host
tokens, cross-Organization isolation, option validation, duplicate submission, and wrong-purpose
rejection. The client now validates the shared response schema, reads `responseOptionIds`, and
retains the token after removing it from the visible URL so a rendered link can actually submit.

This promotes `api.public.poll-details`, `api.public.poll-vote`, and `signed.poll` to `verified`. No
schema, route, migration, provider credential, or external-effect behavior changed.

The historical matrix snapshot at this point contained 205 entries: 149 `verified` and 56
`implemented`. This is not a claim that all provider-independent qualification is complete: valid
signed-link expiry/revocation for flows other than the poll and calendar links, scheduler/queue
replay, the remaining file upload contracts, the remaining Platform API operations, and other
fixture-backed API/workflow entries still require evidence below.

## Provider-deferred work

The following work cannot be honestly promoted from this staging session without the corresponding
external prerequisite. These are deferred rather than treated as code failures:

- Stripe: `api.checkout-ticket`, `api.checkout-dues`, `api.checkout-donation`, `api.stripe-webhook`,
  `api.refund-ticket`, `api.refund-donation`, `api.refund-dues`, and the provider-backed portions of
  `workflow.ticketing`, `workflow.donations`, and `workflow.seasons-dues`. Prerequisites are an
  isolated staging Stripe test account, connected-account setup, webhook signing secret, signed
  fixtures, and a rollback/replay run.
- SMS: `api.test-sms`. Prerequisites are an isolated staging SMS credential and verified sender or
  recipient fixture. No SMS credential was requested or entered.
- Outbound email success paths: `api.test-email`, `api.resend-ticket`,
  `api.singer.profile-email-change`, `api.account.email-change-confirm`, `signed.email-change`, and
  `route.auth.confirm-email-change` remain deferred where a valid link would require a
  newly-authorized staging recipient. Cloudflare Email Sending configuration is present, but no live
  recipient authorization was added for this pass.
- Live communication delivery tasks (`task.message-queue`, `task.event-reminder`,
  `task.post-event-report`, and `task.ticket-reminder`) remain deferred for end-to-end provider
  delivery observation. Local idempotency, retry, redaction, and dead-letter tests remain required
  evidence and are not replaced by this deferral.

## Still requiring provider-independent evidence

The remaining entries are not automatically deferred: valid success/expiry/revocation evidence for
the signed flows other than the player link, queue/alarm replay, the remaining message record-hook
effects, the three remaining profile/audio/public-media file behaviors, and the remaining Platform
Administrator API operations still need success plus failure/isolation evidence. The remaining
implemented API and workflow entries need the same focused fixture evidence unless they are listed
under Provider-deferred work. The remaining Platform operations require their own focused evidence
even though the scoped elevation flow has been verified. No parity status is promoted merely because
a route rendered or an anonymous request failed closed.

The earlier record ended at 119 `verified` and 86 `implemented`; the qualification batches above
reached 144 `verified` and 61 `implemented`, the signed-poll follow-up reached 147 `verified` and 58
`implemented`, and that historical calendar follow-up brought the matrix to 149 `verified` and 56
`implemented`. Provider-deferred entries remained in the latter count at that time.

- A valid calendar subscription address was present in the member UI. An in-memory fetch returned a
  valid Organization-scoped calendar, while the same signed value on the other Organization host and
  a tampered signature returned typed 404 responses. The token was not retained in the evidence.

## Safety and rollback

- No migration, production resource, provider credential, signed token, or real payment/SMS effect
  was created by this pass.
- The runtime release is immutable and can be rolled back by the existing staging promotion workflow
  to the prior qualified Worker version. The poll and inactive discount-code test records are
  staging-only data; no message or payment was sent.
- Tenant isolation remains host-derived and is covered by the local adversarial integration suite;
  the current browser cross-host checks did not expose data across LCC and LMC.
