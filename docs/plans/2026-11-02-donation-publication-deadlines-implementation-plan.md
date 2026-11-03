# Donation publication deadlines implementation plan

Status: Implemented locally; acceptance verified on 2026-11-03. Shared understanding confirmed on
2026-11-02; implementation subsequently authorized in chat. No push, deployment, provider change, or
production work is authorized by this document.

## Outcome and scope

Let an Organization communicate publication expectations clearly without closing donations or
artwork submissions. Configure one named publication at a time with two optional overall dates: the
name-recognition cutoff and the artwork submission deadline. Dates are shared across donation
levels. Staff can review late gifts and artwork and record inclusion in the original or a later
publication without silently moving the original donation.

Use existing Donation Page Settings, Donation History, public donation/receipt/artwork views, and
payment notification delivery. Preserve Organization isolation, authoritative payment fulfillment,
signed-link security, accessible responsive layouts, and bounded storage work. See
[ADR 0075](../adr/0075-donation-publication-history-and-soft-deadlines.md) and the
[design interview](2026-11-02-donation-publication-deadlines-design-notes.md).

## Earlier interactive mockups

The two mockups shown during design exploration are retained as standalone HTML references:

- [Initial settings and donor-experience concept](../mockups/donation-publication-deadlines-concept.html):
  publication name, two overall date controls, and before/after donor messaging.
- [Current donation-page layout with deadline states](../mockups/current-donation-page-publication-deadlines.html):
  the existing level grid, artwork section, contact/preferences, and donation summary, with a
  preview selector for the current page, before both deadlines, after the artwork deadline, and
  after both deadlines. Levels are selectable; checkout is a simulation and takes no payment.

These preserve the earlier exploration, including sample branding, levels, and dates. They are
visual references, not the final behavior specification. The agreed rules below supersede several
details in the mockups:

- Show dates in one overall notice and relevant summary/upload copy, **not on donation-level
  cards**. Both dates are optional and shared across all levels.
- Replace hard-exclusion wording such as “not included” or “placement is closed” with explicit
  **“Inclusion in [publication] is no longer guaranteed.”** Continue accepting artwork after the
  deadline; do not hide its upload controls as the current-page exploration does.
- Include the same clear expectations in receipt email and the signed-link upload view. The mockups
  do not depict the subsequently agreed staff review, later-publication inclusion, or
  historical/revised-deadline behavior.

The files were exported from the original conversation previews using the visualization export
renderer; they are reference documents, not runtime assets and are not imported into the app.

## Agreed behavior

1. One named publication is current per Organization; retain previous publications for history and
   review. Creating the next publication is distinct from renaming or editing the current one.
2. Each date can independently be unset. An unset date produces no notice or late flag for its
   category. Configured dates stay open through 11:59 p.m. in the Organization timezone.
3. Donations and eligible artwork submissions remain available after deadlines. Use explicit
   wording: **“Inclusion in [publication] is no longer guaranteed.”** Never equate accepting a gift
   or file with confirming publication placement.
4. Successful payment determines whether an online gift meets the recognition cutoff. Starting
   checkout does not qualify. A checkout keeps the publication presented at checkout creation even
   if another publication becomes current before payment completes.
5. Checks and cash use the actual received date entered by staff, not the data-entry timestamp.
6. Highlight late gifts and late artwork separately. Staff can consider either for a later
   publication. No automatic carry-forward or reassignment occurs.
7. Staff can mark a donation **“Included in [publication]”**. Preserve original details, record who
   made the decision and when, and remove the resolved item from outstanding review. Keep the
   original late facts visible in history.
8. Extending a deadline reevaluates late flags for that publication. Preserve inclusion decisions
   and previously generated/sent receipt content. Shortening a deadline applies going forward;
   submissions that met the previously advertised deadline keep their on-time treatment.
9. Existing donations start unassigned. Staff may select older gifts for inclusion; never infer that
   old donations belong to the current publication or that they have not already been printed.
10. No per-level dates, automatic inclusion emails, program-layout/printing tool, or new provider
    integration is included.

## Current implementation and required changes

- `donationSettingsSchema` currently contains page copy, levels, and thank-you copy; there is no
  publication or deadline model. Settings persist in Organization metadata JSON.
- Checkout captures selected level and artwork details. Donation records expose creation/update
  timestamps, but no dedicated publication eligibility timestamp. Do not use `createdAt` or
  `updatedAt` as a substitute for successful payment time.
- `insertDonationConfirmation` in `donation/stripeLifecycle.ts` builds stored payment notification
  content and appends program-ad information. Its existing “at any time” upload wording needs the
  publication qualification, including for customized templates.
- Artwork attachment currently replaces the file and upload timestamp. Preserve enough submission
  history to distinguish timely initial artwork, late replacement artwork, and deadline changes.
- Donation history currently returns the newest 500 records. Client-only filtering would silently
  omit older publication candidates; introduce bounded server-side filtering and continuation for
  publication review rather than increasing that cap or loading every donation.

## Domain and persistence design

Add forward-only Organization SQLite migrations at the next available migration version. Do not
change D1 ownership or rewrite applied migrations. Final column names follow existing conventions.

| Record                           | Responsibility                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication                      | Stable ID, display name, current/previous state, Organization timezone context, creation/update metadata. One current publication enforced transactionally. |
| Publication deadline revision    | Recognition/artwork dates, resolved UTC boundaries, effective time, actor, and revision. Preserve the advertised policy across edits and rollover.          |
| Donation publication association | Original publication ID and advertised revision, authoritative payment/received time, and source of that time. Nullable for historical/unconfigured gifts.  |
| Artwork submission fact          | Donation, file, server-received time, publication policy context, and replacement identity sufficient for accurate flags and audit.                         |
| Publication inclusion decision   | Donation, target publication, actor, time, and decision version. Separate from the original association and from financial/thank-you status.                |

Use pure domain helpers to derive recognition and artwork status independently: unconfigured,
pending/not received, on time, or after cutoff. Pending, expired, and refunded donations must not
appear as paid candidates for new inclusion. Anonymous gifts retain privacy; neither on-time status
nor a staff action may imply permission to print a donor's name. Retain prior inclusion history if a
donation is later refunded and show its current financial state.

Keep eligibility facts separate from staff review resolution: a late fact remains true after staff
records inclusion, while the outstanding-review predicate excludes resolved items. A subsequent
artwork replacement must not silently change a recorded inclusion decision or conceal that the
replacement arrived late. Present that change for review with prior inclusion visible.

Deadline edits require version-aware evaluation, not a comparison against only today's settings.
Extensions can improve eligibility for the same publication. Earlier revisions must remain available
to honor submissions that were already on time. Unset dates impose no cutoff; adding a date later
must not retrospectively penalize submissions accepted without a deadline. Preserve the policy shown
to an already-created checkout and validate settings revision conflicts before starting a new
provider session. A stale form refreshes publication expectations without losing donor input; it
must not silently attach the donation to a different publication.

Use authoritative successful-payment evidence carried through the existing verified completion and
reconciliation flows, including delayed/duplicate webhook delivery. Inspect the provider event
mapping during implementation; extend typed internal operations to carry the trusted timestamp where
absent. Never use webhook delivery/processing time or a client timestamp as payment success time.
For historical records without evidence, retain unknown rather than fabricating it.

For manual gifts, retain the entered received date/time distinctly from audit creation time and
evaluate it in the Organization timezone. Staff can explicitly choose a retained publication when
recording a backdated gift; do not infer publication ownership from the date alone.

All writes are atomic, idempotent, Organization-owned, and audited. Use optimistic revisions for
publication edits and review decisions; retries must not duplicate publications or inclusions.
Retain signed-link purpose, Organization binding, expiry and revocation behavior; a soft artwork
deadline does not make a signed link permanent or bypass authentication. Existing link refresh paths
must continue to resolve the donation's original publication.

## User experience and copy

### Donation Page Settings

Add a Publication recognition section with publication name and independently optional date inputs.
Show Organization timezone and end-of-day semantics. Provide an explicit **Start next publication**
action that retains history; editing a name is not rollover. Clearly distinguish editing dates from
starting a new publication. Use existing persisted-draft/SaveCoordinator and accessible confirmation
patterns. No publication configured preserves today's donation behavior.

### Public donate page

Keep existing level selection, custom amount, tribute, contact, preference, artwork, and summary
layout. Add one overall notice above the level cards; do not add dates to individual cards.

- Before cutoff: “For name recognition in [publication], complete your donation by [date].”
- Before artwork deadline: “Submit program-ad artwork by [date] for [publication].”
- After recognition cutoff: “The name-recognition cutoff for [publication] has passed. Your donation
  is welcome, but inclusion of your name in this publication is no longer guaranteed.”
- After artwork deadline: “The artwork deadline for [publication] has passed. You can still submit
  artwork, but inclusion in this publication is no longer guaranteed.”

Only show artwork-specific information where relevant to an ad level. Qualify free-text benefits
such as “Mention in program” or “Includes a program ad” with the overall notice and selected-gift
summary; do not promise unconditional placement after a cutoff. Keep other level benefits intact. Do
not promise inclusion in the next publication. Respect anonymous preferences in recognition copy. No
date notice may disable level selection, donation checkout, or authorized artwork upload.

### Receipts and artwork links

Append a mandatory canonical publication section to the stored confirmation email independently of
custom template body choices. Include the publication name, applicable dates, recognition status at
payment, artwork status, and explicit no-guarantee warning where needed. For missing artwork after
its deadline, warn even though the donor has not yet submitted a file. Avoid saying that a future
artwork submission is guaranteed. Never expose private review notes.

Use the same domain-derived information on the success/receipt view and sponsor upload view. The
live upload view reflects extensions to that original publication, not the current one. After a late
upload, confirm both that the file was received and that inclusion is not guaranteed. Preserve
stored receipt content and notification deduplication on retries; no retrospective resend or
inclusion notification is introduced.

### Donation History

Add publication, outstanding-review, and separate late-gift/late-artwork filters, backed by bounded
server queries. Show original publication, deadline context, and recorded inclusion together. Use
explicit **Mark included in…** selection from retained publication records, including for historical
unassigned gifts. Show a confirmable summary; never silently select a later publication. Permit
correction of a mistaken inclusion using existing audited edit/confirmation conventions. Inclusion
remains distinct from thank-you status and artwork-received status. Use shared DataTable mobile
behavior, sortable data columns, accessible labels, and text indicators in addition to color.

Keep existing financial CSV columns/order intact. A new publication export or print-ready report is
outside this first increment; do not silently change the existing CSV contract.

## File Responsibility Map

| Owner                                                                                                                      | Changes                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/donations.ts` and exports/tests                                                                    | Publication/revision, date, status, inclusion, filter/cursor, and backward-compatible nullable response schemas.                                                              |
| `packages/domain/src/donationPublications.ts` (new) and exports/tests                                                      | Pure timezone boundaries, separate late states, revision/grandfathering rules, and public/receipt copy inputs. Reuse existing date helpers.                                   |
| `apps/worker/src/organization/schema/migrations.ts` and migration tests                                                    | Additive tables/columns and access-path-specific indexes; keep all historical gifts unassigned.                                                                               |
| `apps/worker/src/organization/donationPublicationStore.ts` (new)                                                           | Publication configuration/history, deadline revisions, indexed review queries, and audited inclusion mutations.                                                               |
| `apps/worker/src/organization/donationSettingsStore.ts`                                                                    | Compose current publication settings without deleting history on ordinary page-copy saves.                                                                                    |
| `apps/worker/src/organization/donation/{types,checkout,manual,queries,mutations,stripeLifecycle}.ts`                       | Capture original association and eligibility evidence; serialize states, record artwork facts, and build canonical receipt content.                                           |
| `apps/worker/src/organization/OrganizationStore.ts` and `rpc/`                                                             | Typed RPC for new publication/review methods and repository contracts; preserve hibernation/runtime checks.                                                                   |
| `apps/worker/src/routes/{organizationDonations,publicDonations}.ts`, settings route owners, and `organizationDonations.ts` | Authorized operations, public response composition, filters, token-scoped upload/receipt context, and typed errors. Verify actual module registrations before implementation. |
| Existing verified payment event/reconciliation adapters and `jobs/deliveries/payments.ts`                                  | Carry trusted completion time and preserve persisted email content/idempotent delivery. No new provider lane.                                                                 |
| `apps/web/src/api/donations.ts`, typed query-key owners, and donation-manager hooks/types                                  | Typed settings/history/inclusion requests, cursors, revision conflicts, and safe draft invalidation.                                                                          |
| `apps/web/src/account/components/DonationsManager/`                                                                        | Page settings, publication rollover, history filters/review, manual gift publication selection, and inclusion editor.                                                         |
| `apps/web/src/public/{PublicDonationView,PublicDonationSuccessView,PublicSponsorArtworkView}.tsx`                          | Overall notices, selected-gift summary, immutable original-publication context, receipt/upload warnings.                                                                      |
| `apps/web/src/styles/components/ticketing-donations.css`                                                                   | Minimal responsive styling using current design tokens; no per-level deadline cards or eyebrow headings.                                                                      |
| Contract/domain/UI tests, Worker integration tests, donation E2E fixtures/specs                                            | Boundary, replay, migration, tenancy, keyboard/mobile, and complete user-flow evidence.                                                                                       |
| `CONTEXT.md`, ADR 0075, and this plan                                                                                      | Canonical terms, durable decision, and implementation/verification handoff.                                                                                                   |

Recheck owning paths at implementation time and extend this map for any additional responsibility.
Preserve unrelated roster changes and incomplete-checkout-reminder work present in this checkout.

## Implementation sequence

1. Add shared contracts and deterministic domain policy tests. Specify revision/grandfathering
   behavior before persistence/UI work, including independent dates and Organization DST boundaries.
2. Add forward migrations and storage/RPC operations. Prove single-current publication enforcement,
   retained history, replay safety, and two-Organization isolation using real migrated SQLite.
3. Integrate authoritative online/manual timing and checkout publication capture. Keep payment
   accounting, patron aggregates, fee reconciliation, and confirmation deduplication unchanged.
4. Integrate pre-checkout and receipt-link artwork with original-publication context, submission
   evidence, and late replacement review. Continue enforcing file validation and scoped R2 keys.
5. Add canonical receipt content, public notices, and settings controls. Preserve customized
   templates and existing signed-link behavior; exercise pending-to-paid and rollover races.
6. Add bounded history/review filters and inclusion decisions. Do not rely on filtering the newest
   500 donations. Add only justified indexes and real query-plan assertions for growing-table paths.
7. Run focused tests and affected build/integration checks. Inspect generated bundles and address
   warnings. Update this plan with exact implementation evidence and remaining limitations.

No scheduler or periodic scan is needed merely because time passes: evaluate notices at reads and
late facts against actual payment/submission events. Deadline extensions must use indexed,
publication-scoped reads or bounded continuation if materialized flags need updating; never perform
an unbounded rewrite within one transaction or an alarm-time all-donations sweep.

## Verification and acceptance

This is a material change affecting contracts, persistence, payments, communications, and browser
behavior. Use relative fixtures from `@choir/testkit` and deterministic clocks.

- Domain: just before/at/after end-of-local-day, DST, browser/Organization timezone mismatch,
  independently unset dates, absent publication, late gift versus late file, extensions,
  shortenings, first deadline added after submissions, and preserved on-time evidence.
- Contracts: valid/invalid dates, bounded names and cursors, missing/null/omitted properties, older
  responses, settings revisions, server/client parsing and validation failure.
- Worker: forward migration, historical null associations, date-entry versus received date, trusted
  success time versus delayed webhook processing, idempotent completion/reconciliation, fake/local
  payment parity, checkout rollover, stale settings, receipt deduplication, custom template
  canonical warning, retained links, uploads/replacements, and refunds.
- Isolation/security: cross-Organization publication/inclusion/file/token attempts fail; public
  requests cannot choose an Organization or access private staff review data. Exercise expired and
  revoked signed links separately from passed artwork dates.
- Storage: real SQLite tests and `EXPLAIN QUERY PLAN` coverage for publication/review queries;
  stable pagination with more than 500 gifts, no full-table polling, duplicate-safe mutations, and
  revision-conflict recovery.
- UI/E2E: before/either/both cutoff states, all levels/custom amounts, anonymity, successful
  donation and late upload, original-publication receipt after rollover, historical selection,
  inclusion clearing review while preserving history, keyboard/focus, unsaved changes, responsive
  desktop/mobile, and accessible non-color late indicators.

During development run focused Vitest/UI/E2E selections plus relevant formatting, lint, typecheck,
`check:contracts:exports`, `check:do-runtime`, and `check:routes` after endpoint changes. Build the
deployable artifact before `test:integration:prepared`; use affected integration gates as needed.
For any later authorized push to main, commit the cohesive change, qualify the clean candidate with
`npm run check:release`, then push. Do not repeat the full browser-free suite immediately before
that release gate. Any separately authorized staging promotion uses only
`npm run deploy:staging -- --yes` under the staging runbook. Production remains out of scope.

## Migration, rollback, and risks

The migration is additive; no historical publication or success timestamp is guessed. Old clients
must tolerate additive fields. However, an older Worker can accept donations while omitting the new
publication facts or receipt warnings. A binary rollback is therefore not behaviorally equivalent:
retain compatible capture/receipt logic or suspend the publication feature explicitly, preserve all
new tables/history, and reconcile affected gifts before re-enabling. Never erase inclusion or
deadline evidence as rollback. Test old settings writes cannot wipe the active publication pointer.

Tenant isolation depends on resolving the Organization before store access and using scoped R2 keys.
External effects remain the existing payment/receipt paths; local verification sends no real email
and creates no real charge. Accessibility risks are dense review controls and warnings that depend
on color; use shared primitives and text. Performance risks are historical filtering and deadline
reevaluation; use justified indexes, pagination, and bounded updates. Receipt risks are
contradictory custom copy and delayed delivery; canonical qualification must remain present and
describe the recorded payment/submission context without rewriting sent messages.

Local deployable artifacts are regenerated by the canonical build/check scripts, never edited.
Migration 133 adds publication/revision, original association, artwork-submission, and inclusion
records. Its only new secondary indexes enforce the one-current-publication rule and support
publication-scoped donation lookups. Hosted databases have not been migrated by this task.

## Implementation and verification record — 2026-11-03

The settings, public notices, payment capture, canonical email section, signed receipt/artwork
context, and staff review/inclusion controls are implemented locally. All donation levels keep their
existing cards; dates are shown only in overall notices and the selected-gift summary. Both dates
are optional. Staff can select retained publications, correct an inclusion, and select a publication
for a backdated manual gift. Existing gifts remain unassigned until staff explicitly include them.

Original associations, actual received/success times, deadline revisions, artwork history, and staff
inclusion decisions are separate from financial and thank-you status. Authoritative verified Stripe
event time is carried through completion instead of using webhook-processing time. Original checkout
expectations survive rollover and shortened deadlines. Signed donor responses omit staff inclusion
fields; existing signed-link purpose, Organization scope, and expiry remain enforced.

Review reads use indexed ID pages of 100 candidates and continuation cursors, including beyond the
financial endpoint's newest 500 records. An empty filtered page can still have a next page. Policy
histories are compiled once per publication per request; fact evaluation uses binary search and
precomputed extension bounds rather than repeated history scans in row loops. Publication revision
history is capped at 500 revisions to bound per-publication work. No periodic scan or new delivery
lane is introduced.

Additional actual owners beyond the original map:

- `apps/web/src/public/PublicationNotice.tsx`: common donor-facing notice presentation.
- `apps/web/src/account/components/DonationsManager/PublicationSettings.tsx` and
  `PublicationReview.tsx`: publication setup/history selection and staff inclusion review.
- `apps/web/src/api/queryKeys.ts`: canonical publication/review query keys.
- `packages/contracts/src/export-names.snapshot.json`: additive contract export inventory.
- `scripts/route-probe-plan.mjs`: authenticated read and empty-body validation probes for all four
  new routes, ready for later staging qualification.
- Publication contract/domain/UI tests, `apps/worker/test/donationPublications.integration.test.ts`,
  and donation browser specs: acceptance and regression evidence.

Existing component classes cover the layout; no new donation stylesheet was required.

### Final verification

The completed implementation passed the following local checks:

| Check                                                                                                    | Final result                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check:ci`                                                                                       | All 19 steps passed, including strict dependency audit, formatting, lint, Knip, typechecking, contract exports, route registration, DO boundaries, builds, artifact verification, and Workerd integrations.                 |
| Complete unit suite within that gate                                                                     | 266 files; 2,336 tests passed.                                                                                                                                                                                              |
| Complete UI suite within that gate                                                                       | 146 files; 1,176 tests passed.                                                                                                                                                                                              |
| Complete Workerd integration suite within that gate                                                      | 94 files; 610 tests passed.                                                                                                                                                                                                 |
| Publication-specific Worker integration tests                                                            | All 16 passed, including HTTP checkout replay redaction, signed-link isolation/expiry, immutable receipts, older-client settings writes, refund history/correction, late artwork replacement, and more than 500 gifts.      |
| `npm run test:e2e -- apps/web/e2e/donation-publication-deadlines.spec.ts apps/web/e2e/donations.spec.ts` | 36 tests passed across desktop and mobile Chromium: staff setup/rollover and inclusion, public cutoff states, continued checkout/upload availability, keyboard artwork controls, light/dark themes, and responsive layouts. |
| Final documentation formatting and `git diff --check`                                                    | Passed.                                                                                                                                                                                                                     |

Acceptance is complete for local implementation. Original records, privacy choices, receipt history,
and tenant boundaries remain intact; donations and authorized artwork uploads stay open. The gate
regenerated and verified local web assets, the Worker bundle, and the release manifest through the
standard build/artifact scripts. No generated runtime artifacts were edited by hand.

Hosted staging qualification, full release qualification, push, and deployment are not performed:
this request authorizes local implementation and acceptance verification. Dirty working-tree gate
results are development evidence, not reusable qualification of a clean release candidate. Preserve
unrelated roster and incomplete-checkout-reminder work in this checkout.
