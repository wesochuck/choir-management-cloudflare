# Goal Readiness and Operating State

**Prepared:** August 11, 2026

**Current status:** The repository contains implementation and focused-test evidence for the planned
Milestones 0–5 scope, but the goal is not complete. The current parity matrix contains 205 entries:
159 are `verified` and 46 are `implemented`. Per the matrix definitions, `implemented` means that
target behavior and focused tests exist; permanent-staging proof may still remain. There are no
entries currently classified as `planned`, `partial`, or `blocked`, so the remaining work is the
Milestone 6 whole-product staging qualification gate rather than a known unimplemented parity slice.

## Latest provider-independent file qualification — August 11, 2026

The latest provider-independent evidence batch was exercised against source commit
`af585d572e3dc206db5e409b2de0f2cc091f5537` (`record provider-independent staging qualification`),
deployed by hosted CI run `31542978888` and staging release run `31543236494` as Worker version
`3dbe8508-625e-4b2f-bcf2-a4b5b3163027` at 100% traffic. Exact direct Worker qualification and the
148-request anonymous Organization boundary sweep passed; the hosted custom-domain probes retained
the documented Cloudflare edge warning. The current commit records this evidence and does not alter
runtime behavior.

The LCC Music Library successfully uploaded, played, exposed for download, and removed a temporary
Organization-scoped learning track. The LCC Public Website editor successfully uploaded, saved, and
published temporary logo and hero media, confirmed the published logo on the public host, then
removed both fixtures and republished a clean site. These checks promote `file.music-audio` and
`file.public-media`. The profile-photo file chooser remains an interactive-browser limitation and
`file.profile-photo` remains implemented pending a successful chooser/upload/delete/render cycle.

The Platform Security page still visibly requires a fresh factor, and the separate authenticated
email runner remains at its secure six-digit sign-in prompt. No Stripe or SMS credential was
requested or configured, and production was not changed.

The latest exact permanent-staging artifact is source commit
`aecc94e07d6006093bf97f8231b36fd71717cfe1` (`record deployed staging provenance`), deployed by
hosted CI run `31535430633` and staging release run `31535720059` as Worker version
`5ea5f531-847b-46c7-aacf-2ddf073fb679` at 100% traffic. Direct qualification of the exact Worker
version passed. The GitHub-hosted custom-domain probes received the known Cloudflare edge 403 and
were recorded as the allowed degraded warning; recheck those domains from an allowlisted or
interactive network.

The latest staging evidence batch exercised member RSVP success and restoration, RSVP part/group
filters, reversible attendance cycling and its destructive confirmation, audition-to-profile
conversion, and a zero-dollar ticket order with wrong-performance rejection, valid signed-door
validation, successful free-order refund, and ticket-sales cleanup. It promotes `api.singer-rsvp`,
`api.organization.audition-convert`, `api.ticket-validate`, and `signed.ticket-scan`. The temporary
voice-part and audition fixtures were restored or inactivated; the temporary event remains dated Aug
20, 2026 while its original Aug 11 date still needs restoration through a working date-control path.
Platform Administrator qualification is still behind the fresh-factor gate, and the separate
authenticated email runner remains at its secure six-digit prompt. No Stripe or SMS credential was
requested or configured, and production was not changed.

The previous follow-up batch promoted `api.organization.poll-tokens`,
`api.platform.job-dead-letters.retry`, `api.singer-practice-link`, and `workflow.player-offline`.
Calendar reset rendered a replacement address, but its direct old-token rejection probe was blocked
by the browser client, so `api.calendar-feed-reset` remains implemented. The goal remains active
because provider-deferred entries and additional Platform API, signed-link, file, queue, domain,
scale, and rollback evidence are still listed below.

The prior exact permanent-staging artifact was source commit
`f7ee50d59ac19054023480a4c3c1236e2afc91a1` (`record exact calendar qualification`). Hosted CI run
`31530391876` and release-ready artifact run `93909611878` passed. Staging release run `31530681787`
deployed Worker version `b346cffe-34c7-49a7-adb5-9a2bf8a159dd` at 100% traffic, and exact direct
qualification plus the exact anonymous boundary sweep passed. The GitHub-hosted custom-domain probes
were blocked by the known Cloudflare edge rule and recorded as the allowed degraded warning. This
record-only release carries the behavior qualified by `51caefeb9748530665030b3c650fc8726e64cc61`; it
has no provider credential or production effect.

The immediately preceding behavior-qualified permanent-staging artifact is source commit
`51caefeb9748530665030b3c650fc8726e64cc61` (`qualify signed calendar feed`). It was promoted as
Worker version `bfde1f9f-c43b-4d83-b8d8-d874446b28c1`. Hosted CI run `31529037805` and staging
release run `31529285055` passed, and the exact immutable artifact reached 100% traffic.

The previous follow-up record is source commit `d8a24856eb039bcd9f1bb28bcc067f8823242131`
(`record latest staging artifact`), deployed as Worker version
`c4a24a96-db79-4574-833c-184fb91fa608` by staging release run `31523037909`. Direct exact-version
qualification passed, and its anonymous boundary sweep passed 148 safe requests across both seeded
Organization hosts. This record-only commit does not change runtime behavior.

The behavior-qualified runtime source release is `039bf9f8ef6e60350f4c1c15ccd4d672d55c655a`
(`fix signed poll link submission`). It was promoted to permanent staging as Worker version
`c68b8811-895e-4ad5-8d50-251d0819040f`. Hosted CI run `31520853731` and staging release run
`31521120904` passed, the exact immutable artifact is at 100% traffic, and direct Worker
qualification passed. The GitHub-hosted custom-domain probes were blocked by the known Cloudflare
edge rule; the interactive LCC recheck passed. The release has no Stripe or SMS credential changes
and production was not accessed or modified.

The prior qualified runtime source release was `54c423b` (`Fix scoped Platform access routing`). It
includes the RSVP eligibility fix from `6343f2f` and was promoted to permanent staging as Worker
version `4b70c369-8b65-48a0-bcc7-1dde2cce97b0`. The hosted CI run `31513358856` and staging
deployment run `31513630409` passed, and the exact immutable artifact is at 100% traffic. The
record-only release commit `177799328bdd4b70c5012b07326a949a7f6b79c0` passed CI run `31503643685`
and staging deployment run `31503941589`; Worker version `16bf8eff-e170-4a06-9f3e-26aa022458eb` is
at 100% traffic. It reused the qualified application behavior and passed exact-version direct Worker
qualification, with the expected GitHub-hosted custom-domain warning. The previous evidence commit
`b49f8a588dcba8792e20b40313e8af97d8b4b4da` passed CI run `31507587095` and staging deployment run
`31507886134`; Worker version `709655ee-359c-41d5-9b77-526c2f49fe99` is at 100% traffic. It changed
only evidence classification and its guard test, and exact-version direct Worker qualification
passed with the same expected custom-domain warning. The current record-only release commit
`126c6471b4a21d0c1cfc78e16947ed888a9d3d0f` passed CI run `31508287775` and staging deployment run
`31508576957`; Worker version `7b31bef2-bb19-45bd-9a48-4211cdf4de96` is at 100% traffic. It changed
only provenance documentation, and exact-version direct Worker qualification passed with the same
expected custom-domain warning. The current record-only release commit
`5112ba4fe15cf75a9916664b6d3636589cd75f08` passed CI run `31509036866` and staging deployment run
`31509962666`; Worker version `05778a29-469c-4c41-99d1-195c3961288b` is at 100% traffic. It changes
only final provenance documentation, and exact-version direct Worker qualification passed with the
same expected custom-domain warning. The focused current qualification record is
[`docs/goal/qualification-evidence-2026-08-11.md`](qualification-evidence-2026-08-11.md); this does
not make the whole-product goal complete.

The current parity checks pass:

- `npm run check:parity`: 205 entries validated across 9 sections.
- `npm run check:parity:implementation`: 79 API entries checked against 66 Worker route files.

The parity ledger is a behavioral coverage and evidence inventory, not a requirement to reproduce
every legacy API method or route verbatim. Legacy source establishes observable intent and boundary
cases; new implementation may consolidate or reshape internal/API methods when the required
capability, authorization, Organization isolation, auditability, idempotency, and external-effect
semantics remain covered.

The current release evidence is:

- Remote CI run `31494149953` passed all static, contract/parity, unit, build-artifact, Workerd, and
  browser-E2E jobs for `6343f2fe233ec4a50322de40322f27d9b8dcbaf0`.
- Staging release run `31494416456` verified the immutable artifact and staging Email Sending
  subscription, applied migrations and non-versioned triggers, deployed Worker version
  `10690acb-3e7a-446d-933d-149419f9707f` at 100% traffic, and qualified the exact `BUILD_VERSION`.
  Direct Worker probes and an interactive-network recheck of `staging.musicsite.org`, `lcc`, and
  `lmc` all reported the new release.
- Docs-only release commit `7187b3ee06616e02ab80ec17544ed1c5fbd8db76` passed CI run `31494669993`
  and staging deployment run `31494952424`; the immutable Worker version
  `20c9fcac-5ea8-491f-97da-22b085b0d0b3` is at 100% traffic. A fresh `npm run qualify:staging` run
  passed all six exact-version health/readiness probes.
- Qualification commit `d6892ce55bd05ebcb02b38b81455c13b282dc749` passed CI run `31497559435` and
  staging deployment run `31497846290`; the immutable Worker version
  `6ec0a177-4334-4834-a339-bc5990b82e08` is at 100% traffic. The deployment applied the exact
  artifact, passed the release gate and exact-version API qualification, and the interactive recheck
  passed all six direct/custom-domain health/readiness probes.
- Final release commit `0f4a9f861379dd231661ee1f69126479226ffdd9` passed CI run `31498257876` and
  staging deployment run `31498547472`; the immutable Worker version
  `64cf3d93-bfe8-4cc2-b288-9b037287598a` is at 100% traffic. The deployment verified and promoted
  the exact artifact, and a fresh `npm run qualify:staging` run passed all six exact-version API
  health/readiness probes. The GitHub-hosted runner again blocked custom-domain probes with the
  expected Cloudflare edge warning; no Worker failure was observed.
- Qualified runtime source commit `f39bdd6b38b1c2eccc67ced8caed2f3960233226` passed CI run
  `31499155863` and staging deployment run `31499466302`; Worker version
  `5d122ffe-eb4b-4a4f-941e-24674c88c3e1` is at 100% traffic. The exact-version recheck passed all
  six API probes. The current anonymous evidence sweep passed 148 safe requests across LCC and LMC
  with the expected 200/400/401/404/503 boundary results.
- Qualification release `44e3f36b247b8a04b33bb15c8307ab83ee7fc095` passed CI run `31502437584` and
  staging deployment run `31502710837`; Worker version `b1abb7c9-293e-47ef-9bb9-ca48e9a714b0` is at
  100% traffic. The exact-version API qualification passed, with only the expected GitHub-hosted
  runner custom-domain warning. The live LCC resource replacement check succeeded and the temporary
  fixture was removed.
- Remote CI run `31350379266` passed all static, contract/parity, unit, build-artifact, Workerd, and
  browser-E2E jobs for `11e3f71`.
- A fresh August 10 local `npm run check:ci` rerun passed all 13 mirrored CI steps: high-severity
  dependency audit, lockfile verification, formatting, lint, strict workspace typecheck, contract
  export snapshot, both parity checks, 206 unit tests, deployable build, release-manifest
  verification, and 192 prepared Workerd integration tests. The browser E2E job is not part of this
  mirror; a fresh August 10 local Chromium run passed all 90 desktop/mobile tests.
- A fresh August 11 local `npm run check:ci` rerun again passed all 13 mirrored CI steps, including
  206 unit tests, the deployable build and release-manifest round-trip, and 193 prepared Workerd
  integration tests. The follow-up `npx playwright install chromium && npm run test:e2e` run passed
  all 92 desktop/mobile Chromium tests. No hosted resource or deployment was changed by the local
  verification run.
- After the user reported completing Platform Administrator verification, a read-only reinspection
  of the preserved Platform Security tab still showed the factor gate and `Verify Platform access`,
  with no active-session status. No factor was entered or exposed in this run; Platform-only
  qualification remains open until the tab visibly reports an active session.
- Staging release run `31350509541` uploaded and deployed the immutable artifact at 100% traffic,
  verified the Email Sending subscription, applied migrations and non-versioned triggers, and
  qualified the exact `BUILD_VERSION` with direct Worker probes. Its four custom-domain probes were
  blocked by the GitHub-hosted runner's Cloudflare edge rule; the same product, `lcc`, and `lmc`
  probes passed from an interactive network with the exact current version.
- The staging Email Sending subscription read-back is enabled as `staging-email-feedback`, uses the
  `email.sending` source for `mail.staging.musicsite.org`, targets a queue, and contains all six
  delivery-feedback events: delivered, deferred, bounced, failed, rejected, and complained. The
  staging feedback queue and dead-letter queue each have an active Worker consumer. This verifies
  configuration and routing, not the full provider event matrix.
- A read-only remote D1 check found two active Organizations (`lcc` and `lmc`), both at operational
  schema 39, all 14 control-plane migrations applied, and active canonical domains. No migration or
  production resource was changed by this verification pass.
- The documented read-only Parity Bridge checkout is absent from this execution environment. The
  pinned baseline hash remains recorded, but no new baseline source comparison was performed in this
  pass.
- The staging evidence plan maps all 72 implemented API entries into 14 authenticated reads, 19
  validation probes, one intentional fail-closed Stripe probe, 27 fixture-backed flows, and 11
  Platform Administrator/elevation flows. The live authenticated probe run was not started because
  no staging session cookie was supplied to the shell; no cookie was copied from the browser or
  recorded. A fresh staging browser tab also resolved to the sign-in boundary, so no OTP or other
  credential was entered. No matrix status was promoted on plan-only evidence.
- A fresh local traceability audit found all 314 concrete File Responsibility Map paths and all 238
  unique parity target-evidence paths present in the repository. The map contains 328 references
  total; fourteen are intentionally grouped brace/glob patterns rather than individual files and
  were retained as documentation patterns. The audit corrected one stale RSVP target path in the
  matrix; no runtime behavior was changed.
- A source, dependency, and URL scan across `apps`, `packages`, `scripts`, manifests, and build
  configuration found no PocketBase/legacy-platform imports, dependencies, legacy API calls, or
  legacy hostnames in the executable build. The only remaining legacy term is a non-executable
  baseline-ordering comment in the donation CSV domain helper. This confirms standalone runtime
  coupling is absent; it does not replace behavioral parity evidence.
- A strict-source scan found no `any` type escapes, `as any`, `@ts-ignore`, or `@ts-nocheck` in
  executable code. The only file-wide lint disable is in Wrangler-generated type declarations;
  application suppressions are line-scoped rule exceptions. The three `dangerouslySetInnerHTML` uses
  all consume the shared escaped Markdown renderer, whose focused security tests passed for markup
  escaping and rejection of non-HTTP links. This supports the source-hygiene gate without replacing
  a broader browser security review.
- On August 10, an authenticated browser session verified the Platform Administrator TOTP factor and
  loaded the read-only `/platform`, `/platform/organizations`, `/platform/access`,
  `/platform/dead-letters`, and `/platform/email-suppressions` surfaces. The Platform overview
  refresh reported the exact deployed build, two Organizations, completed Platform Administrator
  MFA, sandbox Email Sending, eight existing background jobs requiring review, and the expected
  unavailable Stripe configuration. The two dead-letter and email-suppression route entries are now
  promoted to `verified`. The same session loaded Account overview, Organization memberships,
  password settings, active sessions, and the LCC/LMC Organization Admin summaries on their
  hostname-scoped hosts without a cross-host data response. The first Platform overview navigation
  briefly rendered its loading-time access-denied state before settling on the correct overview
  after the auth check completed; no persistent access failure remained on refresh.
- The current August 11 Platform Security tab still shows the fresh-factor form after reload rather
  than an active 15-minute Platform Administrator session. No one-time code was copied into the
  repository or entered by the agent, so additional Platform-only verification remains pending an
  interactive factor assertion in that tab.
- The same Platform factor-gate UI has one labeled `one-time-code` input, a visible Verify control,
  no alert, and no horizontal overflow at 390px (375px document/body width). The empty control was
  not submitted.
- An August 11 LCC Account Security validation pass entered local-only dummy credentials with a
  seven-character new password. Change password returned the typed error
  `Use a password between 12 and 128 characters.` on the same route, with no password mutation or
  external authentication effect.
- An August 11 signed-in Account Organizations pass showed exactly two Organization Membership
  entries, each linking to its own canonical Organization host. No membership or Organization switch
  was activated; at 390px the account page remained within the 375px document/body width.
- An August 11 signed-in Account Sessions pass rendered the active-session list with the explicit
  notice that session tokens are not displayed or saved, plus separate Revoke session and current
  browser sign-out controls. No session action was invoked; the page had no alert or horizontal
  overflow at 390px.
- An August 11 LCC password-recovery validation pass entered a local-only malformed email. Send
  reset link left the recovery route in place, marked the email invalid, and showed no generic
  alert, reset request, or outbound notification.
- A fresh August 10 read-only browser sweep loaded all 26 static Organization Admin routes on both
  `lcc.staging.musicsite.org` and `lmc.staging.musicsite.org` without router errors or visible alert
  states. LCC seating settled into its populated workspace after a longer initial load, and a
  follow-up read-only member/public sweep loaded 19 static routes on each host. The expected
  no-projection `Website unavailable` states appeared for `/history` and `/performances`, invalid
  `/unsubscribe` links showed their typed invalid/expired state, and LCC's audition page settled
  from loading to the inquiry form after the data request completed. No form submission, upload,
  export, payment, refund, message, or other state-changing action was triggered.
- The same authenticated LMC session exercised the read-only Reports tabs (including Music Folder
  Report), Ticketing panels (bundles, orders, discounts, sharing, and confirmation), and
  Communications panels (drafts, history, templates, upcoming sends, and settings). Each tab panel
  rendered its expected heading or empty state without a load-error alert. These are UI/query
  observations only; no report export, message send, ticket action, or settings save was attempted.
- An August 11 LCC export-control pass found an enabled `Start Organization export` control with no
  active export status, an enabled RSVP `Export CSV` control, and an enabled RSVP report export tab.
  Music Folder Report `Export CSV` remained disabled until a Performance is selected. No export job,
  download, or report action was activated.
- A read-only August 11 LCC RSVP pass activated the existing `Export CSV` link from the signed-in
  manager. The browser stayed on the RSVP page with no alert or record change; the browser surface
  did not expose the downloaded bytes or response headers, so CSV byte/header/date/enumeration
  compliance remains unverified and no CSV evidence was promoted.
- A subsequent August 11 LCC RSVP export pass captured the browser download in a temporary
  authenticated tab and inspected only its metadata. The CSV contained 100 data rows plus a header
  with the expected five columns (`Name`, `Section`, `Performer`, `Event Title`, and `RSVP Status`).
  The generated local copy was moved to the system Trash after inspection; no member values were
  recorded, and the full CSV contract remains unpromoted.
- A subsequent August 11 LCC Roster export pass captured the manager-visible CSV download and
  inspected only its metadata. It contained 97 data rows plus a header with the expected five
  columns (`Name`, `Email`, `Phone`, `Performer`, and `Status`). The generated local copy was moved
  to the system Trash after inspection; no member values were recorded, and the full roster CSV
  contract remains unpromoted.
- A subsequent August 11 LCC Music Library export pass captured the manager-visible CSV download and
  inspected only its metadata. It contained 34 data rows plus a header with the expected 11 catalog
  columns (`Title`, `Composer`, `Arranger`, `Copies`, `Catalog ID`, `Duration`, `Voicing`,
  `Applies To`, `Genres`, `Purchase Date`, and `Notes`). The generated local copy was moved to the
  system Trash after inspection; no catalog values were recorded, and the full library CSV contract
  remains unpromoted.
- An August 11 LCC Repertoire report export pass also produced a temporary CSV with 34 data rows
  plus the expected five-column header (`Title`, `Composer`, `Arranger`, `Performances`, and
  `Last performed`). The generated local copy was moved to the system Trash after inspection; no
  repertoire values were recorded, and the full repertoire CSV contract remains unpromoted.
- An August 11 LCC Donations export pass produced a header-only CSV because the staging Organization
  has no donation rows. Its seven columns were `Donor`, `Email`, `Amount`, `Processing fee`,
  `Tribute`, `Status`, and `Date`; the generated local copy was moved to the system Trash after
  inspection, and the populated donation CSV contract remains unpromoted.
- An August 11 LCC Roster and Music Library import validation pass opened both CSV dialogs. With no
  file chosen, each `Import CSV` action was disabled; Cancel closed each dialog without an alert or
  record change. No local file was uploaded and no import transaction was started.
- A direct authenticated API sweep was not promoted from this browser pass: the browser's read-only
  page evaluator does not expose `fetch`, and direct navigation to an API URL is blocked by the
  browser client. No cookies were inspected, no API response body was copied, and no API status was
  inferred from this failed probe.
- An August 10 responsive staging pass at a 390px viewport loaded LMC Reports, Music Folder Report,
  Ticketing Discount Codes, Communications Templates, and Seating panels with their expected
  headings and tab panels, no visible load-error alerts, and a 375px document/body width within the
  390px viewport. The explicit viewport override was reset afterward. This is narrow-layout evidence
  only; full keyboard, touch, focus, and form-flow responsive coverage remains represented by the
  local browser tests until broader staging capture is available.
- An August 11 responsive pass at the same temporary 390px viewport loaded LCC Organization
  Settings, Roster, Attendance, Ticketing, My Profile, Dashboard, and My Schedule with a main
  landmark and no alert on every route. Each route remained within a 375px document/body width, with
  no horizontal overflow; the viewport override was reset and the temporary tab closed afterward.
- A further August 11 LCC responsive pass loaded Resources, Set lists, Auditions, Polls, and Events
  at 390px with main landmarks, no alerts, and 375px document/body widths. Public Website rendered
  without an alert but extended to 416px: the public-site panel/form overflow was caused by a
  visible `white-space: nowrap` label (`Use this header and footer on public transaction pages`). No
  control or draft was changed, and the viewport override was reset afterward.
- An August 11 LCC public responsive pass loaded Home, History, Performances, Tickets, Donations,
  Auditions, and the invalid RSVP-link boundary at 390px without alerts or horizontal overflow. The
  expected `Website unavailable`, `Tickets`, `Support our Music`, `Audition Inquiry`, and
  `RSVP Link Required` headings rendered; the Donations page had no native `<main>` or
  `[role="main"]` landmark, so that remains a public accessibility candidate. No public form was
  submitted.
- An August 11 LCC public checkout-label pass found all visible Donation and Audition fields labeled
  and no alerts. Auditions had no overflow; Tickets had no available event form. Donations exposed
  an internal 12px overflow in the level grid: the `Benefactor` option's 177px content width
  exceeded its 165.5px card, and the narrow section scrolled to 355px from a 343px client width. No
  donation, inquiry, or ticket submission was made.
- An August 11 LCC public donation-checkout validation pass clicked `Complete donation` with the
  default level selected and donor fields empty. Native required validation marked Name, Email, and
  Confirm email invalid with no alert, navigation, payment, or notification. At 390px the page
  remained 375px wide; the previously noted donation-level internal overflow remained present.
- An August 11 LMC ticket-catalog pass found an existing `Buy tickets` link and opened its event
  form at 390px. Name for will call, Email, Confirm email, Quantity, and the updates checkbox were
  all labeled; `Complete ticket order` was present, with no alert or horizontal overflow. No order
  data was entered and checkout was not submitted.
- An August 11 LMC public ticket-checkout validation pass clicked `Complete ticket order` with all
  buyer fields empty. Native required validation marked Name, Email, and Confirm email invalid, kept
  the event URL in place, and showed no generic alert or external submission. At 390px the form
  stayed within a 375px document/body width and the checkout button fit the viewport.
- An August 11 LCC direct public RSVP-route probe at 390px rendered the public home shell rather
  than an RSVP form, with no alert, controls, or overflow. Because no valid public RSVP invitation
  link was exposed by the current staging data, the responsive RSVP form remains unverified; no RSVP
  action was taken.
- An August 11 LCC Communications mobile pass loaded the audience step at 390px with labeled
  channel, audience, status, voice-part, and event controls and no overflow or alert. Continuing
  locally to Compose exposed a responsive defect: the 314px composer grid allocated only about 10px
  to `.communication-composer__panel` while the placeholder aside received 288px, collapsing the
  message editor and toolbar. The source grid still requires a 14rem minimum second column; no
  draft, preview, or send action was used.
- An August 11 LMC Season Dues measurement found the dues card at 80px tall at the normal viewport
  and 249px tall at 390px, where its grid intentionally stacks the title, amounts, and action into
  one column. The narrow view had no horizontal overflow or alert; the viewport override was reset
  afterward. The height increase is a responsive presentation tradeoff rather than a layout
  overflow.
- Existing-link inspection found the public audition page and internal event RSVP links, but no
  already-issued valid player, poll, calendar, unsubscribe, or email-change signed link exposed by
  the current admin data. No token was generated and no signed-flow status was promoted.
- An existing ticket-sales-enabled Performance exposed its public ticket-page link, Copy link
  control, QR-code image, and Download QR code control in the read-only event editor. Opening the
  public ticket page rendered the Performance title, quantity control, and Complete ticket order
  action on desktop and at 390px with a 375px document/body width inside the viewport. No order was
  submitted and the QR artifact was not downloaded.
- An August 11 LCC Ticketing Share & QR Codes pass exposed public ticket links for the ticketing
  landing page and an event, with accessible QR images and Copy link/Download QR code controls. No
  link was copied, QR artifact downloaded, or ticket setting changed.
- An August 11 LCC Ticketing Confirmation Page pass exposed four labeled buyer-facing wording fields
  and an enabled Save ticket wording control. The panel had no alert or overflow; no wording was
  edited or saved.
- A read-only LMC interaction pass confirmed the Roster profile dialog remains open when switching
  to Messages and Folder numbers, with the expected empty-message state and per-event folder-number
  controls. Escape closed the dialog without saving. Roster search/sort, RSVP No response and
  History search/sort, and Attendance Present/search filters all updated their visible rows without
  changing RSVP or attendance state.
- A staging Polls pass toggled `Show archived polls` without the previously reported load-error
  alert and retained the poll table. The Events list exposed Edit as the primary action and an
  accessible overflow menu containing Clone, Cancel, and Archive; Escape closed that menu without
  triggering an action.
- The signed-in LMC Profile page exposed the email-change form and explicitly stated that the new
  address receives a confirmation link, the current address receives a notification, and the change
  takes effect only after confirmation. The form was not submitted. LMC Setup Checklist reported
  setup complete, sandbox external effects, Stripe not configured, and Cloudflare Email Sending
  configured; the Stripe connect action remained disabled pending Platform-managed credentials.
- An August 11 LCC Profile pass showed the required `New sign-in email` field populated with the
  current address, the old/new-address confirmation guidance, and an available Change email control.
  The request was not submitted because it would send staging notifications and require a real
  confirmation link; the valid email-change success path remains unverified.
- An August 11 LCC mobile Profile pass at 390px kept the required New sign-in email field, current
  address guidance, and Change email control labeled and within the 375px document/body width. The
  new-address confirmation/current-address notification explanation was visible; no email change was
  submitted.
- An August 11 LCC Profile validation pass entered a local-only malformed email value and activated
  Change email. The browser kept the Profile route in place, marked the email control invalid, and
  showed no generic alert, confirmation dialog, notification, or account change. The original local
  draft value was restored before closing the temporary tab.
- An August 11 LMC member-dashboard pass found an enabled Decline control on the first upcoming
  rehearsal while older/closed events remained disabled. Opening the decline dialog placed focus
  inside a labeled/described dialog; its required note left `Decline rehearsal` disabled when empty,
  enabled it after local-only text entry, and Cancel closed the dialog without an alert or RSVP
  change. No attendance or RSVP submission was made.
- Malformed signed-link probes on LCC Player, RSVP, Poll, Unsubscribe, and email-change routes, plus
  the LMC RSVP route, all failed closed with their typed invalid/expired-link alerts and no form,
  input, audio, or video surface. No valid token was generated, entered, or recorded.
- Roster automation, Auditions inquiries/settings, and Seasons & Dues records/settings rendered
  their expected controls and empty states without load errors. Auditions also exposed its public
  signup link and QR image. No Save, Delete, Generate, Invite, Schedule, or other state-changing
  action was used during this pass.
- A console health scan of 14 representative signed-in pages across both seeded Organization hosts
  (`/admin`, Reports, Ticketing, Communications, Seating, Polls, and Profile) recorded zero console
  errors and zero warnings. Only counts and source URLs were inspected; console payloads were not
  copied or recorded.
- A browser tenant-isolation check opened the known LMC ticket page successfully, then opened the
  same event path on LCC. LMC rendered its event-specific ticket page; LCC rendered only its generic
  `Ticket sales are closed for this performance` boundary without the LMC title or ticket details.
  Both reads produced zero console errors and warnings, and no checkout was started.
- Later in the same browser session, the bounded 15-minute Platform Administrator elevation expired:
  `/platform/security` returned to its fresh-factor form and `/platform` reported that setup status
  could not be loaded until MFA is verified again. Organization-host access remained signed in and
  loaded normally. No MFA code was entered or recorded by the agent; further Platform-only checks
  require a fresh user-entered factor.
- On the resumed August 10 session, the user supplied a fresh TOTP factor in the browser. Platform
  overview refresh, security, Organization directory, scoped-access boundary, dead letters, and
  email suppressions all loaded with Platform access ready and no actual alert/error state. Email
  suppression sorting worked, and dead-letter Retry/Dismiss controls were present; neither action
  was invoked.
- The same Platform session exercised dead-letter Refresh and the `All records` display filter, plus
  email-suppression Updated sorting and the `All records` filter. Each read-only interaction
  completed without an alert; Retry, Dismiss, and Release block actions were left untouched. The
  temporary Platform filter tab recorded zero console errors and warnings.
- Platform Organization operations reported deployed schema version 68, latest preparation
  completed, and two Organizations prepared. The scoped-access page correctly displayed its
  host-selection boundary while on the product base host. Organization name/hostname creation,
  schema preparation, and scoped access selection were not invoked; the operations page recorded
  zero console errors and warnings.
- Requests for `/platform` from both `lcc.staging.musicsite.org` and `lmc.staging.musicsite.org`
  redirected to the product base host before rendering Platform Admin. Neither Organization host
  rendered Platform content, and both redirects recorded zero console errors or warnings.
- On August 11, the signed-in LCC Set lists surface rendered the selected Performance,
  copy-from-previous selector, approval controls, three ordered items with keyboard movement
  actions, and the `All changes saved.` status. A screenshot check at the current viewport showed
  the workspace navigation in a single grouped column with the active Set lists entry; no Save,
  reorder, copy, approval, player, print, or other state-changing action was invoked.
- On August 11, the signed-in LCC Reports surface loaded 93 RSVP responses with sortable report
  columns and an enabled `Export CSV` control. Its Music Folder Report accepted two visible
  Performance selections, showed `2 Performances selected`, enabled its export control, and
  displayed the expected zero-assigned-folder summary without an alert. The selections were cleared
  afterward. The browser client did not expose a download event for the CSV, so no CSV contract or
  file-behavior status was promoted from this interaction.
- The same signed-in LCC Reports session rendered the combined `Donations & Ticket Sales` panel. Its
  `Donations`, `Ticket sales`, and `Both` filters each became active and displayed the corresponding
  empty state (`No donations have been recorded`, `No ticket sales have been recorded`, or the
  combined message) without an alert. No payment, refund, or export action was invoked.
- An August 11 LCC mobile Donations & Ticket Sales pass at 390px kept the `Both`, `Donations`, and
  `Ticket sales` filters within the report width with no alert or overflow. Each filter became
  active in turn and displayed its matching empty state; no payment, refund, or export action was
  invoked.
- An August 11 LCC Music Folder Report default-state pass showed three available Performances in
  reverse chronological order, each visibly marked `No assigned folder`. None was selected and the
  report export remained disabled until selection; no folder or report state was changed.
- An August 11 LMC Music Folder Report pass selected both available Performances and showed the
  expected summary of 2 assigned, 1 returned, 1 outstanding, 0 not assigned, and a 50.0% return
  rate. The profile row used a chevron control labeled `Expand test 1`; its `aria-expanded` state
  toggled true and back to false when expanded and collapsed. No profile or folder data was edited.
- An August 11 LMC Music Folder Report mobile default-state pass at 390px showed two unchecked
  Performance options (one assigned folder each), a disabled `Export CSV` control until selection, a
  375px document/body width, and no alert or overflow. No performance was selected or edited in this
  mobile read.
- An August 11 LMC Music Folder Report export pass opened the Performance picker, selected one
  Performance with an assigned folder, and captured a CSV containing one data row plus the expected
  seven-column header (`Profile`, `Performance`, `Performance Start`, `Performance State`,
  `Folder Number`, `Folder Return Status`, and `Returned At`). The generated local copy was moved to
  the system Trash after inspection; no profile or folder values were recorded, and the full report
  CSV contract remains unpromoted.
- A follow-up LMC Music Folder Report interaction probe found the visible Select all/Clear all
  action bar extending about 15px below its report panel; the button center resolved to the wrapping
  panel in the browser hit-test, and the temporary browser could not activate either selection
  control. No performance, folder, or export state changed. This is a candidate layout/interaction
  defect for visual review, not a promoted report-behavior result.
- The signed-in LCC Attendance surface opened a custom confirmation for `Mark remaining present`;
  the warning stated that five RSVP-Yes performers would be changed and that the action may be
  difficult to undo. Cancel closed the dialog with no alert and preserved `Unmarked 5`, `All 9`,
  `Present 4`, and `Absent 0`.
- An August 11 LMC Attendance pass kept non-RSVP performers hidden while the search was empty. A
  search for the known test performer revealed one row under the `Not currently RSVP'd` divider;
  activating its attendance toggle opened the custom `Mark unexpected attendee present?` reminder
  explaining that Present will also RSVP the performer Yes; Cancel closed it with the row still
  non-RSVP. Keyboard-clearing the search hid that row again, and no alert appeared.
- An August 11 LMC Attendance mobile pass reproduced the same rescue boundary at 390px: the empty
  search showed zero rows, `test 1` revealed one labeled non-RSVP row, and keyboard-clearing
  restored zero visible rows. The document/body remained 375px wide with no alert; no attendance
  toggle was activated.
- The signed-in LCC Events editor showed no save bar until a local title draft was changed; the edit
  then revealed a sticky bottom `event-editor-save-bar` with Cancel and Save event controls. Cancel
  discarded the local draft, closed the modal, preserved the event title `test`, and left no alert.
  No server save occurred.
- An August 11 LCC mobile Event editor pass changed only a local title draft at 390px and exposed a
  309px-wide sticky save bar 112px tall with visible Cancel and Save event controls. The dialog and
  document had no actionable overflow or alert; Cancel discarded the draft and closed the editor. No
  event save occurred.
- An August 11 LCC Event editor pass found the Public graphic control rendered as a styled
  `.event-graphic-dropzone` label with a dashed border, pointer cursor, and explicit
  `Drag and drop an image here, or browse` guidance. Its helper text listed PNG, JPG, and WebP
  support. Escape closed the editor without selecting a file or saving.
- The signed-in LCC Events list opened the first row’s overflow menu and exposed Clone, Cancel, and
  Archive. Choosing Cancel opened the destructive confirmation with `Keep event` and `Cancel event`
  actions; Keep event dismissed it with no alert or state change. Choosing Archive likewise opened
  an `Archive event?` confirmation with `Archive event` and Cancel; Cancel left the row unchanged
  with no alert. Neither action changed event state.
- An August 11 LCC Events action-link pass found the primary event action labeled `RSVP`; its target
  was `/admin/rsvp?eventId=...` with a non-empty originating event identifier. The link was
  inspected without opening it, and no event or RSVP state was changed.
- An August 11 LCC RSVP selector pass found the Performance control rendered with the browser-native
  select appearance and pointer affordance, with four performance options and a visible enclosing
  `Performance`/`Choose performance` label. The route had no alert; no performance selection
  changed.
- The signed-in LCC Communications compose step opened with `No template selected`; its template
  dropdown contained only Dues Payment Notice, Dues Payment Receipt, and General Announcement.
  Audition and donation receipt templates were absent from the compose options while remaining
  visible in the separate Templates tab as system templates for automated messages. No draft was
  edited, saved, queued, or sent.
- An August 11 LCC Communications audience-preview check selected Members, Ticket Buyers, and
  Donors, invoked only `Preview audience reach`, and retained all three selections afterward while
  showing the zero-reachable summary. Continuing to Compose and returning to Audience also retained
  all three selections. No message draft, queue, send, or other external effect was triggered.
- An August 11 LCC Communications compose check entered local-only subject/message text, then
  selecting a template opened the custom `Replace current draft?` warning. Cancel preserved the
  unsaved draft and left `No template selected`; no draft was saved or sent.
- The signed-in LCC Polls create form required an expiration and defaulted it to three days from the
  current time. The form was cancelled without saving. Toggling `Show archived polls` displayed six
  archived poll rows without an alert; returning the checkbox to unchecked restored the active view
  with no rows and no load error.
- An August 11 LCC mobile Poll create-dialog pass at 390px fit at 358px wide with a 16px inset, kept
  focus inside, exposed labeled required Title, Expiration, Option 1, and Option 2 fields, and
  defaulted expiration to August 14—three days after the August 11 check. No alert or internal
  overflow appeared; Cancel closed it without saving.
- An August 11 LCC archive-filter read showed all six archived rows carrying an expiration of July
  29, 2026, while the active view remained empty. The dates are consistent with the two-day archive
  retention rule, but the browser has no creation/closure timeline proving the exact scheduler
  transition; no archive status was promoted from this corroborating read.
- The signed-in LCC RSVP manager showed the separate `No response (0)` view with an empty filtered
  roster and exposed an 85-record History table with search and sortable headers. Searching for
  `Nathan` reduced History to one row, keyboard-clearing restored all 85 rows, and sorting changed
  the `Previous RSVP` header to ascending. The LCC Ticketing page had no order rows, so no refund
  confirmation was available to inspect.
- An August 11 LCC RSVP manager mobile pass loaded the No response tab and History at 390px with no
  alert or overflow. History rendered 85 labeled cards; searching `Anna` reduced the result to four
  cards and Meta-clearing restored all 85. The mobile History view exposed the filter but no visible
  sortable header/button or `aria-sort` control, so mobile sortability remains a candidate while
  desktop sorting is verified. No RSVP state changed.
- A read-only LMC Ticketing pass also loaded without an alert but exposed zero order rows and no
  refund controls. The refund confirmation and free-order behavior therefore remain unverified
  because the current staging data has no order to inspect; no refund action was attempted.
- An August 11 LMC mobile Ticketing pass at 390px also rendered the Ticketing surface at a 375px
  document/body width with no alert or horizontal overflow. It exposed the expected ticketing panels
  but still had zero order rows and no refund control, so no refund action was attempted.
- An August 11 LCC Season Bundles validation pass opened New ticket bundle and attempted Save bundle
  with all required fields empty. Title, price, and sale-end controls remained invalid, the dialog
  stayed open, and its close control dismissed it with zero bundle rows and no alert.
- An August 11 ticketing pass opened the LCC Discount Codes tab without an alert; it showed no
  existing codes and exposed a New discount code form with required code, performance, and value
  fields plus percentage/fixed and activation controls. Cancel closed the form without saving. The
  existing LMC public ticket page rendered the ticket form and Complete ticket order control without
  a discount field because no redeemable code is published for that performance; no checkout was
  submitted.
- A follow-up LCC Discount Codes validation pass selected a local-only eligible item, entered an
  invalid percentage of zero, and attempted Save discount code. Native validation kept the dialog
  open with the percentage control invalid; Cancel closed it with zero rows and no alert or saved
  code.
- The signed-in LCC Seating surface loaded five chart options without an alert. The selected native
  chart control and its options used light text on a dark background (`rgb(248, 250, 252)` on
  `rgb(30, 41, 59)`), and a screenshot confirmed readable dark-mode selector text. No chart was
  created, renamed, deleted, reordered, or otherwise changed.
- An August 11 LMC New seating chart dialog defaulted `Singers to place` to the two RSVP-Yes singers
  for the Performance and `Rows` to two, then updated the live summary to two singers per row after
  changing rows to one. Editing the singer count to one also updated the summary immediately. Cancel
  closed the dialog with no alert or new chart; no chart was created.
- An August 11 LCC Seating New-chart dialog check at 390px fit within a 358px dialog with a 16px
  inset, kept focus inside, and had no alert or internal overflow. It defaulted to nine RSVP-Yes
  singers across three rows; local changes to eight singers and two rows updated the live summary to
  four singers per row. Cancel closed it without creating a chart.
- An August 11 dark-mode native-select scan across LCC RSVP, Seating, Communications, Polls,
  Seasons, Schedule, and Dues found 13 visible selects. Every control had a label/ARIA association,
  every route was alert-free, and all inspected option text used the readable light-on-dark palette;
  no additional dropdown contrast defect was found. No selection was changed.
- A follow-up LCC Seating read inspected the selected chart control and its native options directly;
  both used the dark color scheme with light text and a dark option background. The selected chart
  remained unchanged and the route had no alert or overflow.
- The signed-in LCC Roster profile dialog showed three separate Folder numbers rows, one per event,
  each with its own folder-number field, returned checkbox, and Save control; no bulk mark-all
  action was present. Switching to Messages kept the dialog open and showed its empty state. Closing
  the dialog left no alert and no save.
- An August 11 LCC Roster pass opened with `Name ↑` as the default sort across 93 interactive rows.
  The first profile’s Folder numbers tab listed three event rows newest-first (Aug 11, Aug 9, and
  Jul 31), each with independent folder-number text, returned checkbox, and Save control. Escape
  closed the profile without changing any folder state.
- A fresh LCC Roster Settings pass exposed separate Settings and Roster automation tabs. The
  automation tab selected normally and showed scheduling/status content without an alert; no roster
  or automation control was changed.
- The signed-in LCC Music Library search reduced 35 catalog pieces to one `America` result and
  restored the full list after clearing. Its genre picker exposed OR/AND modes and per-genre counts;
  selecting Patriotic showed exactly five matching pieces, and Clear restored all 35 without an
  alert. No piece editor, import, upload, or export action was used.
- The signed-in LCC Organization Security page loaded without an alert and stated that the
  Organization is selected by the validated hostname and that MFA assertions are bound to the
  Organization, identity, and browser session. Its current policy was `MFA not required`; the
  `Require MFA for this Organization` control was visible but not invoked.
- The signed-in LCC Auditions surface loaded the public signup link, QR controls, inquiry table, and
  Settings tab without an alert. Settings showed the target Performance, venue, confirmation
  message, four existing time slots, administrator-notification checkbox, and Cancel/Save controls;
  Generate, Add, Remove, and Save actions were not invoked.
- The signed-in LCC Seasons & Dues surface loaded the active `testing` season with two refunded
  `$0.00` covered records without an alert. Searching `Abby` reduced the dues table to one row and
  keyboard-clearing restored both records. Settings exposed sortable season columns and Edit/Delete
  controls; none was invoked.
- An August 11 LCC Season Settings pass opened Add season and attempted Create season with all
  fields empty. The name control remained invalid and the typed `Enter a season name.` validation
  appeared; Cancel closed the dialog with the existing season row unchanged and no alert afterward.
- The signed-in LCC Resources page showed one Organization-shared file with move, edit, and delete
  controls. Its edit dialog enforced exactly one source—HTTPS link or replacement file—and Cancel
  closed it without changing the row or showing an alert. No file was downloaded, uploaded,
  replaced, or deleted.
- The signed-in LCC Public Website editor loaded without an alert and showed private draft fields,
  font selectors, optional logo/hero uploads, public navigation-module toggles, and separate Save
  draft/Publish saved draft controls. No draft or publication action was invoked.
- The signed-in LCC Modules page loaded without an alert and showed People, Events, and Programs
  enabled. All three module checkboxes remained unchanged.
- An August 11 read-only LCC Setup Checklist pass loaded without an alert and reported four of five
  steps complete, with optional existing-data import remaining available, staging sandbox provider
  status, configured Email & SMS, and a not-connected Organization Stripe account. No import or
  payment-connection action was invoked; at 390px the document and body remained 375px wide with no
  horizontal overflow.
- The signed-in LCC Organization Settings page loaded without an alert and showed Stripe
  `not started`, a webhook needing setup, Organization email `Ready`, the three payment module
  statuses, transaction-fee values, and timezone `America/New_York`. No settings or export action
  was invoked.
- The signed-in LCC Membership Invitations page loaded without an alert. It exposed the invite email
  and Organization Membership role controls, stated the eight-day expiration and invited-email
  sign-in requirement, showed no pending invitations, and rendered the Organization Profile-link
  list with the current Owner role and a disabled Link Profile control until a profile is chosen. No
  invitation, role change, profile link, or other state-changing action was invoked.
- An August 11 LCC Membership Invitations validation pass entered a local-only malformed email and
  activated Create invitation. The invitation email control was marked invalid on the same route
  with no generic alert, pending invitation, or outbound email.
- The signed-in LCC Setup Checklist loaded without an alert and reported four of five steps
  complete, with the remaining CSV import explicitly optional. Its provider boundary showed staging
  sandbox effects, Cloudflare Email Sending configured, Stripe not configured, and a disabled Stripe
  Connect control with the explanation that Platform Administrator credentials are required. No
  import, provider setup, or payment action was invoked.
- The same signed-in LCC session loaded the Organization Admin overview and confirmed its
  hostname-scoped navigation, summary counts, quick actions, and linked management surfaces. The
  read-only `/admin/patrons` route rendered the Donations and Giving manager and its empty Patron
  summaries disclosure; `/admin/donations` rendered the same manager with the expected Donation
  History tabs, zero-record summary, sortable date selector, and empty-state text. Expanding the
  patron summary remained read-only and showed `No patrons yet.`; no export, payment, refund, or
  settings action was invoked. The attempted non-canonical `/admin/overview` path correctly showed
  the typed workspace not-found state, while the linked `/admin` route loaded normally.
- A read-only LCC Member workspace pass loaded Dashboard, My schedule, My Profile, and Season dues
  without an alert. Dashboard showed the declined/closed-RSVP state with Attend and Decline
  disabled; My schedule showed disabled Yes/No/Save RSVP controls, the closed-deadline explanation,
  and calendar subscription copy/reset controls. Profile showed the email-change form and
  confirmation guidance; Season dues showed one dues row and the pay-through-Stripe control. No
  RSVP, email, calendar-reset, payment, or upload action was invoked, and no signed-link bytes were
  recorded.
- The LMC schedule exposed a webcal calendar-subscription control. An in-memory fetch of its HTTPS
  equivalent returned HTTP 200 `text/calendar` with a valid Organization-scoped `VCALENDAR`; using
  the same signed value on LCC and changing its final signature character both returned typed 404
  `not_found` responses. The token was not recorded. This promotes `api.calendar-feed` and
  `signed.calendar`.
- A read-only LCC public-host pass loaded `/`, `/history`, `/performances`, and `/auditions` with a
  main landmark, no alert or not-found state, and no horizontal overflow at the current viewport. No
  public RSVP, audition inquiry, upload, or other submission was made.
- An August 11 LCC Audition Inquiry validation pass found required, labeled Name and Email fields;
  the empty form kept Submit Inquiry disabled and marked both fields invalid without navigation, a
  generic alert, or an external submission. The existing informational notice remained unchanged.
- From the signed-in LCC tab, opening the corresponding LMC Organization host resolved to the Men’s
  Chorus Organization Admin workspace and showed no LCC/Community Organization content. The
  cross-host read was read-only, produced no alert, and did not invoke any Organization action; the
  LCC tab was then restored.
- The LCC `/confirm-email-change` route with no token rendered its typed
  invalid/expired/already-used link message and no form or input. This records the failure boundary
  only; no email-change request was submitted and the valid confirmation path remains unverified.
- Tokenless LCC `/unsubscribe`, `/rsvp`, `/poll`, and `/player` requests failed closed. Unsubscribe
  exposed its typed alert; the RSVP, Poll, and Player surfaces rendered their link/token states with
  no form, input, media element, or not-found route. These are failure-path observations only; no
  valid signed token was generated, entered, or recorded.
- The same LCC member session loaded Practice, Member Resources, and Directory without an alert.
  Practice exposed an audio track element without playback being started; Resources exposed two
  organization-file links without opening or downloading either one; Directory exposed its search
  control but no visible profile rows in the current opt-in dataset. No media, file, or directory
  state was changed.
- An August 11 read-only LCC Member Resources pass exposed one shared-file link with an accessible
  resource label. Activating the authorized file link returned to the Resources page with no alert
  or horizontal overflow and opened a separate private-file browser tab. File contents and response
  bytes were not recorded; that probe-created tab was closed without inspecting its content, and no
  resource record changed. This verifies the UI access boundary only, not the full R2 isolation
  contract.
- An August 11 LCC Practice playback pass loaded one ready private audio track with a source and no
  alert. Activating Play changed the control to Pause, kept the audio element ready and unpaused,
  and produced no overflow; playback was stopped before closing the temporary tab. No catalog,
  resource, or member record changed, and audio content was not recorded.
- A follow-up August 11 LCC Music Library playback pass activated an existing catalog Play control.
  The hidden audio element became ready with a finite duration, advanced current time while
  unpaused, and exposed no media error, alert, or overflow; playback was paused before closing the
  temporary tab. No catalog or resource record changed, and audio content was not recorded.
- The signed-in LCC Organization Admin Venues surface loaded without an alert and exposed its
  venue-management view and add control; no venue was created or edited. The Ticket Scanner surface
  also loaded without an alert with its scanner input and validation control present; no ticket
  credential was entered or scanned.
- An August 11 LCC Ticket Scanner validation pass submitted a local-only invalid credential. The
  scanner displayed the typed `Invalid ticket` / `Ticket not found or the QR code is not valid.`
  result without a generic alert, ticket-state change, or overflow.
- An August 11 LCC venue-confirmation pass opened the existing venue's custom `Delete venue?`
  confirmation. It exposed visible Delete and Cancel actions; Cancel closed the dialog with the row
  unchanged and no alert. The dialog did not expose `aria-modal`, matching the existing shared modal
  accessibility candidate; deletion was not attempted.
- A fresh read-only sweep of 23 LCC Organization Admin routes found a main landmark on every route,
  no persistent alert, and no not-found state. Twenty-two routes fit the viewport; `/admin/settings`
  is a concrete UI overflow finding: at `innerWidth` 1280, the document scroll width was 1352px and
  the overflow traced to the `#payments-settings` surface and its payment-settings
  heading/description content. The computed cause is `white-space: nowrap` on the payment
  description, matching the `.organization-payment-settings__heading .section-description` rule in
  `apps/web/src/styles/components/platform-operations.css`. No code or settings were changed while
  isolating this finding. The same route on LMC at the same viewport had no overflow because its
  available main-content width was larger, so this is specifically a narrow/pinned-navigation
  responsive defect rather than Organization data.
- A targeted internal-overflow scan found the LCC Music Library table uses an intentional
  `overflow-x: auto` container, and the long schedule calendar URL is confined to its input. Seating
  has a second UI finding: `.seating-toolbar__view-actions` and its idle save-status span extend
  about 51px past the `.seating-workspace` card while `overflow-x` remains `visible`, so view
  controls/status may be clipped with the pinned navigation. LMC has the same rule but enough
  available width to avoid overflow, confirming the narrow/pinned-navigation layout cause. No
  seating control was changed.
- A current August 11 LCC Seating recheck at a 940px viewport found document/body width 1,259px
  against a 925px client width. The seating workspace and secondary toolbar each retained roughly
  367px of child overflow while their parent `overflow-x` remained `visible`; the inner canvas had
  its own horizontal scroller, but that scroller did not contain the full layout overflow. At
  1,280px the residual document overflow was 6px. No chart or seat control was changed.
- A targeted internal-overflow scan of LCC Attendance, Roster, Membership Invitations,
  Communications, and Reports found no visible overflowing elements or document overflow. No control
  was activated during this layout check.
- An August 11 LCC mobile overflow sweep covered Venues, Directory, Membership Invitations, Patrons,
  Donations, Organization Settings, Organization Security, Modules, and Library Settings. All had
  375px document/body widths and no alerts except Organization Settings, whose Payments surface had
  a 3–19px internal overflow from `checkbox-row { white-space: nowrap; }` on the Tickets, Donations,
  and Dues descriptions. No setting was changed.
- A read-only accessibility scan of LCC Organization Settings, Seating, Roster, Communications, My
  Schedule, and My Profile found no unlabeled buttons and no unlabeled form controls by native label
  or ARIA association. No control was activated.
- An August 11 expanded accessibility scan of LCC Admin overview, Events, Auditions, Resources,
  Music Library, Ticketing, Polls, Seasons, Donations, Patrons, Public Website, and Set lists found
  zero unlabeled visible buttons and zero unlabeled visible form controls, with no alert on any
  route. No control was activated.
- An August 11 LCC workspace-navigation layout pass found the sidebar and each navigation group
  using a single-column CSS grid. All 23 visible admin links occupied distinct vertical rows aside
  from intentional section spacing, with no alert; the previously reported flattened-row formatting
  did not reproduce. No pin/open preference was changed.
- An August 11 LCC mobile workspace-sheet pass at 390px opened a 352px sheet with a 32px Close
  control inset 16px from the top/right and no alert. The unpinned sheet exposed no visible pin
  button, `aria-label`, title, or `Pin navigation open` text, so the ability to re-pin from this
  mobile state remains a candidate. Close dismissed the sheet without changing navigation state.
- A follow-up August 11 desktop unpinned-navigation pass opened the 352px sheet, found the
  `Pin navigation open` control fully inside the top inset, and confirmed one-column links, one
  active `aria-current` entry, and no horizontal overflow. The navigation was re-pinned afterward;
  no route or Organization state changed.
- The LCC Event editor modal had a valid dialog label/description, placed focus inside the dialog,
  and dismissed cleanly with Escape. Its `role="dialog"` lacked `aria-modal="true"` and no sibling
  was marked inert; this remains a candidate modal-accessibility finding for review. No event change
  was saved.
- A read-only LCC Roster profile dialog also had a valid label/description, placed focus inside the
  dialog, and dismissed cleanly with Escape. It likewise lacked `aria-modal="true"` and did not mark
  background content inert, so the modal-accessibility candidate is shared by at least these two
  profile/editor dialogs rather than isolated to the Event editor. No profile state was changed.
- The August 11 Discount Codes create dialog also had a valid label/description and placed focus
  inside the dialog, but lacked `aria-modal="true"` and did not mark background content inert.
  Cancel dismissed it cleanly with no alert or saved code, extending the shared modal-accessibility
  finding to a third dialog family.
- The August 11 Seating chart creation dialog also had a valid label/description and placed focus
  inside the dialog, but lacked `aria-modal="true"` and did not mark background content inert.
  Cancel dismissed it cleanly, extending the shared modal-accessibility finding to a fourth dialog
  family.
- The August 11 Communications template-replacement warning also had a valid label/description and
  placed focus inside the dialog, but lacked `aria-modal="true"` and did not mark background content
  inert. Cancel dismissed it cleanly, extending the shared modal-accessibility finding to a fifth
  dialog family.
- An August 11 LCC Resources edit dialog had a valid label/description and placed focus inside the
  dialog, but likewise lacked `aria-modal="true"` and did not mark background content inert. Its
  Cancel action closed the dialog with no alert and left the single resource row unchanged,
  extending the shared modal-accessibility finding to a sixth dialog family.
- An August 11 LCC Event editor check at 390px fit the dialog within the viewport (341px wide, 16px
  side inset), kept focus inside, and showed no alert or document overflow. The dialog content was
  much taller than its 365px viewport (1,757px scroll height), with only the Close control in the
  initial view; this remains a mobile dialog affordance candidate alongside the missing
  `aria-modal="true"`. Close dismissed it without saving.
- An August 11 LCC Resources editor check at 390px also fit at 341px wide with a 16px inset, kept
  focus inside, exposed labeled Title, HTTPS link, and replacement-file fields plus visible Cancel
  and Save changes controls, and had no alert or overflow. Its 576px content still lacks
  `aria-modal="true"`/background inerting; Cancel closed it without saving.
- An August 11 LCC Add venue dialog check at 390px fit at 358px wide with a 16px inset, kept focus
  inside, exposed labeled Name and Address fields plus Cancel/Create venue controls, and had no
  alert or internal overflow. Its 455px content still lacks `aria-modal="true"`/background inerting;
  Cancel closed it without creating a venue.
- An August 11 LCC Roster profile dialog check at 390px kept focus inside and had no alert, but its
  five-tab `roster-profile-tabs` row stayed `flex-wrap: nowrap`: the 309px tab container had 427px
  of content, placing the Messages tab at about 460px—outside the 374px dialog edge. This is a
  mobile tab-overflow candidate in addition to the shared missing `aria-modal="true"`; Close
  dismissed the dialog without changing profile, folder, or message data.
- A current August 11 Roster dialog recheck confirmed that activating Messages now keeps the dialog
  open and sets the tab's `aria-selected` state to true, showing the expected empty-message state.
  The 358px dialog still has a 309px tab row with 427px of content and no `aria-modal` attribute;
  the dialog was closed without changing profile data.
- A table accessibility scan found sortable metadata on all 11 Music Library headers, all 7 Seasons
  headers, and all 6 RSVP History headers. The separate RSVP roster table has four headers (`Name`,
  `Performer`, `RSVP status`, and `Actions`) across 92 rows but exposes no `aria-sort` or sortable
  header control; this remains a candidate finding pending an intentional non-sortable-table
  rationale. No table was interacted with during the scan.
- A current August 11 RSVP manager recheck reproduced that distinction: the active roster's four
  headers remain plain non-sortable cells, while switching to History exposed six button-backed
  headers with `aria-sort` values and no alert. No RSVP response was changed.
- An August 11 broader LCC admin table scan found complete sortable metadata on Resources (3/3
  headers), Music Library (11/11), and Seasons (7/7), with no alerts. The 92-row RSVP roster remains
  the only visible data table in this batch without sortable headers; card-based Donations, Patrons,
  Communications, Reports, Events, Attendance, and Auditions surfaces exposed no HTML tables. No row
  or table action was activated.
- An August 11 LCC mobile data-table pass at 390px rendered Music Library as 35 labeled cards and
  Seasons & Dues as two labeled cards, while the RSVP roster remained its custom responsive list.
  All three routes stayed within a 375px document/body width with no alert or horizontal overflow;
  no card action, row, or filter was activated.
- A read-only LCC member/public layout scan covered 18 routes at the same viewport. Every route had
  a main landmark and no horizontal overflow or not-found state; the only alerts were the expected
  tokenless/error-boundary states for `/unsubscribe`, `/confirm-email-change`, and
  `/reset-password`. No member or public form was submitted.
- An August 11 LMC Schedule pass showed eight event cards using separate Yes and No RSVP buttons; no
  event-level RSVP dropdown was present. Linked rehearsals displayed the parent-performance
  inheritance status, and no RSVP or Save RSVP control was activated.
- An August 11 LMC mobile Dashboard decline-dialog pass at 390px fit the required Note flow inside
  the 358px dialog. An empty required note kept Decline rehearsal disabled; entering a local note
  enabled it, and Cancel closed the dialog with no alert, overflow, RSVP change, decline, or
  notification. The decline and email effects were intentionally not submitted.
- An August 11 LCC file/media-boundary pass found no alert, horizontal overflow, or unlabeled native
  control on My Profile, Public Website, or Music Library. Profile photo and public-site logo/hero
  inputs each accepted one JPEG, PNG, or WebP file; Music Library showed 35 rows and 12 visible Play
  controls without creating an audio element until playback is activated. No file was selected or
  uploaded, no website draft was saved, and no track playback was started.

Verified coverage is concentrated in browser routes and a growing set of API, CSV, file, workflow,
and responsive entries: 63/64 browser routes, 48/79 API routes, 12/23 domain workflows, and all 9/9
responsive states. All eight CSV contracts, two of five file behaviors, four of eight signed flows,
and all four record hooks are verified. The remaining 56 entries include unverified signed-flow,
file, background-task, API, and workflow evidence required by the staging gate.

The current evidence-family inventory is:

| Evidence family   | Verified | Remaining | Main missing proof                                                               |
| ----------------- | -------: | --------: | -------------------------------------------------------------------------------- |
| Browser routes    |       63 |         1 | Valid email-change success                                                       |
| API routes        |       48 |        31 | Authenticated fixtures, elevation, signed inputs, and provider paths             |
| Domain workflows  |       12 |        11 | Queue/retry, tenant-isolation, scheduler, and external-effect evidence           |
| Responsive states |        9 |         0 | No remaining responsive parity entry; broader visual review remains supplemental |
| Signed flows      |        4 |         4 | Valid, expired, revoked, cross-host, and cross-Organization tokens               |
| CSV contracts     |        8 |         0 | Browser-tool byte inspection for data-URL downloads remains supplemental         |
| File behaviors    |        2 |         3 | Profile, music-audio, and public-media upload/rendering probes                   |
| Record hooks      |        4 |         0 | Message-triggered writes and audit/idempotency evidence                          |
| Background tasks  |        0 |         5 | Scheduler, queue, retry, dead-letter, and workflow resume evidence               |

The dated sections below are an append-only historical record. Their parity counts, deployment
versions, and checkpoint claims describe the state at those dates; the current snapshot above and
the completion backlog near the end of this document are authoritative for present readiness.

## Release pipeline (implemented; first recorded August 3)

The local release pipeline now builds the Worker bundle and web assets once in CI, records the
commit, lockfile, and file hashes in an immutable manifest, and reuses that artifact for Workerd
integration tests and environment promotion. Static, contract/parity, unit, build, and two
integration-shard jobs run in parallel where dependencies allow. Permanent staging promotion uses
Cloudflare Worker Versions, applies version-external triggers explicitly, rejects superseded `main`
commits, verifies the exact deployed `BUILD_VERSION` with API-only health/readiness checks, and
restores the prior version automatically when qualification fails. Browser smoke tests remain
optional and local-only.

The production workflow is still blocked by the deliberately inert production configuration. When
that environment is separately approved and provisioned, it requires an exact successful staging run
and promotes the same verified artifact into the isolated production Worker; Cloudflare assigns an
environment-scoped version ID without changing the artifact bytes. No hosted resource or production
deployment was modified while preparing this redesign.

## Historical checkpoint: August 1 refactor and legacy removal

The Worker is now the only application host for the active code path. PocketBase-era forwarding,
dead aliases, synchronous `organization/export.json`, legacy payload fallbacks, and the unused
manual queue trigger were removed without redirects. Product routes were normalized to canonical
public, Organization, Platform, setup, singer, account, webhook, and health namespaces; the matrix
contains 181 entries after deletion.

The contracts barrel, queue consumer, browser API client, Worker route hub, Organization schema,
OrganizationStore, and the nine listed large UI screens now have domain submodules while preserving
their original import paths. The final local gate is green: formatting, lint, strict workspace
typechecking, 119 unit tests, 133 prepared Workerd integration tests, 58 Playwright tests, the
workspace build, contract export snapshot (454 names), parity matrix (181 entries), source-route
implementation audit (63 API entries across 59 route files), and high-severity dependency audit (0
vulnerabilities). No hosted resource or production deployment was modified.

The refactor is forward-only at the route surface: removed aliases have no redirects, so rollback
requires promoting a commit that still contains the prior routes rather than relying on schema
rollback. D1 and Organization Durable Object migrations remain forward-compatible; no migration was
added by this refactor. Tenant isolation, external-effect, accessibility, and responsive behavior
were covered by the existing Worker integration and 58-test desktop/mobile browser suite. The
remaining readiness blocker is provider-backed staging qualification, which still requires isolated
Stripe/Brevo credentials and a verified sender through the secure environment flow; production
launch remains out of scope.

## Historical checkpoint: July 31 payment lifecycle implementation

The shared Stripe payment slice now covers Organization-owned direct-charge checkout for tickets,
ticket bundles, donations, and dues. Checkout reserves a pending Organization record before the
Stripe session is created; only a verified connected-account webhook can mark it paid. The D1
`stripe_connected_accounts` map is authoritative for webhook tenancy, payment activation settings
are Organization-local with a platform emergency switch, stale pending records expire after seven
days, and disputes are recorded as Organization alerts without automatic refunds or access
revocation. Checkout completion now requires Stripe's paid status, delayed payment events are
handled explicitly, and partial refunds do not revoke local access. Refund requests use
connected-account idempotency and remain paid locally until the verified complete-refund webhook
arrives. Local/preview remain fake or disabled, while staging requires isolated Stripe test
credentials, a signed test webhook, and Organization Brevo sandbox setup. The new payment settings
surface and donation receipt are implemented locally; staging provider qualification and live-secret
entry remain intentionally blocked until the secure environment gate.

The final local verification recheck passes formatting, lint, strict workspace typecheck, 119 unit
tests, 132 prepared Durable Object integration tests, 58 Playwright tests, the workspace build, the
parity matrix (191 entries), the source-route parity audit, and the high-severity dependency audit
(0 vulnerabilities). The forward-only Organization schema now includes payment attempts, dispute
alerts, notification outbox state, dues payer-email capture, and persistent provider-refund-request
state. Staging qualification remains the only outstanding gate because no isolated Stripe test key,
signed webhook secret, or Brevo sandbox sender is available in this workspace; no placeholder
credentials were created and no hosted resource was modified.

## Historical checkpoint: August 1 verification

The read-only Parity Bridge remains at the immutable baseline commit
`6874d43a3c3698ae53218a44d17649bc454ca9ac`. Its worktree contains one pre-existing user change in
`pocketbase/pb_hooks/main.pb.js` (health fingerprint and formatting only); it was not reverted and
was not used as behavioral evidence. Commit `501b85a` deployed successfully to permanent staging on
August 1 as Worker version `d2a16a4a-9a11-4570-b39b-5f8bc85c29f1`. The automatic deployment reported
no migrations to apply, and the post-deployment remote D1 check agrees. The read-only staging
qualification passed all anonymous shell, health, readiness, session, and registered-host GET
boundaries: 3 hosts, 180 browser-shell probes, 9 core probes, and 75 product/Organization-host GET
API probes. The provider-secret inventory still contains no Stripe or Brevo credentials, so provider
sandbox qualification cannot yet run because no isolated Stripe test key, signed webhook secret, or
Brevo sandbox sender is available. The deployed Stripe endpoint fails closed with the typed HTTP 503
`stripe_webhook_unavailable` response. No payment sandbox charge, webhook, email, or SMS effect was
attempted.

## Historical checkpoint: July 26 parity recheck

The structural parity checker validates all 190 inventory entries and all target-evidence paths, but
it does not prove behavior. The source, contract, Durable Object, and test review closed the prior
audition, set-list, export, music-recency, and theme gaps. A deployed public route sweep verified
all 60 browser routes and exposed 24 legacy API paths that had only renamed equivalents. Twenty-one
compatibility handlers are now restored and covered by local integration checks; the remaining four
anonymous probes are expected invalid-link/not-found states. Setup recovery and Stripe webhook
processing are now implemented and covered by focused local tests. The remaining 121 `implemented`
entries still need their broader permanent-staging qualification. The new
`npm run check:parity:implementation` gate reproduces this source-route comparison without
contacting staging or mutating data.

The compatibility batch was deployed to permanent staging as Worker version
`5e4381a2-c039-4ea0-810a-487a2c8f9d30`. A cache-busted anonymous probe of all 73 API contracts
returned 3 expected public 200 responses, 12 validation responses, 54 authorization responses, and 4
expected invalid-link/not-found responses (`ticket-scan-context`, `player-playlist`,
`calendar-download`, and `calendar-feed` with missing credentials). No matrix API path returned a
router-level 404. Local integration coverage now includes legacy RSVP aliases, ticket checkout,
ticket validation/refund, bundle refund, scan-context proof-of-payment, setup health, automatic
queue acknowledgement, tenant-scoped maintenance execution, fake Stripe receipt, and public player
playlist tenant isolation. Anonymous staging probes for `/api/health` and `/api/ready` returned 200;
`/api/platform/maintenance/run` correctly returned 401 without a session.

The setup-status handler now preserves the Organization Durable Object's known failure code/status
and emits only a redacted request-scoped error type for unexpected failures. The corrected staging
deployment and authenticated LCC probe now pass; the local calendar integration path remains green.

The local qualification now passes formatting, lint, strict typecheck, 87 unit tests, 118
integration tests, 56 Playwright tests, build, parity validation (190 entries), and the
high-severity dependency audit (0 vulnerabilities). Integration output still includes the known
expected FleetSchema registry-identity warning, and Playwright logs expected proxy warnings for
unmocked background setup requests; all 56 tests pass.

The corrected qualified commit `971e4f5` was deployed to permanent staging on July 26, 2026 as
Worker version `b5515d2e-11ab-4e99-87e6-d1ede621dec7`. Public probes passed: `/api/health` returned
HTTP 200 with request ID `599bfd04-dc5b-4ad3-96c5-aaff3d52b42a`, `/api/ready` returned HTTP 200 with
request ID `dc905b00-056d-4c32-8913-9c8d3854bbd2`, and the remote D1 migration check reported no
migrations to apply. The affected canonical Organization setup probe returned the expected
unauthenticated HTTP 401 with request ID `c8f53ca4-69c1-42b5-b379-5dc6b761d974`; no operational data
was exposed.

Authenticated staging checks then verified the member dashboard, Account Organizations/security/
sessions, Platform overview and MFA gate, the LCC Organization overview, roster, events/event roster
links, auditions, music library, set lists, seating, invitations, security, modules, and
Organization settings/export surfaces. The export reached “ready to download”; LCC and LMC canonical
hosts resolved to their distinct Organization names and summaries. Mobile seating read-only-first
behavior, Escape-closing drawer focus return to its trigger, `aria-current`, and light-theme
switching also passed on the deployed version. The staging browser is left on the LCC Organization
workspace. Production remains unlaunched.

The remaining qualification plan is intentionally staged rather than treated as a feature gap: run
public and signed-link browser flows first, then API contract families, queue/file/CSV workflows,
and responsive visual states. Each batch must capture both its successful path and its relevant
authorization, validation, retry, or tenant-isolation path before promoting matrix entries to
`verified`. Staging remains in fake external-effects mode and all fixtures must remain
Organization-scoped.

## Historical checkpoint: route-contract repair

The setup-recovery and Stripe webhook entries are now implemented. Recovery requires a recent
Platform Administrator MFA assertion and active Organization elevation, creates or upgrades only the
hostname-resolved Organization membership, links a Profile inside that Organization, records an
audit event, and rolls back partial writes. Stripe uses raw-body HMAC verification, a five-minute
timestamp tolerance, event-id idempotency, module and Organization metadata guards, and tenant-local
ticketing, donation, and dues transitions. Local evidence now includes 87 unit tests, 118
integration tests, and a dedicated Stripe completion/replay/refund Durable Object test.

The repaired Worker was deployed to permanent staging as version
`39d00939-901b-4b46-b278-5ac888cefb7a`. Smoke probes on `lcc.staging.musicsite.org` returned HTTP
200 for `/api/health` and `/api/ready`, HTTP 401 for anonymous `/api/setup/status`, and the typed
HTTP 503 `stripe_webhook_unavailable` response for `/api/webhook/stripe` because no staging Stripe
webhook secret has been provisioned. Production remains unlaunched; signed Stripe fixtures and the
provider rollback drill remain the explicit staging prerequisites. The read-only staging secret
inventory also has no Brevo credentials; both provider lanes must be configured through their secure
secret flows before signed sandbox qualification can run. No placeholder credentials were created.

The provider checklist now has legacy-compatible expiry coverage for ticket purchases and donations:
donations expose `expiredAt` through the forward-only Organization schema v34 `donation_expirations`
table, and a later completion removes that marker. Dues retain their existing `pending` contract
while recording the provider-expiry audit. Local expiry, replay, and completion-after-expiry
coverage is green; staging still needs the signed provider fixture and rollback drill.

Read-only staging control-plane checks after that deployment found the two expected active
Organizations (`lcc` and `lmc`) with only their canonical staging domains, and
`wrangler d1 migrations list --remote --env staging` reported no migrations to apply. No rows were
written by these checks.

A cache-busted anonymous route sweep against the same version returned HTTP 200 for all 60 browser
routes. The 70 API entries returned 2 public 200 responses, 13 validation 400 responses, 53
authorization 401 responses, and four expected invalid-link/not-found 404 responses. The only
additional response was the expected typed 503 for the unconfigured Stripe webhook; no matrix API
path fell through to a router-level 404.

The schema-v34 deployment (`39d00939-901b-4b46-b278-5ac888cefb7a`) passed fresh HTTPS smoke checks:
the product, LCC, and LMC hosts returned 200 for health/readiness, registered Organization setup
status remained 401 without a session, unregistered product-host setup returned the expected 404,
and `/admin/setlists` plus `/admin/seating` returned the application shell. The Stripe endpoint
returned the typed 503 fail-closed response because the staging secret is still absent. The remote
D1 migration ledger reported no pending migrations; these checks did not write control-plane rows.

The route-repair source and evidence were committed and pushed as `deecd8d`. That exact clean commit
was redeployed on July 28, 2026 as Worker version `42fc841d-77c7-4c09-a952-b9672768882d`.
Cache-busted product, LCC, and LMC health/readiness probes returned HTTP 200; the product login
shell returned HTTP 200; anonymous session retrieval returned `null`; LCC setup status remained
correctly protected with HTTP 401; and Stripe remained fail-closed with the typed HTTP 503
configuration response. The remote D1 ledger reported no pending migrations. A read-only control
query confirmed two active Organizations plus one verified, active Platform Administrator identity
for `cwosborn@gmail.com`.

After a fresh interactive Platform Administrator authenticator assertion, the normal bounded
fleet-schema Workflow completed successfully with two Organizations processed and no failure code.
LCC and LMC now both record Organization schema version 34. LMC's previously unfinished setup wizard
was completed with its existing name/slug, the people/events/programs modules enabled, and the
repository default staging theme; both LCC and LMC now report setup complete.

The missing manager surface for the existing audited Membership-to-Profile API was implemented in
commit `8ed2421`. The full non-browser gate passed with 87 unit tests, 118 integration tests, strict
types, lint, build, both parity audits, and zero high-severity dependency findings. The commit was
deployed as Worker version `1c7cd1bb-7812-4a6c-a5bd-ee731ede0d90`. Through that UI,
`cwosborn@gmail.com`'s Owner Membership in each Organization was linked to a distinct tenant-local
`Wes Osborn` Profile. Read-only D1 verification confirmed both non-null Profile IDs, one
`organization.membership.profile_linked` audit event per Organization, and schema version 34 for
both registry rows. The member Profile page then loaded the correct email and display name on both
canonical hosts. No session token or direct control-plane write was used.

The local large-data qualification now seeds 5,000 active Profiles and 500 upcoming events in one
Organization Durable Object and exercises `/api/organization/dashboard-summary`. It returns exact
counts and five next events in under one second, confirming bounded `COUNT`/`LIMIT` behavior without
serializing the full dataset. This evidence is local only; the equivalent deployed scale run remains
part of the open Milestone 6 staging gate.

## Historical checkpoint: July 28 staging qualification

The authoritative `main` commit `9eb4075` passed the GitHub CI workflow and its automatic staging
deployment completed successfully. The current 100%-traffic Worker version is
`ef560011-c078-4acb-92c1-c2f0eee49029`; the permanent staging URL remains
`https://staging.musicsite.org` with canonical `lcc` and `lmc` Organization hosts. Fresh HTTPS
probes returned HTTP 200 for `/`, `/api/health`, and `/api/ready`, and the remote control D1 ledger
reported no migrations to apply.

All 60 browser-route shells returned HTTP 200 on the product, LCC, and LMC hosts (180 requests). The
73-entry anonymous API sweep returned only expected public, validation, authorization, and
invalid-link/not-found responses on the registered Organization hosts. No request fell through to an
unhandled Worker error. `POST /api/webhook/stripe` returned the typed fail-closed
`stripe_webhook_unavailable` HTTP 503 on every host because the staging Stripe webhook secret is
intentionally still absent. The product and unregistered hosts correctly reject tenant-scoped routes
by hostname-first resolution.

The repeatable read-only `npm run qualify:staging` check now captures this boundary without browser
automation or credentials: the default product/LCC/LMC run passed 180 browser-shell probes, 9 core
probes, and 75 product/Organization-host GET API probes. Supplying
`STAGING_UNREGISTERED_URL=https://qualification-check.staging.musicsite.org` also passed the
unregistered wildcard-host boundary (240 shell probes and 12 core probes total). The qualifier paces
requests to stay below the edge rate limit seen from GitHub runners and uses a browser-like user
agent. If a GitHub runner is refused by a zone-level edge rule before the first application
response, the qualifier reports that distinction and leaves the deployment intact; the same
read-only check still passes from the local/interactive network shown above.

The public audition-settings contract returned HTTP 200 on both canonical Organization hosts, with
the tenant-local default response shape and no cross-host data exposed; this promotes that public
API entry alongside the already verified hook-health endpoint.

The authenticated companion check is available as `npm run qualify:staging:auth`. It accepts only a
locally supplied `STAGING_SESSION_COOKIE` (and optional `STAGING_AUTH_EMAIL`), verifies the
signed-in identity, and performs read-only account, Platform MFA-status, Organization, export, and
singer surface checks on both canonical hosts. For a complete local email-code flow without copying
a cookie, use `npm run qualify:staging:auth:login`; it requests a code, reads the code from the
terminal, keeps the resulting session only in memory, and invokes the same read-only check. Neither
command writes staging data or logs the cookie; browser automation remains intentionally deferred.

Per-parity-entry evidence is captured by `npm run qualify:staging:evidence`. It reads the parity
matrix and probes each implemented API entry with the matching kind: authenticated reads (200),
anonymous reads (200), empty-body validation on mutations (400, proving the contract validates
before any side effect), and the Stripe fail-closed gate (503). Entries that need seeded fixtures,
signed tokens, Platform Administrator elevation, or that mutate state are reported as skipped with
their reason. `npm run qualify:staging:evidence -- --plan-only` previews the probe plan without
network access, and `scripts/parity-evidence-plan.test.mjs` keeps the plan in sync with the matrix
so CI fails if a new API entry lands without a probe kind.

The local non-browser gate was rerun from this exact commit: formatting, lint, strict typecheck, 87
unit tests, 118 workerd integration tests, and all workspace builds passed. Integration output still
contains the expected FleetSchema negative-test identity warning; it does not affect the zero exit
status. Browser automation remains intentionally deferred to conserve tokens.

The staging rollback drill then moved 100% of traffic from `ef560011-c078-4acb-92c1-c2f0eee49029` to
the prior qualified `c57fb241-d693-4b30-aa56-ed89ada0098b`. The product shell, login shell, health,
and readiness all returned HTTP 200 during the rollback. Traffic was restored to
`ef560011-c078-4acb-92c1-c2f0eee49029`; health/readiness remained 200 and the remote D1 migration
ledger remained clean. Rollback changed Worker traffic only and did not alter D1, Durable Object,
R2, KV, queues, or Workflow state.

## Repository topology

- Authoritative checkout: `/Users/wesandlaura/Projects/choir-management-cloudflare`
- Retired task mirror (stale after `bd190db`; do not use or sync it over the authoritative target):
  `/Users/wesandlaura/Documents/Codex/2026-07-20/prior-conversation-with-codex-conversation-role/choir-management-cloudflare-work`
- Legacy planning checkout (documented historical path):
  `/Users/wesandlaura/Downloads/choir-management-tool`
- Read-only parity worktree (documented historical path):
  `/Users/wesandlaura/Downloads/choir-management-tool-parity`
- Immutable parity commit: `6874d43a3c3698ae53218a44d17649bc454ca9ac`
- Local parity tag: `parity-baseline-2026-07-20`

The Projects checkout above remains authoritative and is directly writable. The retired mirror and
legacy/parity paths are historical references only; they are not sources of truth and must not be
synced over newer commits. Never implement in the parity worktree.

The documented legacy planning checkout and parity worktree are not present in the current execution
environment. No replacement checkout was created, and no legacy source was used in this verification
pass. The baseline commit hash and prior committed-object caveat above remain historical evidence;
re-establish the read-only Parity Bridge before any new baseline comparison or screenshot capture.

## Verified tooling and authentication

- Git is installed; local identity is `wesochuck <cwosborn@gmail.com>`.
- Node.js `v26.5.0` and npm/npx `11.17.0` are installed.
- GitHub CLI `2.96.0` is authenticated as `wesochuck` through the macOS keyring; `origin` is the
  private `wesochuck/choir-management-cloudflare` repository.
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
- Current verified Worker version: `2ef37eba-37a3-4de2-bc6c-d1cf41ea07f7` (commit `dec2776`). The
  immutable release was promoted by staging run `31492269399`; the lockfile hash recorded for the
  artifact is `0c2504af557e7c47a791896fa33ea2bc593b60c0358e4442e2991c7b3b98c97d`.
- D1: `choir-management-control-staging` (`9f543949-192f-49a7-aa59-7cf589b4a62f`), migrations
  `0001_initial.sql` through `0014_email_change.sql` applied; no migrations pending
- Durable Object: declarative SQLite export `OrganizationStore`
- R2: `choir-management-staging`
- KV: `choir-management-routing-staging` (`9c7f20b2c8024b1b98d17a682c70cf97`)
- Queue: `choir-management-jobs-staging`
- Dead-letter queue: `choir-management-jobs-dlq-staging`
- Workflow: `choir-management-provisioning-staging`
- Fleet schema Workflow: `choir-management-fleet-schema-staging`
- External effects: staging is configured for `sandbox` mode in the current Worker configuration;
  provider-backed qualification remains incomplete until isolated provider credentials and test
  identities are supplied through the secure environment flow.
- Platform email: native Cloudflare Email Sending in staging sandbox mode from
  `auth@mail.staging.musicsite.org`. The tracked staging configuration currently uses a
  non-deliverable test identity for the ordinary staging recipient allowlist. One interactive OTP
  request was accepted during this pass, but no code was entered and no provider delivery event or
  completed sign-in was observed; no current real-recipient delivery is claimed here. The earlier
  allowlisted auth-email result remains a dated historical checkpoint.
- Signed-link secret: configured independently in the staging Worker secret store

Current qualification pass — August 9–10, 2026, refreshed August 10:

- Cache-busted `GET /api/health` and `GET /api/ready` returned HTTP 200 from the direct Worker and
  from `staging.musicsite.org`, with the health payload reporting release
  `11e3f71893df6625b9f1dcd183ac24f0fdc2c171`.
- A fresh `npm run qualify:staging` run supplied with that exact release and the diagnostic Worker
  URL passed all six direct/custom-domain health and readiness probes, with no rollout or edge
  qualification warning.
- The same read-only qualification returned HTTP 200 health/readiness from the active canonical
  `lcc.staging.musicsite.org` and `lmc.staging.musicsite.org` hosts. Unauthenticated Organization
  API requests on both hosts returned the expected typed HTTP 401, while the product base and an
  unregistered wildcard host returned the expected hostname-first HTTP 404 for Organization
  authentication state.
- A fresh post-midnight recheck returned the exact current release from `/api/health` and
  `status: ready` from `/api/ready` on the workers.dev diagnostic host, product host, both seeded
  Organization hosts, and an unregistered wildcard host. This confirms deployment convergence and
  health/readiness only; it does not establish authenticated tenant access.
- A fresh August 10 security-header probe confirmed that API responses include the repository CSP,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, referrer policy, product-origin CORS
  restriction, and request IDs. The deployed SPA HTML shell currently returns none of those headers
  because it is served through the static-assets path. This is an open defense-in-depth finding
  (`SEC-STATIC-HEADERS`, severity to confirm in the security review); it is not being marked as
  fixed or hidden by the API-only evidence. `Strict-Transport-Security` was absent from both probe
  classes; any zone-level HSTS setting remains unverified. A hostile `Origin` on GET and OPTIONS
  probes was not reflected; CORS continued to allow only the product origin. The health response's
  JSON `requestId` matched its `X-Request-ID` header.
- Wrangler read-only inspection confirmed four staging queues: jobs, jobs dead-letter, Email Sending
  feedback, and Email Sending feedback dead-letter. The jobs queue has a producer and consumer; each
  dead-letter and Email Sending feedback queue has a consumer.
- Fresh Wrangler Email Sending read-back confirmed `mail.staging.musicsite.org` is enabled on the
  staging account. The `staging-email-feedback` queue subscription is enabled, uses the
  `email.sending` source for that exact domain, targets the staging feedback queue, and selects all
  six lifecycle events: delivered, deferred, bounced, failed, rejected, and complained. This is
  configuration/routing evidence only; no live message was sent because the tracked staging
  recipient allowlist is a non-deliverable `.test` identity and no real recipient authorization was
  supplied.
- A fresh read-only DNS check found the staging sending domain's SPF record and `p=reject` DMARC
  policy, with the parent zone also publishing `p=reject`. This confirms the visible DNS policy for
  the configured sender; it does not qualify DKIM propagation or end-to-end message delivery.
- A fresh read-only deployment/resource recheck confirmed the 100%-traffic staging deployment is
  Worker version `ae0f0e9f-d32b-4da6-abbf-e49716aa3fa8` for release
  `11e3f71893df6625b9f1dcd183ac24f0fdc2c171`, all four staging queues have the expected
  producer/consumer relationships, and the Email Sending feedback queue and dead-letter queue each
  have one consumer. A second Wrangler read-only recheck on August 10 reconfirmed the enabled
  `mail.staging.musicsite.org` sending domain and the enabled `staging-email-feedback` subscription,
  including all six configured lifecycle events and its destination queue. Remote D1 `SELECT`
  queries confirmed two active Organizations at operational schema 39, two active canonical domains,
  all 14 control migrations, and one active Platform Administrator; every query reported zero
  writes.
- Wrangler startup analysis from the Worker project completed with a 116.5 ms local profile window
  for the 4,044.67 KiB / 643.35 KiB gzip bundle. This is a local startup signal only, not a
  Cloudflare edge CPU qualification; the generated profile was removed after inspection.
- Focused local Email Sending coverage passed: 25 parser/provider/platform-email unit tests and 9
  prepared Workerd email-feedback integration tests. The integration evidence covers route
  ownership, duplicate idempotency, pending route reconciliation, deferred/non-suppressing behavior,
  recipient mismatch rejection, recipient-versus-sender rejection policy, malformed dead-letter
  recording, and global suppression. It does not substitute for observing every provider event on
  permanent staging.
- The Worker source contains no inbound `email()` handler for feedback; Email Sending lifecycle
  processing is routed through the dedicated provider-event parser, ingestion, and queue consumer.
  The full local gate includes the platform-email, provider, and email-feedback unit/integration
  coverage.
- A fresh focused local run passed 147 tests across signed public flows and communications (61),
  files, publication, scheduler, queue jobs, and Music Folder Report integration (19), plus domain
  CSV, ticketing, reporting, seating, and set-list contracts (67). The queue/scheduler stderr lines
  were deliberate failure/retry injections; the separate Better Auth IP-resolution messages are
  existing test-runtime warnings. All selected files passed.
- New focused setup, financial-boundary, and poll-route tests passed as part of the 11-test
  calendar-management integration file. They cover claiming a provisioning Organization, saving
  module progress, reading module state, completing setup, observing the launched state, confirming
  the append-only setup audit event, reading empty seasons/dues/donation/patron lists, and rejecting
  malformed refund identifiers before store access. This strengthens local route and transaction
  evidence without creating payment records or provider effects; it does not replace authenticated
  permanent-staging proof.
- A focused Platform Administrator route test passed as part of the 7-test Platform integration
  file. It covers ordinary-user denial, queue settings and generation, fake-mode SMTP/SMS responses,
  and the absence of additional captured platform email effects. It uses local capture/fake bindings
  only and creates no external provider effect.
- New focused route coverage passed 21 tests across calendar-management and dues integration files.
  It covers linked-member fake dues checkout idempotency, fake donation refund with
  cross-Organization denial, and audition conversion with repeated-conversion rejection. These tests
  use local fake payment state and do not create external provider effects.
- The local Organization export integration path now also parses the downloaded JSON archive and
  checks its Organization-bound manifest, payload identity, record map, byte count, and checksum
  against the completed export status. This is local R2/Workerd evidence; a real staging export,
  authorized download, and scale/resume proof remain open.
- A focused adversarial-isolation run passed 113 tests across 17 Workerd integration files. It
  covers host-derived Organization authorization, altered Organization IDs and memberships, Platform
  elevation revocation, wrong-host/expired/purpose-mismatched signed links, private-file and R2-key
  substitution, published-projection isolation, queue deduplication/replay/dead letters, unmatched
  payment/refund events, and provider-event route/recipient mismatch. These are local
  fake/capture-mode proofs; the equivalent permanent-staging cross-tenant and real-queue probes
  remain open.
- A fresh `npm run test:e2e` run passed all 90 desktop/mobile Chromium tests. It exercised
  email-change confirmation, Platform Administrator MFA and scoped elevation, invitations, ticketing
  and discount codes, reports, communications, auditions, roster automation, set lists, seating,
  first-run setup continuation, DataTable card behavior, and responsive accessibility audits. These
  are local browser proofs; permanent-staging authenticated and visual evidence remains required for
  the still-implemented browser and responsive entries.
- Remote control-plane counts showed one existing provider event, zero email-feedback dead letters,
  and eight existing job dead-letter records. These are observations only; no queue message,
  provider effect, migration, or hosted data was created or changed.
- A read-only `npx wrangler workflows list` check was rejected by the Cloudflare Workflows API with
  authentication error `10000` from the current local OAuth context. No deployed Workflow resource
  or instance state is claimed from that failed read; local Workflow tests and the deployment
  configuration remain the available evidence until a permitted Workflow read context is supplied.
- A cache-busted empty-body validation sweep against the active LMC Organization host returned the
  expected typed HTTP 400 for 11 public contracts: RSVP details and quick RSVP, unsubscribe,
  audition inquiry/details/submit, poll details/vote, ticket checkout/quote, and donation checkout.
  These requests fail validation before stateful work; they do not promote the corresponding matrix
  entries without successful, authorization, isolation, and retry-path evidence. The unconfigured
  Stripe webhook also returned its expected typed HTTP 503 fail-closed response.
- The staging evidence tooling now classifies `/api/setup/health` as an authenticated
  Organization-host probe and routes it to the seeded Organization host. Its regression test passes;
  the earlier product-base HTTP 404 was an evidence-plan classification error, while the correct
  Organization-host boundary returned the expected HTTP 401 without a session.
- A fresh August 10 `node scripts/qualify-staging-evidence.mjs --anonymous` no-session sweep made
  148 safe requests for all 79 API entries, exercising both seeded Organization hosts for every
  Organization-scoped route, the product host for Platform routes, and safe zero-UUID path
  placeholders for dynamic routes. It returned 3 HTTP 200 responses, 28 validation 400 responses,
  112 authorization 401 responses, four typed invalid-link/not-found 404 responses for missing
  player and calendar credentials, and the expected typed Stripe configuration 503. There were no
  unexpected 5xx responses or router-level 404s. This is boundary evidence only: it does not promote
  entries without successful, authorized, isolation, retry, and external-effect evidence.
- An August 11 rerun of the same anonymous staging boundary sweep reproduced all 148 expected passes
  across both seeded Organization hosts: 3 HTTP 200 responses, 28 validation 400 responses, 112
  authorization 401 responses, four typed invalid-link/not-found 404 responses, and the expected
  typed Stripe configuration 503. No unexpected 5xx response or router-level 404 was observed.
- Two interactive `npm run qualify:staging:auth:login` attempts requested staging sign-in codes, but
  no code was entered into the waiting process before either terminal prompt was canceled. No
  session cookie was produced, no authenticated probe ran, and no parity status was promoted;
  request acceptance is not treated as proof of delivery.
- Both seeded Organization hosts returned HTTP 200 for public audition settings with the expected
  typed shape, Organization-specific default Performance IDs/titles, eight voice parts, four
  sections, four audition slots, and matching response/request IDs. This confirms host-scoped public
  setting selection for the already-verified `api.public.audition-settings` entry; it does not
  establish authenticated audition administration or submission-side effects.
- Read-only ticketing, donation, and fee settings returned HTTP 200 with typed, secret-free shapes
  on both seeded Organization hosts, and each response's JSON request ID matched its response
  header. `GET /api/public/projection` instead returned the expected typed HTTP 404 on both hosts
  because neither seeded Organization currently has a published website projection; ETag/conditional
  cache behavior therefore remains unverified and the public-site workflow stays `implemented`.
- A no-credential invalid-token sweep across both seeded Organization hosts returned typed failures
  for calendar, player, ticket-order, donation-receipt, RSVP, poll, audition, unsubscribe, and
  email-change signed-link endpoints. Player/RSVP/poll links returned their invalid-link responses;
  calendar, ticket-order, and audition links returned not-found responses; donation receipt,
  unsubscribe, and email-change links returned their typed invalid-token responses. Every response
  included a request ID. Invalid published-media version/file requests returned typed 404 responses,
  and invalid player-media tokens returned `invalid_link`. This proves fail-closed negative
  boundaries only; valid, expired, revoked, and cross-host token success/failure cases remain open.
- The focused local scale test passed with 5,000 active Profiles and 500 upcoming events in one
  Organization Durable Object. Dashboard summary returned exact counts, only five next events, and
  completed in under one second. This is local bounded-query evidence; the planned permanent-staging
  100,000-record and 250-concurrent-user envelope remains unqualified.
- A read-only public commerce check used existing staging Performances from both seeded hosts. LMC's
  open Performance returned HTTP 200 with the complete typed quote, `totalCents: 1059`, and
  `feeCents: 59`; its request ID was present in the response header. Empty quote bodies on both
  hosts returned typed HTTP 400 validation failures. The LMC Performance ID submitted to LCC
  returned only the typed `ticket_sales_closed` 409 response, while LCC's own closed Performance
  also returned that same non-data-bearing response. Discount availability returned HTTP 200 with no
  redeemable code on both hosts, including foreign-ID checks; invalid target shapes returned typed
  HTTP 400 validation failures. Local discount integration coverage proves the positive redeemable,
  redemption-limit exhaustion, and invalid-code transitions. No checkout, payment-provider call, or
  persistent write was initiated; both `api.ticket-quote` and `api.ticket-discount-availability` are
  now `verified`.
- An authenticated staging browser session loaded `/admin/library/settings` for LMC and rendered the
  catalog-link, public practice-link, and genre settings regions without an error; the local music
  integration coverage, full browser suite, and this permanent-staging route evidence support
  promoting `route.admin.library.settings` to `verified`.
- The same read-only session loaded the Events, Polls, Reports, Roster, Attendance, RSVP, and
  Communications administration surfaces without an alert. At that time the Platform dead-letter and
  email-suppression routes rendered their protected workspace boundary, but the session did not have
  the required verified Platform Administrator MFA state; a later authenticated browser pass
  completed that factor and promoted both route entries to `verified`.
- The staged `/confirm-email-change` route rendered its invalid/expired-token state with the
  expected recovery link and no write. A valid-token success path was not attempted, so that route
  remains `implemented`.

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

## Historical staging qualification checkpoint (superseded)

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
  `GET /api/platform/queue-settings` (200, returns staging queue config).
- Production environment is explicitly isolated: `EXTERNAL_EFFECTS_MODE=disabled`,
  `PLATFORM_EMAIL_MODE=disabled`, `workers_dev=false`, `PRODUCT_BASE_DOMAIN=invalid.example`. The
  Worker name includes `-inert` to prevent accidental activation. No D1, queues, routes, or custom
  domains are configured in the production environment.
- Rollback runbook is documented at `docs/runbooks/rollback.md`. Version history is available for
  traffic shift to the previous deployment. No forward-written columns or tables require deletion.
- CI/CD: automatic staging deploy from main via `.github/workflows/deploy-staging.yml` after CI
  succeeds. Production promotion requires an authorized approval workflow via
  `.github/workflows/deploy-production.yml`.

## Historical completed foundation checks (superseded)

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

## Current completion backlog: Milestone 6 staging gate

The following work remains before the goal contract can be marked complete:

1. Qualify the 58 parity entries that remain `implemented`, including the remaining API families,
   signed-link flows, file behaviors, record hooks, background tasks, and domain workflows. Promote
   entries to `verified` only after successful and failure-path evidence is captured.
2. Supply isolated Stripe Connect test credentials and a signed webhook secret, then qualify
   checkout, capacity, webhook replay/idempotency, refunds, disputes, reconciliation, reminders, and
   failure/rollback behavior. Do not record credentials here.
3. Supply isolated Brevo test credentials, verified sender identities, and the approved SMS test
   number, then qualify delivery, suppression, retry, partial-failure, redaction, and provider
   feedback behavior. Keep the staging recipient allowlist narrow.
4. Complete permanent-staging qualification at the planned scale envelope: 5,000 Profiles, 100,000
   operational/commercial records, and 250 concurrent authenticated/public requests. Verify queue
   redelivery, idempotency, dead-letter retry/dismissal, scheduled alarms, workflow resume, and
   fleet migration behavior.
5. Validate independently attached public domains, apex and `www` behavior, public projections,
   signed links, and cross-Organization isolation on the deployed staging resources.
6. Complete the remaining export-byte and checksum assertions in the local/Workerd evidence and,
   when the browser tool permits safe byte inspection, recheck the authorized staging download.
7. Finish the staging security, dependency, observability, migration-rehearsal, rollback, and
   runbook evidence. The final gate must have no unresolved critical or high security finding and
   must leave production isolated and unlaunched.

## Secure and external prerequisites

- GitHub, the private repository, the remote, and the repository-scoped Cloudflare CI credentials
  are recorded as configured. Local Wrangler OAuth remains separate from CI and must not be copied
  into this file.
- Stripe and Brevo secrets must be entered only through their secure environment flows. Until that
  happens, provider qualification cannot be approved; no placeholder credentials may be created.
- Staging email remains restricted to the explicit recipient allowlist. Do not turn staging into an
  unrestricted sender.
- Independently attached Organization domains require the separately approved Cloudflare hostname
  lifecycle capability. Production domains and resources remain uncreated and unlaunched.

## Environment decisions

- GitHub visibility: private.
- Product-owned domain: `musicsite.org`.
- Permanent staging hostname: `staging.musicsite.org`, with canonical Organization hosts at
  `{slug}.staging.musicsite.org`; the existing workers.dev hostname remains a diagnostic fallback.
- Staging uses separate D1, Durable Object, R2, KV, Queue, DLQ, and Workflow resources. The current
  Worker configuration selects provider sandbox modes and `STRIPE_PAYMENTS_ENABLED=true`; provider
  qualification still depends on the secure prerequisites above.
- Platform transactional email uses native Cloudflare Email Sending in staging sandbox mode from
  `auth@mail.staging.musicsite.org`, restricted to an explicit recipient allowlist. Local capture
  remains the local/preview mode. Production email remains unconfigured.
- Production reservation: `musicsite.org` and `{slug}.musicsite.org`; production remains isolated,
  uncreated, and unlaunched. Production launch is outside the current goal.
- Independently attached Organization domains remain public-only and never receive product auth
  cookies.
- Whole-archive import/restore is intentionally excluded from v1 by ADR 0015.

## Resume point

1. Keep the current repository, parity matrix, and historical evidence aligned with the
   authoritative `main` checkout. Refresh this file after each staging qualification batch rather
   than replacing historical evidence with older counts.
2. For each future material release, repeat the local gate and promote only its exact immutable
   artifact to permanent staging through the release workflow.
3. Resolve the Stripe and Brevo secure prerequisites, then execute the remaining provider, queue,
   export, domain, scale, scheduler, observability, migration, security, and rollback checks listed
   above.
4. Promote the corresponding parity entries from `implemented` to `verified` as evidence is
   approved.
5. Do not launch or configure production. Pause only for interactive authorization, secure secret
   entry, missing external entitlement/permission, or a genuinely product-changing decision not
   resolved by the rebuild plan and ADRs.
