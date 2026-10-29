# Event Promotion Coding Plan

Date: October 29, 2026. Status: Phases 0–5 implemented and verified locally. Scope: the approved
Promotion section in the event editor, including announcement history and deliberate follow-ups.
This document does not authorize sending messages, pushing changes, or deploying.

## Outcome and approved direction

Help an Organization administrator invite previous ticket buyers and other eligible Contacts to a
new Performance after it is published and ticket sales are enabled. Contacts do not need any ticket
purchase history to qualify through the Contacts audience. Add **Promotion** to the event editor's
existing section navigation and mobile section selector. Reuse the application's communication
system end to end.

The selected visual direction is
[the Promotion workspace mockup](assets/event-promotion-concept.png). Treat its structure as the
visual target, not its invented branding, counts, exact copy, or custom controls. Use current
application tokens, primitives, and communication controls. The mockup's apparent one-announcement
rule means one initial announcement, followed by explicitly reviewed follow-ups; it is not a ban on
follow-ups. The approved scope now also includes Contacts alongside past buyers; the mockup predates
that audience expansion and must not be used to restrict selection to buyers.

This plan deliberately excludes a new Events-page Promotion dashboard and a blocking post-publish
modal. A small contextual prompt and the Promotion section supply the encouragement without
introducing another management surface.

## Implementation and handoff status

The approved feature is implemented in the current working tree. Changes remain uncommitted; nothing
has been pushed or deployed. Phase progress has been posted to GitHub issue
[#316](https://github.com/wesochuck/choir-management-cloudflare/issues/316).

| Phase                                     | Status   | Delivered                                                                                                                                                                                                                                   |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Confirm architecture and reuse         | Complete | Added ADR 0070; confirmed the existing Communications composer, audience resolver, canonical message/delivery records, queue, and provider paths remain the owners.                                                                         |
| 1. Contracts and Organization storage     | Complete | Added backward-compatible promotion context, audience source/exclusion fields, stable draft IDs/revisions, event association, migrations 128–129, and delivery attribution.                                                                 |
| 2. Audience, history, and send boundaries | Complete | Added buyer-plus-Contact resolution, bounded overflow reporting, event-scoped history, review freshness, atomic send/outbox behavior, and final current-buyer race protection.                                                              |
| 3. Event editor experience                | Complete | Added the Promotion section, eligibility states, contextual prompt, shared composition/review/test/history/delivery controls, deliberate follow-ups, and a Promotion deep link.                                                             |
| 4. Reliability and focused verification   | Complete | Added draft/follow-up retry protection, signed review snapshots, unsaved composer retention, lazy-loaded Promotion code, and desktop/mobile browser coverage. Fixed the default invitation’s incompatible location token for Ticket Buyers. |
| 5. Comprehensive verification             | Complete | `npm run check:ci` passed all 19 steps, including audit, typecheck, lint, unit/UI suites, build, and all Workerd integration tests. The focused Promotion browser scenario passed in desktop and mobile Chromium.                           |

The whole-app Chromium E2E suite was not run; the focused Promotion scenario was run in desktop and
mobile Chromium. The plan checklist below leaves broader acceptance scenarios open where this pass
did not exercise them directly. Do not commit, push, or deploy as part of this handoff.

## Verified reuse inventory

These findings come from the current repository, not assumptions about a future implementation.

| Responsibility                                                  | Existing owner                                                                                      | Required approach                                                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Compose fields, templates, formatting tools, responsive preview | `apps/web/src/account/components/CommunicationCenter/MessageComposer.tsx`                           | Extract a reusable composition session and add a constrained event-promotion preset; render the same component in both places. |
| Audience controls and reach summary                             | `CommunicationCenter/RecipientContextPanel.tsx`, `hooks.ts`, `utils.ts`                             | Extend the shared audience model and controls; never compute a separate recipient list in React.                               |
| Review and confirmation                                         | `CommunicationCenter/CommunicationReviewDialog.tsx`                                                 | Reuse the existing review dialog and explicit final send action.                                                               |
| Test email, templates, delivery results                         | `CommunicationTestDialog.tsx`, `SaveAsTemplateDialog.tsx`, `CommunicationDeliveryDetails.tsx`       | Reuse these controls and the existing backend operations.                                                                      |
| Browser communication API                                       | `apps/web/src/api/communications.ts`                                                                | Extend existing typed requests and add only the event-scoped reads/association operations that are missing.                    |
| Request validation and message types                            | `packages/contracts/src/communications.ts`                                                          | Add backward-compatible optional context and audience extensions.                                                              |
| Audience selection and suppression                              | `apps/worker/src/organization/communicationStore/audience.ts`, `organizationCommunications.ts`      | Extend these resolvers once; preview and actual send must use the same rules.                                                  |
| Canonical messages, deliveries, audits, idempotency, outbox     | `communicationStore/messages.ts`, `contracts.ts`, `shared.ts`                                       | Keep using `communication_messages`, `communication_deliveries`, and the scheduler outbox.                                     |
| Delivery jobs and provider feedback                             | `apps/worker/src/jobs/deliveries/communication.ts`, `apps/worker/src/communications/`               | Preserve the current queue, provider, feedback, unsubscribe, retry, and rendering paths.                                       |
| Template placeholders and preview rendering                     | `packages/domain/src/communicationPlaceholders.ts`, `apps/web/src/account/communicationMarkdown.ts` | Reuse current escaping/rendering and add a public purchase-page placeholder only if none exists.                               |
| Organization RPC                                                | `OrganizationStore.ts`, `organization/rpc/`                                                         | Extend the communication RPC domain; do not create internal HTTP routing for this feature.                                     |

Paths abbreviated in this table are within their previously named directories. Resolve actual
exports before editing; proposed new filenames below are responsibilities, not claims that files
exist.

### Concrete gaps to close

1. `audience.eventId` currently supplies event context **and** limits Ticket Buyer selection to
   purchases for that event, including bundle allocations. Setting it to the new Performance would
   target its existing buyers rather than previous audiences.
2. The current draft request has no persisted draft ID. `saveDraft` inserts a new message, and
   sending currently creates another message ID. Promotion requires a stable persisted draft
   identity and an atomic draft-to-queued transition.
3. Marketing commerce selection currently has a 500-purchase query limit. The existing overflow
   reporting is specific to ticket-service audiences. A bounded partial query must not be presented
   as the complete past-buyer audience.
4. Messages expose created/sent timestamps, but the public message contract does not expose sender
   attribution or a dedicated promotion association. Add safe attribution rather than guessing it
   from the current session.
5. The existing `{{TICKET_LINK}}` placeholder represents an existing order. It must not be used as
   the purchase link for a new event.

## Product behavior

### Availability and encouragement

- Show Promotion for Performance events, including an explanatory locked state before eligibility.
  Hide it for Rehearsal and Other events.
- An eligible target is a saved, upcoming, active Performance with `publishOnWebsite` and
  `isTicketingEnabled` both true. Reuse the existing authoritative lifecycle, sales-availability,
  timezone, and public-link helpers; inspect their owning contracts before coding. Do not substitute
  a new inferred status field.
- After a successful event save makes both conditions true, show a compact inline prompt: **“Your
  event is ready. Invite past ticket buyers.”** Action: **Prepare announcement**, opening Promotion.
  Never enqueue as a side effect of saving or publishing.
- On reopening any eligible event with no queued/sent announcement, show the prompt again without an
  interrupting dialog. Use server-backed message state; do not introduce dismissal persistence or a
  recurring reminder job in this scope.
- Only saved event values populate templates and public links. Unsaved edits show **Save event
  changes before preparing or sending an announcement** and offer the existing event save flow.
  Existing historical messages remain viewable.
- Empty audience, loading, fetch failure, unavailable sender settings, and overflow are distinct
  actionable states. Reuse existing email-settings validation and link to its settings surface. No
  usable recipients means no send action.

### Unsent and draft states

The section uses the existing composer with Email and marketing mode fixed. Allow Past ticket
buyers, Contacts, or both through the existing audience controls. Keep Past ticket buyers selected
by default; including Contacts is an explicit choice. Do not expose Members, Donors, SMS, or
ticket-service mode in this preset. Show the eligible reach, source-event filter when buyers are
selected, shared Contact targeting controls when Contacts are selected, checked-by-default
current-buyer exclusion, editable subject/body, preview, Save draft, Send test, and Review & send.
Retain template selection/save-as-template through existing controls.

Start with a prefilled invitation containing the target event title, date/time, venue, Organization
branding, and canonical public ticket-purchase URL. Use the existing template registry/default
infrastructure if this starter is stored as a template. It is a manually initiated invitation, never
a scheduled system reminder. Do not overwrite a persisted draft when defaults or event data refresh.

Default audience: opted-in paid buyers from prior completed Performances in this Organization,
excluding current target-event buyers. Offer “All previous performances” or a bounded explicit
selection of previous Performances. Never label a query covering future events “previous
performances.” Use the shared event lifecycle/time rules for the past-event cutoff. Fully refunded,
canceled, pending, and expired orders are not qualifying paid purchases; use the commerce model's
authoritative status rules.

### Including Contacts who have never purchased

Reuse the existing Contacts audience, Contact Lists, explicit Contact IDs, source and email-status
filters, and their existing selection/union semantics. Do not create a separate mailing-list
manager, copy Contacts into purchases, or add a new contact picker/resolver when shared controls
already serve that purpose. Extract or expose existing controls as needed. Contacts-only is a
supported promotion, including an Organization with no previous ticket sales.

Make the existing default clear: with Contacts enabled and no lists or explicit selections, all
matching eligible Contacts are included. Display that scope before review rather than silently
adding the entire database. Contact eligibility follows the existing Communication Center rules,
including its handling of unknown email preference status; buying a ticket is not required. Do not
infer new consent or mark a Contact subscribed. Preserve unsubscribe, linked-profile suppression,
provider suppression, and do-not-email precedence. A subscribed-only filter can narrow Contacts
using the existing control; this feature does not redefine the application's consent policy.

Merge buyer and Contact candidates through the existing shared deduplication service and show one
combined unique eligible-recipient count. A person in several Contact Lists or both audiences gets
one email. Source-event and paid-purchase filters apply only to the buyer branch, never to the
Contacts branch. Current-event purchaser exclusion applies to the entire merged audience, including
Contacts-only sends, so adding someone through a Contact List cannot bypass it. Shared suppression
precedence also applies across both branches. Test emails, drafts, review, follow-ups, and opening a
draft in Communication Center must preserve both audience branches and their filters.

### Message lifecycle and already-sent behavior

| Canonical state                 | Promotion presentation                                                          | Available actions                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No associated message           | Not sent yet; editable prepared invitation                                      | Save draft, Send test, Review & send                                                           |
| Draft                           | Draft saved; resume same persisted record                                       | Edit/save, review/send, existing draft deletion                                                |
| Queued or processing deliveries | Announcement queued/sending; immutable queued content                           | Existing delivery results and cancellation where permitted; no second initial send             |
| Sent                            | Announcement sent with time, queued-by actor, reach and actual delivery summary | View message, View delivery results, Create follow-up                                          |
| Failed or partial failure       | Delivery issue with actual sent/failed/suppressed counts                        | Existing retry-failed flow; never resend successful deliveries                                 |
| Canceled                        | Canceled, retaining message and delivery history                                | Existing results; deliberate Create follow-up/replacement, warning if any deliveries succeeded |

Use canonical message and delivery status together. Do not equate queue acceptance with Sent,
provider acceptance with confirmed delivery, or a failed row with nobody having received anything.
Clearly label the actor as the person who queued the announcement; the email's From identity remains
the configured Organization sender.

After queueing, show a read-only copy of that message and its saved content, not a new rendering
from today's event details. Delivery views must use the existing details/pagination APIs. If exact
rendered per-recipient bodies are not stored today, show the saved subject/body and historical
context, explicitly label any sample rendering, and do not promise an exact archived delivered
email.

List initial announcement and follow-ups newest first with timestamp, actor, state, and details
action. Sending from either Communication Center or Promotion must update the same records and
presentation after refetch.

**Create follow-up** creates a new, explicitly labeled draft linked to the same event and prior
message. It defaults to excluding current buyers and requires fresh reach review and send
confirmation. It may reach previous announcement recipients who have not purchased; do not silently
exclude all previous recipients. Ordinary retries reuse the original message and existing
failed-delivery mechanism instead.

Saving, republishing, toggling ticketing, refreshing, or reopening an event never sends or resets
its announcement history. Unpublishing, cancellation, archive, or ended sales blocks new promotion
sends and displays the reason; history remains readable. Do not silently cancel existing queued
messages: expose the existing cancellation action and document that queued delivery retains existing
lifecycle semantics. Automatically canceling queued campaigns on event changes is outside this
scope.

## Shared contracts and data design

### Separate message context from buyer selection

Add a backward-compatible optional typed message context such as
`context: { kind: "event_promotion", eventId, announcementKind: "initial" | "follow_up", parentMessageId? }`.
Persist it with the canonical message. The target event ID is context, not the Ticket Buyer source
filter. Existing messages without context retain existing semantics.

Extend the shared marketing audience contract with bounded source-event selection and
target-purchase exclusion, using explicit fields such as `ticketBuyerSourceEventIds`,
`ticketBuyerPastEventsOnly`, and `excludeTicketBuyersForEventId`. Omitted fields preserve old
behavior. For promotion with Ticket Buyers selected, require the past-only flag; an empty source-ID
array means all qualifying previous Performances. Contacts-only requests do not require purchase
sources or purchase history. Reject or normalize irrelevant buyer-source filters consistently when
the buyer branch is deselected; never apply them to Contacts. Do not reinterpret existing
`audience.eventId` for old messages. For promotion set it null and obtain placeholder context from
the typed message context. Include context in preview, test-email, draft, send, and persisted
message responses.

The server allows exactly the existing `Ticket Buyers` and/or `Contacts` target audiences for this
preset, with at least one selected. It validates context/audience consistency, Email-only marketing
delivery, every source event, exclusion event equality with the target, and follow-up parent
ownership. Reject unsupported combinations with typed errors. The generic Communication Center must
preserve these fields when opening a promotion draft; it cannot strip the context, unlock
ticket-service mode, or bypass eligibility by using its generic send endpoint.

Source and exclusion resolution must recognize direct purchases and bundle allocations, Contact
identity and normalized email aliases, case-insensitive destination deduplication, and suppression
precedence. Excluding a current buyer excludes their matching destination even when their earlier
purchase has a different purchase ID. Use existing identity helpers, not a competing identity
resolver.

### Stable drafts and minimal association

Extend shared draft/save/send operations to accept a persisted draft ID and optimistic revision.
Saving updates only a Draft; sending transitions that same record atomically to Queued. Never mutate
sent content. Preserve legacy create-without-ID behavior for existing callers. A stale revision
yields a typed conflict with reload/keep-editing handling, rather than overwriting another
administrator's changes.

Add one small Organization-local association table, provisionally `event_communication_links`,
containing target event ID, message ID, initial/follow-up kind, parent message ID, and creation
metadata. Store content, audience, lifecycle, recipients, and delivery counts only in canonical
communication tables. The association is not a second campaign entity or delivery system. Keep
message context and association consistent in the same transaction; all mutations go through shared
communication services.

Use a unique constraint for one initial message association per event, and a unique message
association. Initial draft deletion may remove its association transactionally before any queueing.
Once an initial message has queued, retain that association/history even on cancellation or failure;
subsequent intentional attempts are follow-ups/replacements. A repeated Create follow-up request
must return the same newly created draft via an operation key, not generate multiple drafts.

Justify an `(event_id, created_at, message_id)` history index for bounded event history pagination.
Reuse the unique initial constraint as the initial-announcement lookup access path. Inspect actual
schema and query plans before adding purchase/source/exclusion indexes; add only those required by
the implemented queries. No operational data goes into D1 or KV.

### Transaction and concurrency invariants

- One authoritative initial reservation/draft per event across administrators, tabs, retries, and
  reloads.
- Generate a stable server-owned send dedupe key from the persisted promotion message identity. A
  different client idempotency key cannot create a second initial send.
- Validate the draft revision, current target eligibility, association, and permitted state inside
  the final Organization DO transaction that queues it.
- Recompute recipients through the shared resolver immediately before queueing. Detect changes since
  review and require renewed review when the confirmed snapshot/revision no longer matches; never
  silently add recipients after confirmation. Bound the review snapshot or fingerprint and expiry;
  the browser is not the authority.
- Make send-time exclusion authoritative against purchases committed before queueing. Preserve
  delivery-time consent/suppression rechecks. Do not promise that buyers purchasing after queueing
  are automatically removed unless a narrowly scoped shared delivery-time exclusion check is added
  and tested.
- Atomically persist message transition, association, delivery rows, audit event, and existing
  outbox job. Refactor `sendMessage` into shared transaction-safe internals; never call its
  independent transaction/wake path from another transaction and assume the work is atomic.
- Reuse current alarm/outbox handoff and delivery idempotency. No provider work, fetch, timers, or
  `waitUntil` inside the Organization DO.

### Bounded audience resolution

Keep existing recipient/delivery limits. Add truthful overflow detection for marketing selection as
well as ticket-service selection, and for the existing 500-row Contact selection cap; do not raise
limits to fit this feature. Combined audiences must respect the existing final recipient and
delivery limits after deduplication; neither branch may be silently truncated. The existing
marketing path limits purchases before recipient deduplication, so distinguish purchase-scan bounds
from unique-recipient limits. An overflowed query blocks send and explains how to narrow source
events or Contact filters as applicable; do not display the first 500 purchases as the whole
audience or infer full reach after deduplication.

Use a bounded query with an overflow sentinel or equivalent indexed count under the same filters.
Avoid materializing all historical purchases, per-recipient database queries, and client-side
enumeration. Keep source lists and history paginated. Test SQL access paths with representative
history and document any required selective indexes.

## Implementation sequence and File Responsibility Map

Implement in dependency order. Each implementation commit should include its focused regression
coverage. This table is this feature plan's responsibility map; update the main milestone map only
if this becomes active milestone execution.

| Step                                      | Files/modules                                                                                                                                                                       | Deliverable                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Lock shared semantics                  | `packages/contracts/src/communications.ts` and tests; `packages/domain/src/communicationPlaceholders.ts` and tests                                                                  | Context, source/exclusion filters, persisted draft revision, lifecycle summaries, review-snapshot contract, purchase-page placeholder if needed. Document accepted decisions in a new ADR before implementation; do not treat this proposal as an accepted ADR.         |
| 2. Expand Organization storage            | `apps/worker/src/organization/schema/migrations.ts`, schema registry/tests, `communicationStore/contracts.ts`, `shared.ts`, `messages.ts`                                           | Forward-only fields/association migration; stable draft update/send; server dedupe; atomic message/outbox/link transitions; safe attribution. Choose migration number at implementation time.                                                                           |
| 3. Extend shared audience and service     | `communicationStore/audience.ts`, `organizationCommunications.ts`, `organization/rpc/`, `OrganizationStore.ts`                                                                      | Shared source/exclusion resolution, truthful overflow, review freshness, target eligibility, typed RPCs and paginated event history. Keep existing generic audiences backward compatible.                                                                               |
| 4. Extend existing HTTP/client boundaries | `apps/worker/src/routes/organizationCommunications.ts`, route registration/probe contracts, `apps/web/src/api/communications.ts`                                                    | Reuse existing draft/send/reach/test/results endpoints; proposed event-filtered history and create/resume operations only where needed. Apply existing communication authorization plus authoritative event checks. No public send or separate promotion-send pipeline. |
| 5. Extract reusable composition session   | `CommunicationCenter/hooks.ts`, `types.ts`, `MessageComposer.tsx`, `RecipientContextPanel.tsx`, `CommunicationReviewDialog.tsx`, `view.tsx`; proposed `useCommunicationComposer.ts` | Shared draft, reach, templates, review, test, send, typed errors, dirty/revision handling with optional constrained preset. Leave center history/settings orchestration outside the extracted hook. Preserve default behavior.                                          |
| 6. Add event section                      | `EventsPage/eventSections.ts`, `eventDirtySections.ts`, `EventEditorDialog/EventEditorDialog.tsx`, `EventEditorHeader.tsx`; proposed `PromotionSection.tsx` and hook                | Section/mobile selector, inline prompt, eligible/locked/empty states, shared composer, sent state, history, follow-ups, delivery-details reuse.                                                                                                                         |
| 7. Finish state and presentation          | Shared query-key registry, existing SaveCoordinator/usePersistedDraft integration, communication/event styles                                                                       | Targeted invalidation across both surfaces; independent event/message saving; responsive, light/dark, keyboard and focus behavior; preserve route-level code splitting.                                                                                                 |
| 8. Verify and document                    | Existing communication integration suites, event/communication UI suites, E2E, ADR and architecture documentation                                                                   | Acceptance coverage below; migration/access-path notes; implementation report.                                                                                                                                                                                          |

Before adding routes inspect existing registrations, communication history filters, RPC operation
maps, authorization, and navigation handoff. Prefer an event filter on existing history plus shared
message-detail loading over another history API. Do not load full global communication history to
filter one event in the browser.

## UI state and accessibility requirements

Maintain separate event and message baselines. Event Save does not save/send the announcement; Save
draft does not save event edits. Coordinate both dirty states through the existing
Dialog/SaveCoordinator conventions, including section switches, closing, Escape, backdrop,
navigation, and sign-out. Never discard one draft while initializing the other.

The Promotion preset may use layout slots in the shared composer to match the mockup's
audience/content/preview arrangement; do not fork its rendering or validation. Shared element IDs
must be unique when the event editor and Communication Center are mounted together. Lazy-load heavy
composition code when entering Promotion using `lazyWithRetry`/`importWithRetry`.

Use `@choir/ui` dialogs and confirmation primitives; retain focus on validation failures and restore
focus after review/test/results dialogs. Announce state changes and reach errors without relying on
color. Stack preview beneath fields on narrow screens, preserve sticky footer geometry, and use
existing theme tokens. No eyebrow labels. Keep signed unsubscribe/order links out of logs and public
purchase-page URLs free of private order credentials.

## Regression and acceptance coverage

### Contracts and domain

- Old draft/send/audience payloads still parse with unchanged behavior; promotion combinations
  reject ticket-service/SMS/mismatched target or parent.
- Target event context populates the new invitation without filtering recipients to target-event
  purchasers.
- Purchase link points to the canonical public event checkout/page; order-access links and
  credentials cannot leak into a promotional message.
- Existing personalizations, Markdown escaping, templates, and preview behavior remain intact.

### Organization integration and adversarial cases

- Prior-event paid opt-ins qualify; no opt-in, suppression, invalid address, disallowed order
  status, or future source event does not. Bundles and duplicate/aliased Contacts are covered.
- Current-event buyers are excluded across direct orders, bundles, normalized addresses, and
  purchase IDs. Checkbox off changes preview and actual send consistently.
- More than the bounded purchase scan or recipient limit produces explicit overflow and blocks
  sending; duplicate-heavy histories do not produce false claims of complete coverage.
- Preview, review, queueing, and retry use the shared resolver/suppression rules; unsubscribe
  between preview and queue/delivery blocks the appropriate work.
- Two initial creations, saves, or sends from concurrent administrators yield one initial record and
  one outbox delivery sequence. Different keys, reload after timeout, stale revisions, queue replay,
  and repeated follow-up creation are covered.
- Event unpublished/canceled/archived or sales disabled between review and send rejects queueing
  without orphan association/delivery/outbox rows. Purchase changes before queueing invalidate or
  refresh review safely.
- Draft deletion and cancellation keep canonical history consistent; sent snapshots stay immutable.
  Failed-delivery retry never duplicates successful deliveries.
- Communication Center can resume/send the same promotion draft, preserves all constraints, and
  updates Promotion's history. Generic API calls cannot strip a linked draft's promotion context.
- Wrong hostname, Organization ID, event ID, message ID, follow-up parent, unauthorized membership,
  and expired elevation cannot cross tenant boundaries.
- Migration works on fresh and populated stores; legacy messages remain readable; query plans
  support bounded source selection and event history.

### Additional Contact and mixed-audience acceptance cases

- A Contacts-only announcement reaches an eligible Contact with no purchase history, including when
  the Organization has no historical purchases. At least one audience must remain selected.
- Contact Lists, explicit selections, source/status filters, and their existing union semantics
  match Communication Center. Clearing filters accurately warns that all matching eligible Contacts
  qualify.
- Buyer-only, Contacts-only, and combined previews match the queued audience; buyer source filters
  do not constrain Contacts. A failed purchase opt-in does not override independently valid Contact
  eligibility, while unsubscribe/suppression from either identity retains precedence.
- Multiple lists and buyer/Contact overlap yield one destination delivery and truthful unique reach.
  Current-event buyer exclusion works even for a Contacts-only message and bundle purchaser.
- Existing unknown/subscribed/unsubscribed Contact preference behavior is unchanged; selecting a
  Contact never subscribes them or bypasses suppression. Explicit subscribed-only filtering works.
- Each branch's scan overflow and the combined recipient limit block sending without
  partial-audience claims. Cross-Organization Contact IDs and Contact List IDs never select foreign
  recipients.
- Draft resume, follow-up, test email, review freshness, and generic-center editing retain Contact
  filters, source filters, and global purchaser exclusion. Contact/list/preference changes after
  review follow the same shared refresh and delivery-time checks.

### UI and E2E

Extend `CommunicationCenter` component tests, `EventsPage/EventEditorDialog.ui.test.tsx`, and
focused browser scenarios in `apps/web/e2e/communications.spec.ts` or a dedicated promotion spec.
Extend `apps/worker/test/communicationsAudience.integration.test.ts`,
`communicationsDraftsTemplates.integration.test.ts`, `communicationsDelivery.integration.test.ts`,
and `communicationsPagination.integration.test.ts` as appropriate.

Cover locked-to-ready transition after saved publication/ticketing, preparation without sending,
save/reopen/update same draft, test email, review/back/edit/confirm, queued-to-sent, delivery
failures, explicit follow-up, two-tab conflict, refresh, generic-center interoperability, zero
reach, overflow, permission failure, dirty-close protection, mobile navigation, keyboard/focus, and
both themes. Use fake providers; no test sends real mail or creates real charges.

## Verification and release procedure

This is a material implementation. During development run focused contract/domain/component/Worker
tests plus relevant format, lint, typecheck, DO-runtime, and route checks. After route changes run
`npm run check:routes` and maintain `npm run qualify:staging:evidence` boundary coverage. Build the
deployable artifact before `npm run test:integration:prepared` when invoking that focused
integration path.

For implementation handoff without a release, use `npm run check:ci` for browser-free comprehensive
verification when appropriate and run focused desktop/mobile promotion E2E. Report exact checks and
any skipped gates. For an authorized release follow the repository's canonical order: focused
checks, cohesive local commits, `npm run check:release` on the clean committed candidate, push, then
`npm run deploy:staging -- --yes` only when authorized. Do not run a redundant full gate/build
immediately before `check:release`. No production changes and no GitHub workflow additions.

## Migration, rollback, and operational risks

Use forward-only expand/contract migrations with defaults preserving legacy behavior; never rewrite
an applied migration. An older Worker can ignore association/context/revision fields, but its
generic send path may not enforce new promotion invariants. Therefore rollback requires stopping new
promotion mutations and preventing linked draft sends through incompatible older handlers before
reverting. Preserve all message/delivery/link rows and allow already queued communication jobs to
complete under the existing backward-compatible job contract. Do not claim binary compatibility
merely because SQLite additions are nullable.

No new provider, credentials, DNS, subscription, queue, scheduler cadence, or hosted resource is
required. The intended external effect is an explicitly confirmed marketing email through the
existing Organization configuration. Preserve unsubscribe URLs, physical-address footer, credential
redaction, branding, and consent rechecks. Remaining risks are shared-composer regressions, stale
audience review, concurrent sends, purchase identity exclusion, historical purchase scan cost, and
accurate delivery-state presentation; the required tests directly cover these.

Generated planning artifact: `assets/event-promotion-concept.png`, copied from the selected ImageGen
concept. Regenerate only for an intentional visual revision using the existing app screenshot as
style grounding; it is documentation, not a runtime asset. This plan does not change GOAL or
READINESS and is not active milestone execution.

## Completion checklist for the implementing agent

- [x] Promotion matches the selected direction using shared communication components and services.
- [ ] Initial, draft, queued, sent, failed, canceled, and follow-up states behave as specified.
- [x] Promotion and Communication Center operate on the same canonical message identities and
      history.
- [x] Contacts-only, buyer-only, and mixed audiences reuse shared filters and deduplication; current
      purchaser exclusion applies across all selected audiences.
- [x] Audience selection separates target context from prior purchase sources and reports bounded
      overflow honestly.
- [ ] Server-side atomicity, stable dedupe, review freshness, authorization, and tenant isolation
      are demonstrated.
- [x] No new communication delivery system, automatic marketing send, provider integration, or
      recurring scan exists.
- [ ] Required regression/accessibility checks pass; report migration/rollback, external effects,
      performance, artifacts, and exact verification results.
