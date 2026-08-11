# Permanent staging qualification evidence — August 11, 2026

This record covers the current permanent staging deployment only. It does not authorize or describe
a production launch.

## Latest follow-up batch — platform elevation and member links

The current exact staging runtime is source commit `f66bc3619071842ffebdbd51a49f7a9a358be675`
(`record platform and member qualification evidence`), deployed by hosted CI run `31534172241` and
staging release run `31534447033` as Worker version `0aa0e7e1-6975-45f5-8689-92efd49f5ab0` at 100%
traffic. Direct qualification of the exact Worker version passed. The GitHub-hosted custom-domain
probes received the known Cloudflare edge 403 and were recorded as the allowed degraded warning;
recheck those domains from an allowlisted or interactive network. No application code, provider
secret, or production resource was changed by this follow-up.

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
  latest follow-up batch above records the current 153/52 snapshot.
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
