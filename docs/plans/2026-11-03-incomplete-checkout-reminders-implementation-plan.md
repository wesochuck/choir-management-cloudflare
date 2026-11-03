# Incomplete checkout reminders — implementation plan

Status: Implemented locally and acceptance verification completed November 3, 2026. The user's
implementation request superseded the original documentation-only scope. No push, deployment,
production change, or real email delivery was performed.

Design record: [confirmed interview](2026-11-02-incomplete-checkout-reminders-design-notes.md).

## Outcome and scope

Help people who forgot to finish a public ticket purchase, ticket bundle purchase, or donation with
one gentle optional follow-up. Member dues are excluded. An incomplete checkout is not a debt.

Use existing Organization storage, alarm/outbox, queue, communications provider, template editor,
and Communications history boundaries. No separate dashboard, payment provider recovery campaign,
new identity account, or newsletter enrollment is needed.

## Confirmed behavior

| Concern              | Required behavior                                                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sending              | Automatic for eligible checkouts; no reminder opt-in checkbox.                                                                                                                                                                                |
| Organization control | Enabled by default. Owners and Administrators can change the shared toggle in Settings → Payments, below online payment controls. Disabling also invalidates queued reminders.                                                                |
| Activation           | Only new checkouts begun while enabled qualify. No historical backfill on rollout or re-enabling. Preserve opt-outs and cooldowns through setting changes.                                                                                    |
| Timing               | One email 24 hours after checkout starts, subject to current eligibility. Never accelerate for an upcoming performance.                                                                                                                       |
| Repeated attempts    | The newest attempt for that email in the Organization replaces all older reminder candidates across tickets and donations and restarts the 24-hour wait. Older candidates never resume.                                                       |
| Frequency            | At most one reminder per normalized email per Organization in a rolling 30-day period across tickets and donations. No second reminder for the same checkout.                                                                                 |
| Donation completion  | Any later successful donation using the same email in the Organization cancels an earlier donation reminder, regardless of amount.                                                                                                            |
| Ticket completion    | A later successful purchase using the same email in the Organization cancels an earlier reminder for an overlapping performance, regardless of quantity or individual/bundle form. Any overlap cancels the entire unfinished bundle reminder. |
| Event cutoff         | At delivery, the performance must be at least 24 hours away. For bundles, use the earliest included performance. Skip rather than send early.                                                                                                 |
| Availability         | Ticket sales must still be open, with all selected ticket quantities available at all included performances. Skip invalid, canceled, removed, or unavailable offerings. Recheck again on return.                                              |
| Recipient control    | Stop both kinds of checkout reminder for that email in that Organization, with no automatic opt-out expiry. Do not alter newsletter preferences, receipts, confirmations, or another Organization.                                            |
| General unsubscribe  | An existing unsubscribe from the Organization's general emails also blocks reminders. Existing provider delivery suppressions remain authoritative.                                                                                           |
| Return flow          | Restore email, ticket selections and quantities, donation amount/level, and discount code for review. Re-enter name/address if needed. Revalidate current terms before an explicit action starts fresh payment.                               |
| Return lifetime      | Seven days from sending, shortened by ticket-sales closure. Expiry shows an explanation and a link to start again on the current public page.                                                                                                 |
| Editing              | Separate editable ticket and donation subject/body templates in Communications → Templates, with placeholders, gentle defaults, and reset to default. Link to them from the setting.                                                          |
| Protected elements   | Automatically include the return button, Stop these reminders link, and required sender footer. Template edits cannot remove them. Show all of them in the complete preview.                                                                  |
| Staff visibility     | Existing Communications history shows Incomplete checkout reminder, recipient, context, and scheduled/sent/skipped/failed state with safe explanations.                                                                                       |
| Retention            | Remove reminder history and saved recovery details 90 days after terminal status. Preserve opt-outs; retain payment records under their existing rules.                                                                                       |

Elapsed timing uses stored UTC instants, not local date boundaries. Exactly 24 hours before a
performance is eligible; anything closer is skipped. A cooldown-blocked candidate is skipped, not
held for a month and sent later. Fresh attempts after the cooldown may qualify normally.

## Checkout capture and matching

Capture a start only after the server has validated checkout, persisted the operational attempt, and
successfully attached a usable payment session. Use the attempt's persisted creation instant as the
timing anchor. Failed session creation and merely typing an address must not create reminder work.
Existing checkout rate limits, Turnstile, validation, and provider suppression checks stay in place.
Recovery must not introduce an alternate unchecked checkout route.

Registration must be idempotent by the original checkout request/attempt identity. A retry that
returns that same session is not a new attempt and must not move the wait forward. A new accepted
checkout request replaces the email's candidate. Immediately completed, complimentary, and simulated
paid purchases do not become abandoned reminders; use deterministic pending fixtures to exercise the
feature locally.

Normalize email with the application's existing commerce rules; do not introduce mailbox-provider
dot stripping or alias collapsing. Store the original display/delivery email only where needed. Each
Organization maintains its own email-keyed recipient state even when the same person appears
elsewhere. Checkout capture does not create newsletter consent or require a Contact/Profile.

Completion hooks cancel matching current candidates using the successful payment's effective
timestamp, including a late-arriving webhook. Preserve normal webhook account verification,
idempotency, and reconciliation. Use indexed candidate/event relationships rather than scanning all
historical purchases. Canceled candidates do not resurrect after refunds. A late webhook may arrive
after a reminder has already left; do not claim the timing race can be eliminated.

Resolve general unsubscribes across Organization-local Contact email identities, linked Profiles,
and existing suppression records, including when the pending checkout has no Contact ID. Never use a
Contact ID as a Profile ID. Where Profile email requires D1 identity resolution, use bounded
Organization membership lookups in the Worker, outside the Durable Object runtime; do not copy
global identity data into an unscoped operational lookup. Reuse existing suppression helpers and
extend their typed contracts where necessary. An unknown optional-newsletter preference does not
create affirmative newsletter consent; an explicit unsubscribe blocks this reminder.

## Persistence and bounded access

Use a forward-only Organization SQLite migration; allocate its version from the current migration
registry during implementation, because donation publication work is changing that registry. Do not
rewrite applied migrations. No new D1 operational table is needed.

Persist the following responsibilities, preferably in focused reminder tables rather than adding
recovery secrets to payment records:

- Organization enable state, enabled-since instant, and generation. Increment the generation when
  disabling/re-enabling so stale jobs are rejected without a synchronous mass update.
- One recipient row per normalized email, holding reminder opt-out, newest-attempt identity/order,
  last-send/cooldown state, and an in-flight send claim. Preserve the minimal preference and
  deduplication state independently of 90-day history cleanup.
- One reminder record per captured attempt with immutable purchase-choice snapshot, resource kind
  and ID, start/due instants, captured generation, state, safe skip reason, retry bookkeeping,
  send/link expiry metadata, and terminal/cleanup timestamps. Do not store card data or copy
  artwork, postal address, or unrelated patron data into this record.
- Candidate-to-performance relationships for overlap matching, including all bundle performances.
- A stable outbox/job identity and send result linked to reminder history. Store revocation/nonce
  material rather than full signed URLs in staff-facing history.

Index only actual access paths. Required paths are recipient lookup by normalized email; due active
candidates ordered by due time and ID; active candidate matches by performance and email; terminal
history ordered by cleanup time and ID; and paginated Communications history. Prefer partial indexes
for active and terminal subsets. Reuse existing keys/indexes where they suffice. Require real
migrated-schema EXPLAIN QUERY PLAN assertions for recurring selectors.

Completion, opt-out, settings changes, and new attempt capture perform bounded updates to recipient
state and current candidate(s). Scheduled and queued generation-invalidated rows are terminalized in
bounded batches. Cleanup never deletes original payment/donation records, shared communications
history, global delivery suppression, or opt-out state. Purge associated reminder-specific rendered
content and recovery data as well as the visible history row; prevent orphaned outbox payloads from
retaining those copies.

## Scheduler and delivery

1. Capture the candidate transactionally and request the existing scheduler wake helper. Reads never
   arm alarms; a wake never postpones an earlier alarm.
2. The Organization alarm selects indexed due work in fixed batches (initially at most 100) and
   transactionally creates stable outbox jobs. Scheduler-owned continuation handles remaining work.
3. Add a distinct `checkout_reminder` job kind, with its contracts, consumer dispatch, result
   handling, feedback routing, and history integration. Use strongly typed new OrganizationStore RPC
   methods instead of adding internal HTTP dispatch.
4. Before provider work, recheck the enable generation, newest attempt, paid completion, opt-outs,
   general unsubscribe, provider suppression, sales/inventory, event cutoff, and cooldown. Fetch
   external/control-plane checks in the Worker and confirm current store eligibility immediately
   before claiming delivery. Missing or stale eligibility fails closed.
5. Atomically claim delivery for the recipient and candidate so concurrent jobs cannot bypass the
   cross-type limit. Persist stable idempotency and token issuance metadata before external I/O.
   Template rendering and signing/provider work that require external runtime capabilities remain
   outside the Organization Durable Object.
6. Use the existing Organization communications lane, branding, verified sender, and safety modes. A
   reminder is optional communication; do not reuse a receipt path that omits suppression checks.
   Reuse the same logical delivery identity and recovery URL on retries.
7. Persist sent, skipped, retryable failure, or terminal failure results through RPC. Use existing
   bounded retry/dead-letter conventions, with eligibility rechecks on every retry. Keep provider
   errors available to typed internal formatters while recording only safe public explanations.

Never promise exactly-once email from an at-least-once queue alone. Use provider idempotency where
supported by the existing adapter. An ambiguous send result retains the recipient claim/cooldown
conservatively; do not send a fresh reminder because a result write failed. A retry must reconcile
the same delivery, never mint a new campaign. Do not allow generic Communications resend controls to
bypass the single-reminder policy. Prove safe behavior for the actual provider adapter before
enabling real delivery. An in-flight provider call cannot be recalled by a simultaneous unsubscribe,
payment, or disable; all work that has not crossed that boundary must be blocked by the recheck.

## Public recovery and opt-out contracts

Add separate purposes `checkout_recovery` and `checkout_reminder_unsubscribe` to the existing
versioned signed-link envelope. Resolve Organization from the validated hostname before verifying
purpose, resource/subject, signature, expiry, and revocation. Use the existing constant-time
verifier and strict size limits. Add both purposes to the signed-link behavior matrix and
adversarial tests.

Use proposed public views `/checkout/return` and `/checkout/reminders/stop`, backed by a focused
public route module. Reads validate tokens and return only the allowed recovery projection or a
preference confirmation. The stop action is an explicit idempotent POST; a scanner's GET must not
unsubscribe or start a payment. The stop credential is purpose-separated from recovery and remains
usable after the seven-day recovery window and 90-day history cleanup. Follow the existing bounded
unsubscribe envelope policy (one year); expiry of that credential never expires a stored opt-out.

Recovery is a private bearer capability: a forwarded link can reveal the prefilled email and saved
choices. It never verifies email ownership, grants account access, exposes receipts/tickets, or
authorizes newsletter preference changes. Keep email out of token payloads/URL text; bind to an
opaque reminder resource. Revoke recovery for completed/superseded attempts. Suppressions or the
Organization reminder toggle must not prevent a valid stop request.

Use no-store on private API responses, exclude them from service-worker caches, use a restrictive
referrer policy, and avoid analytics or third-party requests that could disclose the token. Preserve
usable signed links through reload, bookmarking, and mobile restoration under web instructions.
Malformed/cross-Organization links must not disclose whether an email or purchase exists.

Restore allowed fields only. Opening a link never reserves stock, revives an expired provider
session, applies a discount, or charges money. The explicit continue action uses existing checkout
validation and a new idempotent request identity. Show changed prices, invalid discount codes,
unavailable levels, and current fees for review. Require reconfirmation of current donation
publication terms, recognition expectations, and deadlines under ADR 0075. The fresh checkout
captures current publication policy; it must not reassign or rewrite the original expired record.
Never transfer an old artwork attachment implicitly.

## Settings, templates, preview, and history

Use the existing Settings → Payments page, with manager authorization enforced at both route and
store layers. The form participates in persisted drafts/SaveBar and unsaved-change protection.
Display the timing/frequency rules and links to both editable templates. Controls remain responsive,
keyboard accessible, and consistent in light/dark themes without eyebrow headings.

Seed separate ticket and donation reminder system templates through forward-compatible defaults;
preserve edited templates on upgrade. Use the existing subject/body editor, reset behavior,
placeholder insertion/guidance, and safe Markdown renderer. Default wording is recorded in the
confirmed interview. Support Organization and recipient names (fallback greeting), checkout summary,
applicable event dates, donation amount/level, and return URL using established syntax. Reject
unsupported/context-inappropriate placeholders rather than leaking raw placeholder text. Escape
values and prohibit arbitrary recipient-data lookup through placeholders.

The final renderer composes protected return and stop actions plus the required sender footer.
Editable use of the return-URL placeholder must not suppress the guaranteed action. Preview the same
full layout with inert sample credentials, Organization branding, and populated example values;
never expose a real patron's private link or mutate preferences from preview. Tests must compare
protected elements in preview and actual rendered delivery.

Extend existing automated Communications history contracts and pagination to include the reminder
kind, recipient/context, safe skip reason, and required states. Current scheduled-message schemas do
not represent this new kind or a skipped state; update server/client contracts together rather than
casting to an unrelated reminder type. Include scheduled work and terminal records without
double-counting. Keep unrelated automated and manual message rendering and filters compatible.

## File Responsibility Map

Paths are repository-relative. New filenames below are proposed; inspect current ownership before
implementation and update this map if responsibilities move.

| Files/modules                                                                                                                                    | Responsibility                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/checkoutReminders.ts` (new), domain tests and exports                                                                       | Timing, completion overlap, newest-attempt and eligibility rules; deterministic clock inputs.                     |
| `packages/contracts/src/checkoutReminders.ts` (new), `communications.ts`, exports and tests                                                      | Settings, recovery projection, opt-out, history and template boundary validation.                                 |
| `apps/worker/src/organization/schema/migrations.ts`                                                                                              | Forward-only reminder persistence and access-path indexes. Coordinate with concurrent publication migrations.     |
| `apps/worker/src/organization/checkoutReminderStore.ts` (new)                                                                                    | Recipient/candidate state, capture, matching, claims, results, preference changes, cleanup queries.               |
| `apps/worker/src/organization/OrganizationStore.ts`, `rpc/types.ts`, `rpc/client.ts`, `rpc/repository.ts`                                        | Typed RPC exposure and Organization identity checks, without extending HTTP dispatch for new operations.          |
| `apps/worker/src/organization/organizationTicketing.ts`, `organizationDonations.ts`, ticketing/donation checkout and Stripe lifecycle modules    | Register usable-session capture; cancel on verified successful completion; preserve existing payment idempotency. |
| `apps/worker/src/organization/scheduler.ts`                                                                                                      | Bounded due work, outbox jobs, retention cleanup, continuation and alarm ownership.                               |
| `apps/worker/src/jobs/contracts.ts`, `consumer.ts`, `deliveries/checkoutReminders.ts` (new)                                                      | Job validation, final eligibility, rendering/signing, provider delivery and result recording.                     |
| `apps/worker/src/communications/`, including provider and email-feedback integration                                                             | Existing optional-email suppression/provider safety and attribution for the new source kind.                      |
| `apps/worker/src/organization/communicationStore/`, new reminder template module                                                                 | Template seeding/customization, history queries, preview data and recipient suppression reuse.                    |
| `apps/worker/src/security/signedLinks.ts`, `routes/publicCheckoutReminders.ts` (new), route group registrations                                  | Signed recovery and stop purposes; hostname-first public boundaries.                                              |
| Existing Organization settings route module plus browser settings API                                                                            | Authorized enable/disable settings transport. Locate actual registration before adding endpoints.                 |
| `apps/web/src/account/OrganizationSettingsPage.tsx`, CommunicationCenter template/history components                                             | Toggle, editor links, editable templates, full-email preview, activity states.                                    |
| `apps/web/src/public/PublicCheckoutReturnView.tsx`, `PublicCheckoutReminderStopView.tsx` (new), `App.tsx`, public-route policies and browser API | Accessible recovery and stop flow; route-level lazy loading and token lifecycle.                                  |
| Existing public ticket/donation forms and `checkoutAttempt.ts`                                                                                   | Prefill/review integration and new checkout creation through existing protected paths.                            |
| Focused unit/UI tests, `apps/worker/test/checkoutReminders.integration.test.ts` and `apps/web/e2e/checkout-reminders.spec.ts` (new)              | Real-schema storage, isolation, queue and browser evidence.                                                       |
| `docs/architecture/signed-link-behavior.md`, `data-model.md`, applicable runbook                                                                 | Document implemented purposes, persistence, safety switch, cleanup, and operational verification.                 |

## Implementation sequence and acceptance evidence

1. Implement domain rules and transport contracts with boundary tests. Cover exact 24-hour and
   30-day boundaries, equivalent email normalization, repeated idempotent requests, cross-type
   replacement, donation amount changes, ticket quantity changes, and partial bundle overlap.
2. Add the forward migration, store methods, RPC, and capture/completion hooks. Test populated
   upgrades, no historical scheduling, rollback-compatible reads, generation invalidation, and
   recipient opt-outs surviving cleanup. Execute queries against real SQLite/workerd, never mocked
   SQL string matchers. Verify indexed selectors with EXPLAIN QUERY PLAN.
3. Add alarm/outbox/consumer flow, sender/template rendering, suppression and feedback integration.
   Prove concurrent job claims, replay, send-result loss, retry with stable identity, uncertain
   provider outcome, opt-out after enqueue, disable/re-enable, late webhook, and dead-letter safety.
4. Implement signed recovery/stop routes, browser views, settings and history/template changes. Test
   cross-host and cross-purpose replay, signature/expiry/revocation failures, scanner GETs,
   duplicate stop POSTs, forwarded-link allowed projection, no token logging/cache leakage, and
   reloading signed views. Verify return after expiry, current-public-page fallback, changed
   publication/price/discount, sold-out tickets, and all-event bundle eligibility.
5. Prove the complete user experience on desktop/mobile in light/dark themes, with keyboard/focus
   and screen-reader labels. Include dirty edit navigation, both templates, placeholder previews,
   protected action visibility, settings saves/errors, history pagination/filtering, and required
   contact re-entry with email prefill.
6. Run focused domain/contracts/Worker/UI tests during development plus relevant formatting, lint,
   typecheck, `check:do-runtime`, and `check:routes`. Build the deployable artifact before prepared
   integration tests. Use the repository's canonical comprehensive gate when full qualification is
   needed; do not reproduce it with redundant ad-hoc suites.

No real provider calls are required for local acceptance. Use deterministic fakes and relative date
factories. Keep existing receipt, ticket confirmation, newsletter preference, tenancy, and route
tests passing. Verify custom public hosts can use these approved public purposes without exposing
authenticated administration.

## Release, rollback, and limits

Implementation is material: it adds communication effects, schema, signed routes, and shared
contracts. Report checks, migrations, accessibility/performance/isolation risks, and generated
artifacts when building it. Allocate any migration number and exact route registrations from the
then-current checkout; unrelated roster and donation publication edits must be preserved.

Use expand-only schema and optional compatible fields so the previous Worker can still operate.
Before a rollback to a Worker unaware of the new job kind, disable reminders, invalidate
generations, and drain/quarantine reminder jobs through a guarded procedure while leaving unrelated
jobs alone. Document whether the prior consumer rejects unknown kinds and prove the rollback
procedure with fixtures. Do not rely on version rollback to undo schema, suppression state, or
emails already sent.

When separately authorized to push main: focused checks → cohesive local commit → complete
`npm run check:release` on the clean committed candidate → push. A later authorized staging
promotion uses only `npm run deploy:staging -- --yes` and matching qualification evidence under the
runbook. Capture immutable artifact hashes, retain the previous Worker Version, and run the required
hosted API qualification. No direct Wrangler promotion, GitHub Actions workflow, unrestricted
staging email, or production launch is introduced here.

This documentation task generates only this plan and the updated interview record. Implementation
must regenerate any affected contract/build/route artifacts using repository commands and report
them with verification evidence. No code or hosted behavior was changed by completing the plan.

## Implementation and verification — November 3, 2026

The prerequisite donation publication task completed successfully; its changes and unrelated roster
edits remain preserved. Reminder implementation is local and uncommitted.

Implemented the shared domain/transport contracts, Organization migrations 134–136, control
migration 0025 for provider attribution, capture after usable-session attachment, completion
matching, newest attempt ordering, settings generations, durable outbox/queue delivery, final
suppression/availability checks, conservative uncertain-send handling and accepted-route
reconciliation, signed recovery and explicit opt-out, restored forms, editable system templates/full
previews, Communications history, and bounded 90-day cleanup. Opt-outs are audited and retained
independently of history.

Additional file responsibilities:

- `packages/domain/src/checkoutReminderTemplates.ts`: shared defaults, supported tags and protected
  action composition used by delivery and preview.
- `apps/worker/src/organization/checkoutReminderDeliveryStore.ts`: due scheduling, send claims,
  eligibility, template metadata, generation invalidation and abandoned-claim cleanup.
- `apps/worker/src/control/migrations/0025_checkout_reminder_email_routes.sql`: expand existing
  provider-route source attribution without adding D1 operational recovery storage.
- `apps/web/src/account/CheckoutReminderSettingsPanel.tsx` and CommunicationCenter's
  `CheckoutReminderTemplatePreview.tsx`: shared SaveBar integration and complete protected-action
  previews; focused UI tests accompany both.
- `apps/web/src/public/PublicCheckoutReminderView.tsx`: lazy public return/stop views; existing
  ticket and donation forms perform fresh checkout validation and preserve current publication
  terms.
- `docs/runbooks/incomplete-checkout-reminders.md`: disable/resume, failures, retention and
  rollback.

Focused evidence: 19 real-Worker reminder integration tests pass, including fake-provider delivery,
real queue replay, custom-public-host recovery, cross-Organization rejection, manager authorization,
opt-out confirmation/idempotency, contact/Profile suppression, inventory/cutoff checks and unknown
send outcomes. Four focused settings/preview UI tests pass. All 14 reminder desktop/mobile browser
acceptance cases pass, covering light/dark donation recovery and opt-out plus individual-ticket,
bundle and expired-link recovery. Unit coverage includes populated upgrades, indexed due/cleanup/
in-flight/generation access, same-millisecond shared payment ordering and cross-type supersession.

The complete local gate passed all static, contract, unit/UI and artifact steps on its preceding run
but found an exact template-list expectation that omitted the two new templates. The inventory
expectation and required default headings were corrected; both focused template integration tests
now pass. The final complete local gate passed all 19 steps: 2,354 unit tests, 1,180 UI tests, and
629 Worker integration tests, plus static/contracts, artifact build, hash verification, and
dependency audit. All 14 focused desktop/mobile reminder browser tests passed on the final recovery
flow.

Artifacts are regenerated by repository build commands and the canonical gate; browser test reports
and screenshots use the existing Playwright configuration. The contract export snapshot adds the new
public contracts while preserving donation publication additions. No package manifests changed. The
dirty local gate cannot provide reusable clean-commit release evidence.

Rollback retains additive schema and preference state, disables/invalidate reminders and drains
recognized jobs before using an older consumer. Already-started provider calls cannot be recalled.
Local tests use fake/capture providers and Organization-isolated bindings; hosted configuration,
real-provider qualification, queue draining and deployment have not been performed. The full
release/browser qualification gate is intentionally deferred because no main push or promotion is
requested; focused browser acceptance and the complete browser-free gate govern this local change.

Final status: local implementation and acceptance checks complete. No unresolved local check failure
remains. No changes were committed, pushed, or deployed, and no real reminders were sent. Unrelated
roster and donation-publication work remains preserved. The deferred implementation heartbeat is no
longer present in the app. Verification logs for this run are
`/private/tmp/checkout-reminders-final-ci.log` and `/private/tmp/checkout-reminders-browser.log`;
they are local evidence, not clean-commit release qualification. The final documentation update only
records results and does not change the tested runtime. Formatting and diff whitespace were checked
afterward.
