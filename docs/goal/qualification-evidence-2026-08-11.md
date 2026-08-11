# Permanent staging qualification evidence — August 11, 2026

This record covers the current permanent staging deployment only. It does not authorize or describe
a production launch.

## Release and starting point

- Qualified runtime source commit: `44e3f36b247b8a04b33bb15c8307ab83ee7fc095`
- Worker version: `b1abb7c9-293e-47ef-9bb9-ca48e9a714b0`
- Environment: staging
- Canonical hosts checked: `staging.musicsite.org`, `lcc.staging.musicsite.org`, and
  `lmc.staging.musicsite.org`
- Starting parity inventory for this follow-up qualification: 205 entries — 82 `verified`, 123
  `implemented` (the initial record began at 74 `verified`, 131 `implemented`).
- Ending parity inventory: 205 entries — 84 `verified`, 121 `implemented`.
- No Stripe or SMS credentials were requested, entered, stored, or changed. Production resources
  were not accessed or modified.

The runtime includes the RSVP eligibility fix from `6343f2f` and the Organization resource file
replacement fix in this release. CI run `31502437584` and staging deployment run `31502710837`
verified the exact immutable artifact and promoted it to 100% traffic as Worker version
`b1abb7c9-293e-47ef-9bb9-ca48e9a714b0`. A fresh `npm run qualify:staging` run passed all six
exact-version API health/readiness probes. The GitHub-hosted runner's custom-domain probes were
blocked by the expected Cloudflare edge rule, so those probes remain an interactive-network
follow-up rather than a claimed failure.

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

The remaining entries are not automatically deferred: valid signed-link success/expiry/revocation,
queue/alarm replay, record-hook effects, the remaining attendance/donations/will-call/music-folder
CSV contracts, export completion/download, the three remaining profile/audio/public-media file
behaviors, and Platform Administrator operations still need their success plus failure/isolation
evidence. Platform operations specifically require a fresh user-entered factor in the staging
browser. No parity status is promoted merely because a route rendered or an anonymous request failed
closed.

This follow-up qualification promotes these ten entries to `verified`: `csv.roster`,
`csv.music-library`, `csv.event-rsvp`, `csv.repertoire`, `responsive.public`,
`responsive.data-table`, `responsive.setup`, `responsive.communications`, `file.singer-resource`,
and `file.r2-isolation`. The ending matrix is therefore 84 `verified` and 121 `implemented`; the
provider-deferred entries remain in the latter count.

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
