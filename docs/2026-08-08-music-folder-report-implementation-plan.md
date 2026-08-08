# Music Folder Report Implementation Plan

**Status:** Accepted product design; ready for implementation
**Date:** 2026-08-08
**Milestone:** 5 — authenticated Organization workflows
**Route:** `/admin/reports`, `Music Folder Report` tab

## 1. Outcome

Add an Organization-scoped Music Folder Report that lets an authorized administrator select one or
more Performances, identify historical folder-return patterns by Organization Profile, inspect every
selected Performance in context, update Folder Numbers in a staged bulk editor, immediately correct
individual return states, and export the same report as CSV.

This is an additive report. The existing per-Profile folder editor remains available, and all write
paths must enforce the same folder invariants.

## 2. Consistency Review

The accepted design is consistent with the current application architecture after making the
following boundaries explicit:

1. A folder assignment is the existing `event_rosters` record for one Profile and one Performance
   with a non-empty `folder_number`. It is not a Profile-wide property.
2. An existing `event_rosters` record with a blank Folder Number is **Not Assigned**. A selected
   Performance with no `event_rosters` record for the Profile is **Not Applicable**. This is the
   Music Folder Report's applicability rule; it does not redefine attendance or RSVP roster
   semantics elsewhere.
3. Only Profiles with at least one non-empty Folder Number among the selected Performances appear in
   the report. Their detail includes every selected Performance so that Not Assigned and Not
   Applicable states remain visible.
4. Canceled, archived, past, current, and future Performances remain selectable. If a non-empty
   Folder Number exists, it counts regardless of date or Performance state.
5. On Break and Inactive Profiles remain visible when they have selected assignment history.
   Profiles with history are retained under ADR 0031 rather than being physically deleted.
6. Returned means administrator-confirmed physical receipt. It is never inferred from attendance,
   date, cancellation, archival, or a member action.
7. The return rate is `Returned / (Returned + Outstanding)`. Not Assigned and Not Applicable do not
   enter the denominator.

The existing sparse `event_rosters` storage can represent all four report states. The only schema
addition required is a nullable return-confirmation timestamp.

## 3. Product Contract

### 3.1 Access and placement

- Add `Music Folder Report` as a tab on the existing `/admin/reports` route.
- Reuse the route's existing Organization manager authorization and MFA policy. Owners and
  Administrators may read and edit; ordinary members may not. A Platform Administrator must use the
  existing visible, time-bounded, Organization-scoped elevation path.
- Resolve the Organization from the validated hostname before authorization. No request field may
  select an Organization.

### 3.2 Performance selection

- Start with no Performance selected and a clear empty state.
- Use a searchable multi-select with `Select all` and `Clear all` controls.
- Show every Performance, including future, canceled, and archived Performances and Performances
  with no assigned folders.
- Sort by start date descending (most recent date first), with a stable ID tie-breaker.
- Show canceled and archived badges. A Performance with zero non-empty Folder Numbers says
  `No assigned folder` rather than being hidden.
- Reject duplicate or unknown Performance IDs at the contract/store boundary.

### 3.3 Summary

- Show top-level Assigned, Returned, Outstanding, Not Assigned, and Return Rate values for the full
  selected set.
- Assigned is `Returned + Outstanding`; it counts non-empty Profile-by-Performance assignments, not
  unique Profiles.
- Show one sortable DataTable row per included Profile, defaulting to the existing last-name
  alphabetical convention and a stable Profile ID tie-breaker.
- Columns are Profile, Assigned, Returned, Outstanding, Not Assigned, Return Rate, and Details.
- Profile-name search and status filters (`All`, `Outstanding`, `Returned`, `Not Assigned`) narrow
  the Profile rows but do not recalculate the top-level totals.
- All displayed data columns are keyboard-sortable. The Details disclosure has an accessible label,
  visible focus, and `aria-expanded` state.

### 3.4 Performance detail

- Expanding a Profile shows every selected Performance in the same newest-first order.
- Detail states are:
  - **Returned:** non-empty Folder Number and `folder_returned = 1`.
  - **Outstanding:** non-empty Folder Number and `folder_returned = 0`.
  - **Not Assigned:** an `event_rosters` record exists and its Folder Number is blank.
  - **Not Applicable:** no `event_rosters` record exists for that Profile and Performance.
- Not Applicable rows are read-only. The report must not silently create roster applicability.
- Filtering the summary must not remove selected Performance rows from an already expanded Profile.
- Use the shared DataTable/mobile-card behavior for summary and detail data. If expandable child
  rows would weaken DataTable sorting or mobile behavior, render one accessible detail panel
  immediately after the summary table instead of creating a bespoke table.

### 3.5 Folder Number editing

- Folder Numbers may contain letters and punctuation, are trimmed before validation, and are
  case-insensitively unique within one Performance. A number may be reused in another Performance.
- Edits are staged in the detail panel. `Save changes` sends only changed rows in one bounded batch;
  `Discard changes` restores confirmed server values.
- A non-empty number changed to another non-empty number becomes Outstanding and clears Returned At.
- Clearing a non-empty number requires a danger-styled confirmation with a visible Cancel action. A
  confirmed clear becomes Not Assigned and leaves the return-rate denominator.
- Valid rows save even when another row conflicts. The response identifies each applied, conflicted,
  stale, or invalid row, and the UI preserves failed drafts with row-level messages.
- Validate uniqueness against the final proposed state so two rows may swap numbers safely. When two
  changed rows propose the same normalized number, reject every changed row in that conflict group.
- Include the row's last confirmed `updatedAt` in mutations. A stale row is not overwritten and is
  returned for refresh/review.
- Disable the return-state action for a row with an unsaved Folder Number draft.
- Warn before changing report selection, changing tabs, following in-app navigation, refreshing, or
  closing the page while Folder Number drafts are unsaved.

### 3.6 Return-state editing

- Each assigned detail row offers `Mark returned` or `Mark outstanding`; no `Mark all` action is
  provided.
- The update is immediate, reversible, Performance-scoped, and requires no destructive confirmation.
- Marking Returned records the current server time as Returned At. Marking Outstanding clears
  Returned At. If a row is returned again later, the visible timestamp is the latest confirmation;
  append-only audit records preserve earlier transitions.
- Return-state requests include `updatedAt` and fail with a typed stale-row response instead of
  overwriting a concurrent Folder Number edit.

### 3.7 CSV

- Export one row per applicable Profile/Performance pair for included Profiles.
- Include Profile, Performance, Performance Start, Performance State, Folder Number, Folder Return
  Status, and Returned At columns.
- Include Returned, Outstanding, and Not Assigned rows. Exclude Not Applicable rows and Profiles
  that have no assignment in the selected set.
- Use stable newest-Performance-first ordering, then the existing last-name Profile ordering.
- Generate from the same store projection and pure status calculations used by the screen so the
  export cannot disagree with visible totals.

## 4. Domain and API Contracts

Create focused strict TypeScript contracts in `packages/contracts/src/musicFolderReports.ts` and
export them from the package root. Avoid reusing the old full-row update contract for new report
actions.

The contracts will define:

- Performance option metadata, including canceled/archived state and assigned-folder count.
- Selected Performance ID input with a finite array bound, duplicate rejection, and UUID validation.
- Report totals and per-Profile summary records.
- Detail rows with a discriminated status: `returned`, `outstanding`, `not_assigned`, or
  `not_applicable`.
- Bulk Folder Number edits and per-row results: `applied`, `conflict`, `stale`, or `invalid`.
- Return-state mutation input and result.
- Typed error codes for authorization, validation, stale state, unknown Performance/Profile,
  inapplicability, and duplicate Folder Number.

Add pure rules to `packages/domain/src/musicFolderReport.ts` for normalized number comparison,
status derivation, count/rate calculation, stable last-name ordering, and CSV rendering. Unit tests
must cover whitespace, case-insensitive collisions, number swaps, blank/reset behavior, zero
denominator, and deterministic ordering.

### Proposed API surface

| Method | Path                                                                          | Responsibility                                                                                                                               |
| ------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/organization/reports/music-folders/query`                               | Return all Performance options plus totals and Profile summaries for selected IDs. An empty selection returns options and empty report data. |
| `POST` | `/api/organization/reports/music-folders/profiles/:profileId`                 | Return the selected Profile's applicable rows plus synthesized Not Applicable rows.                                                          |
| `PUT`  | `/api/organization/reports/music-folders/folder-numbers`                      | Apply a bounded, partially successful batch of staged Folder Number edits.                                                                   |
| `PUT`  | `/api/organization/profiles/:profileId/folder-numbers/:eventId/return-status` | Immediately change one assigned folder's return state with optimistic concurrency.                                                           |
| `POST` | `/api/organization/reports/music-folders/export.csv`                          | Return the selected report as a bounded UTF-8 CSV download.                                                                                  |

All POST/PUT routes use the existing same-origin and CSRF protections. The export uses POST so a
large selection is not encoded into a URL. Safety limits are centralized contract constants and
qualified against seeded Organization scale before release; exceeding them returns an actionable,
typed response rather than truncating data.

Keep the existing Profile folder-number endpoints for compatibility. Route their writes through the
same invariant-preserving store operations so the old editor cannot create a state the report would
reject.

## 5. Organization Store Design

Create `musicFolderReportStore.ts` rather than expanding the already broad calendar repository.
Expose it through a focused authenticated Organization adapter and `OrganizationStore` RPC methods.

### Read path

1. Query Performance options directly from tenant-local events so archived and canceled rows are
   included. Precompute non-empty assignment counts with one grouped query.
2. Validate selected IDs are Performance events in this Organization.
3. Aggregate only existing `event_rosters` rows for the selected Performances. Include a Profile in
   the summary only when at least one selected row has a non-empty Folder Number.
4. Compute Not Assigned from blank existing rows. Do not materialize the Profile-by-Performance
   cross-product for the summary.
5. Load detail lazily for one included Profile. Build an event map once and synthesize missing
   selected IDs as Not Applicable in O(P + R), not with scans inside loops or comparators.

### Write path

1. Resolve all target Performances and Profiles before opening the mutation transaction.
2. In one short SQLite transaction, load current assignments for the affected Performances into
   maps, compare `updatedAt`, build each Performance's final normalized-number ownership map, and
   classify row outcomes.
3. Apply valid rows together, reset return state when required, and append one attributed audit
   event per applied Profile/Performance change. Do not call providers inside the transaction.
4. Return every row result. A validation/conflict/stale result does not roll back unrelated valid
   rows, while an unexpected storage failure does roll back the transaction and propagates.

One Organization Durable Object serializes tenant-local mutations, so transactional final-state
validation enforces case-insensitive uniqueness without a cross-tenant lock. Do not add a unique
index in the first migration: preexisting duplicate data could make deployment fail and an older
Worker would not provide the typed conflict behavior. Add a later index only after a duplicate
preflight proves every Organization clean and rollback compatibility is demonstrated.

### Audit actions

- `event.folder_number.updated`
- `event.folder_number.cleared`
- `event.folder_return.marked_returned`
- `event.folder_return.marked_outstanding`

Each audit event includes the actual actor, Organization, Profile, Performance, request ID,
timestamp, and a secret-safe before/after summary. Folder numbers are operational data, not secrets,
but audit summaries should contain only the changed fields required for accountability.

## 6. Schema Migration and Rollback

Add Organization schema migration 64 as a forward-only migration; do not modify migration 10.

```sql
ALTER TABLE event_rosters ADD COLUMN folder_returned_at TEXT;
```

Migration/application rules:

- Normalize impossible blank-returned rows to `folder_returned = 0` and `folder_returned_at = NULL`.
- For existing non-empty rows marked returned, use `updated_at` as the best available historical
  Returned At value. New code must also read `COALESCE(folder_returned_at, updated_at)` while
  `folder_returned = 1` so rollback to an older Worker and then roll-forward remains readable.
- New writes set `folder_returned_at` only when Returned and clear it for Outstanding or Not
  Assigned.
- The migration is additive, so an older Worker ignores the column. Rollback does not drop it.
- Update both the current schema definition and ordered migration registry, then test a schema-10
  fixture upgrading to current and a current database exercised by the previous write shape.

Before any Profile deletion, the Organization store checks for folder-assignment history. If history
exists, return a typed conflict directing the administrator to mark the Profile Inactive. This
enforces ADR 0031 at the integrity boundary even though the normal roster UI currently has no public
delete action.

## 7. Browser Implementation

Keep `ReportsView.tsx` as the tab host. Build the feature under
`apps/web/src/account/components/MusicFolderReport/` with separate controller, view, and pure model
helpers so report complexity does not enlarge the existing monolith.

- Keep request/loading state in the focused controller using the web application's existing typed
  client pattern; do not introduce a new server-state dependency for this report alone.
- Keep confirmed server data separate from Folder Number drafts. Background refetches must not erase
  unsaved edits.
- Update an immediate return-state action in local confirmed data only after the server accepts its
  row version; refresh the summary/detail after success and retain the prior row on failure.
- After a partial bulk save, adopt server values for applied rows and keep only failed drafts.
- Present loading, empty selection, no assignments, authorization, validation, stale, and unexpected
  error states distinctly.
- Use tokenized Tailwind/BEM styles in the existing report stylesheet. Preserve dark theme, keyboard
  operation, screen-reader names, focus management, and narrow-screen cards.

## 8. Verification Plan

### Domain and contract tests

- Status/count/rate truth table, including zero denominator.
- Last-name default ordering and deterministic tie-breakers.
- Folder normalization, case-insensitive uniqueness, swaps, clear/reset, and change/reset.
- CSV quoting, Unicode, timestamp formatting, status values, ordering, and Not Applicable exclusion.
- Request limits, duplicate IDs/targets, invalid UUIDs, and response parsing in both Worker and
  browser clients.

### Workerd integration tests

- Manager can query all Performance states; member is denied; MFA policy is preserved.
- Host alteration, client Organization-ID injection, and cross-Organization Profile/Performance IDs
  cannot read or mutate another tenant.
- Included/omitted Profile rules and all four detail statuses.
- Canceled, archived, future, On Break, and Inactive cases.
- Blank folder invariant, number-change reset, case-insensitive same-Performance conflict,
  cross-Performance reuse, safe number swap, and partially successful batch.
- Stale-write rejection and no lost update between number and return-state actions.
- Returned At creation, clearing, latest-confirmation behavior, and attributed append-only audits.
- Legacy endpoint parity through the shared invariant path.
- Migration upgrade/rollback compatibility and Profile deletion guard.
- Export authorization, tenant isolation, row ordering, content disposition, byte/row limits, and no
  silent truncation.

### Browser tests

- No-selection empty state and searchable multi-select with Select all/Clear all.
- Newest-first options, canceled/archived badges, and `No assigned folder` label.
- Stable top totals under search/status filters and last-name default summary order.
- Accessible sortable summary, details disclosure, complete detail rows, and mobile cards.
- Staged edit/discard, clear confirmation, partial-save row errors, stale state, and unsaved-change
  warnings for selection, tab, navigation, refresh, and close.
- Immediate per-row return toggles, disabled action while a number draft exists, and absence of a
  mark-all control.
- CSV download and ordinary-member denial.

### Required commands

Run focused tests while iterating. Before completing the feature, run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run check:contracts-exports
npm run check:parity
npm run check:parity:implementation
npm test
npm run build
npm run test:integration:prepared
npx playwright install chromium
npm run test:e2e
npm audit --audit-level=high
npm run check:ci
```

The deployable build must precede prepared Workerd integration tests. Bundle output and route-level
code splitting are inspected; no gate is weakened to admit the feature.

## 9. Implementation Sequence

### Slice 1 — contracts, domain rules, and migration

1. Add contract schemas/types and package exports.
2. Add pure status, normalization, summary, ordering, and CSV rules with unit tests.
3. Add the forward-only Returned At migration, current schema representation, upgrade tests, and
   rollback-compatible reads.
4. Add the Profile deletion history guard.

**Gate:** formatting, lint, typecheck, contract exports, focused domain tests, and migration Workerd
tests pass.

### Slice 2 — tenant-local report reads and export

1. Add Performance option, summary, lazy detail, and CSV store queries.
2. Add Organization adapter/RPC and manager-authorized routes.
3. Add browser client parsing and focused controller state.
4. Record the new target-only API/workflow/CSV entries in the parity ledger and route inventory.

**Gate:** integration tests prove authorization, tenant isolation, report truth table, sorting,
bounds, and CSV equivalence.

### Slice 3 — invariant-preserving writes

1. Add partially successful transactional Folder Number batches and immediate return-state updates.
2. Route the existing Profile folder editor through the shared invariants.
3. Add optimistic concurrency, reset rules, Returned At, and audit events.

**Gate:** integration tests prove conflicts, swaps, partial success, stale writes, audits, rollback
compatibility, and no cross-Organization effects.

### Slice 4 — report interface

1. Add the Music Folder Report tab, selector, KPIs, sortable summary, and accessible detail panel.
2. Add staged number editing, confirmation, partial-result handling, immediate return toggles, and
   unsaved-change protection.
3. Add CSV download and all loading/error/empty states.
4. Verify desktop, narrow-screen, keyboard, screen-reader labeling, light theme, and dark theme.

**Gate:** focused UI tests and browser E2E pass without regressions to existing Reports tabs or the
per-Profile folder editor.

### Slice 5 — milestone qualification

1. Mark parity entries implemented only after target evidence exists.
2. Run the complete command sequence and inspect the generated Worker/web artifacts.
3. Update the milestone File Responsibility Map verification and remaining-work report.
4. Deploy only through the existing permanent-staging promotion workflow if deployment is requested;
   production remains out of scope.

## 10. File Responsibility Map Addition

These exact files are in scope. The master rebuild plan must contain these entries before product
implementation begins.

| Path                                                               | Responsibility                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `CONTEXT.md`                                                       | Ubiquitous language for Folder Number, Folder Return Status, and Music Folder Report.                   |
| `docs/adr/0031-preserve-music-folder-history.md`                   | Retention decision for Profiles with folder history.                                                    |
| `docs/2026-08-08-music-folder-report-implementation-plan.md`       | Accepted feature contract, sequence, risks, and gates.                                                  |
| `docs/parity/feature-matrix.yaml`                                  | Planned then implemented evidence for the target-only report workflow, APIs, CSV, and responsive state. |
| `scripts/check-parity-matrix.mjs`                                  | Exact inventory for new report APIs and CSV contract.                                                   |
| `packages/contracts/src/musicFolderReports.ts`                     | Shared request/response schemas and bounded report DTOs.                                                |
| `packages/contracts/src/index.ts`                                  | Public report-contract exports.                                                                         |
| `packages/contracts/src/export-names.snapshot.json`                | Contract export snapshot.                                                                               |
| `packages/domain/src/musicFolderReport.ts`                         | Pure folder status, normalization, summary, ordering, and CSV rules.                                    |
| `packages/domain/src/musicFolderReport.test.ts`                    | Domain and CSV regression proof.                                                                        |
| `packages/domain/src/index.ts`                                     | Public report-domain exports.                                                                           |
| `apps/worker/src/organization/schema.ts`                           | Current `folder_returned_at` schema representation.                                                     |
| `apps/worker/src/organization/schema/migrations.ts`                | Forward-only Returned At migration and data normalization.                                              |
| `apps/worker/src/organization/musicFolderReportStore.ts`           | Tenant-local report reads, writes, uniqueness, concurrency, audit, and export projection.               |
| `apps/worker/src/organization/OrganizationStore.ts`                | Organization RPC exposure for report operations.                                                        |
| `apps/worker/src/organization/organizationMusicFolderReports.ts`   | Authenticated Organization adapter and strict result parsing.                                           |
| `apps/worker/src/organization/calendarManagementStore.ts`          | Existing folder-write compatibility through the shared report invariants.                               |
| `apps/worker/src/organization/organizationStore/profiles.ts`       | Profile deletion guard when music-folder assignment history exists.                                     |
| `apps/worker/src/routes/organizationMusicFolderReports.ts`         | Manager-authorized report HTTP endpoints and CSV response.                                              |
| `apps/worker/src/routes/organizationProfileRecords.ts`             | Immediate return-status route and legacy write compatibility.                                           |
| `apps/worker/src/router.ts`                                        | Route registration.                                                                                     |
| `apps/worker/test/musicFolderReport.integration.test.ts`           | Workerd behavior, migration, authorization, audit, isolation, and export proof.                         |
| `apps/web/src/auth/api/musicFolderReports.ts`                      | Typed browser report client.                                                                            |
| `apps/web/src/account/ReportsView.tsx`                             | Music Folder Report tab integration.                                                                    |
| `apps/web/src/account/components/MusicFolderReport/controller.tsx` | Query/mutation orchestration and draft lifecycle.                                                       |
| `apps/web/src/account/components/MusicFolderReport/view.tsx`       | Accessible selector, summary, detail, editor, and report states.                                        |
| `apps/web/src/account/components/MusicFolderReport/model.ts`       | Pure browser draft, filter, sort, and partial-result helpers.                                           |
| `apps/web/src/account/components/MusicFolderReport/model.test.ts`  | Browser-model unit proof.                                                                               |
| `apps/web/src/styles/components/reports.css`                       | Tokenized report detail/editor responsive styling.                                                      |
| `apps/web/e2e/reports.spec.ts`                                     | Desktop/mobile report interaction and regression evidence.                                              |

## 11. Risks and Controls

- **Sparse roster ambiguity:** keep Not Applicable explicitly report-scoped and cover it with store,
  UI, and export tests.
- **Historical duplicate Folder Numbers:** enforce normalized uniqueness on every new write; do not
  make rollout depend on a unique index until a read-only preflight can report existing conflicts.
- **Large historical selections:** aggregate in SQL, lazy-load details, precompute maps, centralize
  explicit request/export limits, and fail visibly rather than truncate.
- **Lost updates:** use `updatedAt` optimistic concurrency for both staged and immediate mutations.
- **Partial-save confusion:** return and display a result for every submitted row; retain only
  failed drafts and refresh applied rows.
- **Rollback timestamp gaps:** derive Returned At from `updated_at` when an older Worker wrote the
  state without the new column.
- **Monolithic report UI:** isolate the feature under a focused component directory and keep
  `ReportsView` as composition only.
- **Accessibility regression:** retain DataTable sorting/mobile cards, use an explicit details
  disclosure, danger confirmation for clearing, focus restoration, and E2E keyboard checks.

## 12. Non-goals

- No member self-reporting of folder returns.
- No aggregate or `Mark all returned` mutation.
- No automatic return inference from attendance, RSVP, date, cancellation, or archival.
- No separate immutable report snapshot; the report reads current tenant-local state.
- No replacement of the existing per-Profile folder editor.
- No automatic creation of event-roster applicability from a Not Applicable report row.
- No production launch as part of this feature plan.
