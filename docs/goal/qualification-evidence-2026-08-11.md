# Permanent staging qualification evidence — August 11, 2026

This record covers the current permanent staging deployment only. It does not authorize or describe
a production launch.

## Release and starting point

- Repository commit: `d6892ce55bd05ebcb02b38b81455c13b282dc749`
- Worker version: `6ec0a177-4334-4834-a339-bc5990b82e08`
- Environment: staging
- Canonical hosts checked: `staging.musicsite.org`, `lcc.staging.musicsite.org`, and
  `lmc.staging.musicsite.org`
- Starting parity inventory: 205 entries — 74 `verified`, 131 `implemented`.
- No Stripe or SMS credentials were requested, entered, stored, or changed. Production resources
  were not accessed or modified.

The runtime code for this release is the RSVP fix commit `6343f2f`; the current commit adds the
release/readiness record. CI run `31497559435` and staging deployment run `31497846290` qualified
the exact immutable artifact and promoted it to 100% traffic. The interactive recheck passed the
direct Worker and seeded custom-domain health/readiness probes.

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
queue/alarm replay, record-hook effects, authorized file upload/replacement and R2 isolation,
complete CSV contract checks, export completion/download, and Platform Administrator operations
still need their success plus failure/isolation evidence. Platform operations specifically require a
fresh user-entered factor in the open staging browser. No parity status is promoted merely because a
route rendered or an anonymous request failed closed.

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
