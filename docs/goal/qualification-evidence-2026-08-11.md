# Permanent staging qualification evidence — August 11, 2026

This record covers the current permanent staging deployment only. It does not authorize or describe
a production launch.

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

The current evidence commit `b49f8a588dcba8792e20b40313e8af97d8b4b4da` passed CI run `31507587095`
and staging deployment run `31507886134`; Worker version `709655ee-359c-41d5-9b77-526c2f49fe99` is
at 100% traffic. It contains no application behavior or schema change beyond the parity evidence
classification and the evidence-plan regression guard. Exact-version direct Worker qualification
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
effects, the three remaining profile/audio/public-media file behaviors, and Platform Administrator
operations still need success plus failure/isolation evidence. The remaining implemented API and
workflow entries need the same focused fixture evidence unless they are listed under
Provider-deferred work. Platform operations specifically require a fresh user-entered factor in the
staging browser. No parity status is promoted merely because a route rendered or an anonymous
request failed closed.

Together with the ten entries promoted in the prior record (`csv.roster`, `csv.music-library`,
`csv.event-rsvp`, `csv.repertoire`, `responsive.public`, `responsive.data-table`,
`responsive.setup`, `responsive.communications`, `file.singer-resource`, and `file.r2-isolation`),
the current matrix is 119 `verified` and 86 `implemented`. The provider-deferred entries remain in
the latter count.

- A valid calendar subscription address was present in the member UI, but the browser client blocks
  direct `/api/calendar/feed` navigation; the signed calendar feed therefore remains unpromoted and
  its token was not retained. This is a browser-tool boundary, not evidence of a server failure.

## Safety and rollback

- No migration, production resource, provider credential, signed token, or real payment/SMS effect
  was created by this pass.
- The runtime release is immutable and can be rolled back by the existing staging promotion workflow
  to the prior qualified Worker version. The poll and inactive discount-code test records are
  staging-only data; no message or payment was sent.
- Tenant isolation remains host-derived and is covered by the local adversarial integration suite;
  the current browser cross-host checks did not expose data across LCC and LMC.
