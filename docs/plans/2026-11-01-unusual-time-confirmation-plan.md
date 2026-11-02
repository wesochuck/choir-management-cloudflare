# Unusual Time Confirmation Implementation Plan

Date: November 1, 2026. Status: implemented locally; browser qualification pending.

## Outcome and agreed behavior

Help people catch AM/PM mistakes anywhere they manually enter a time in the app, while allowing
legitimate exceptions. Include activity times, audition schedules, poll deadlines, and ticket-sale
dates. This is an advisory confirmation, not a new API validation restriction.

- Use one fixed usual range for every Organization: **12:00 PM through 10:00 PM, inclusive**.
  Earlier or later times prompt for confirmation. Exactly noon and exactly 10 PM do not.
- Interpret the entered clock time in the Organization Timezone, preserving the existing conversion
  and storage contracts. Do not compare UTC hours or use the device timezone as a substitute.
- Ask when a user finishes editing and leaves the field, not on each keystroke.
- Example: **Check this time** — “You entered 2:30 AM, outside the usual noon–10 PM range. Keep this
  time?” Include the field label where needed to identify the affected value.
- Actions: **Keep time** accepts the value; **Change time** returns focus to the field for editing.
  Do not silently clear, shift by twelve hours, round, or replace the time.
- Existing values do not prompt just because a form loads, gains focus, or saves unrelated changes.
- A confirmed value does not prompt again while unchanged in that editor. Changing the value
  invalidates its confirmation. Reopening saved data establishes a new baseline without a prompt.
- Empty or incomplete input stays governed by existing validity and required-field behavior.

No per-Organization range setting, permanent acknowledgement, server restriction, data migration, or
import/background-job warning is needed. Date-only fields, durations, and reminder offsets are not
clock-time inputs. Generated audition slots and bulk rehearsal occurrences use the confirmed source
time; they must not produce one dialog per generated record.

## Verified starting points

`packages/domain/src/calendarTime.ts` supplies shared timezone conversion, but there is no shared
time input. The current forms use native `time` and `datetime-local` inputs in the files below.
Changing conversion helpers alone cannot present a confirmation or manage focus.

`@choir/ui` already supplies Radix-based `ConfirmDialog`, portal scoping, and `useConfirmation`.
`ConfirmDialog` currently fixes its secondary action label to “Cancel”; add a backwards-compatible
optional label if this primitive is used for “Change time.” Application-specific coordination
belongs in the web app; keep the usual-hours rule in the domain package and generic input/dialog
behavior in the UI package.

## File Responsibility Map

| Owner                                                                                     | Responsibility                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/unusualTime.ts` and its unit tests (new)                             | Pure classification of complete local clock values against the agreed inclusive range; no timezone conversion or UI side effects.                                                                                               |
| `packages/domain/src/index.ts`                                                            | Export the rule without changing existing exports.                                                                                                                                                                              |
| `packages/ui/src/TimeInput.tsx` and its UI tests (new)                                    | Shared native input wrapper supporting both input types; preserve native attributes, refs, events, validity, labels, and accessibility relationships; expose edit-completion integration without embedding Organization policy. |
| `packages/ui/src/index.ts`                                                                | Export the input and any generic types.                                                                                                                                                                                         |
| `packages/ui/src/ConfirmDialog.tsx`, `useConfirmation.tsx`, and relevant tests            | Optional secondary action label and focus support, only as necessary; preserve defaults for existing callers.                                                                                                                   |
| `apps/web/src/shared/UnusualTimeInput.tsx` and its UI tests (new)                         | Compose the shared input, domain rule, confirmation lifecycle, baseline/acknowledgement state, and focus restoration. Reuse a form-level coordinator where needed to serialize prompts and guard saves.                         |
| `apps/web/src/account/components/EventsPage/EventEditorDialog/ScheduleSection.tsx`        | Start date/time, call time, and doors-open time.                                                                                                                                                                                |
| `apps/web/src/account/components/EventsPage/bulkRehearsals.tsx`                           | Bulk rehearsal source time.                                                                                                                                                                                                     |
| `apps/web/src/account/components/AuditionManager/settings/SlotsSection.tsx`               | Audition slot range start/end.                                                                                                                                                                                                  |
| `apps/web/src/account/components/AuditionManager/settings/RehearsalScheduleSection.tsx`   | Recurring rehearsal start/end.                                                                                                                                                                                                  |
| `apps/web/src/account/components/AuditionManager/tableAndDialogs.tsx`                     | Individual audition date/time editors.                                                                                                                                                                                          |
| `apps/web/src/account/PollsPage.tsx`                                                      | Poll expiration date/time.                                                                                                                                                                                                      |
| `apps/web/src/account/components/MusicCatalog/AddToSetListDialog.tsx`                     | Performance date/time in set-list workflow.                                                                                                                                                                                     |
| `apps/web/src/account/components/MusicCatalog/performances.tsx`                           | Music performance history date/time.                                                                                                                                                                                            |
| `apps/web/src/account/components/Ticketing/BundlePanel.tsx`                               | Bundle sale date/time.                                                                                                                                                                                                          |
| Relevant form submit handlers and `apps/web/src/persistence/` integration if required     | Prevent click/Enter/SaveBar submission from bypassing an unresolved time confirmation. Preserve existing draft snapshot and dirty-state behavior.                                                                               |
| Focused existing form UI tests and `apps/web/e2e/unusual-time-confirmation.spec.ts` (new) | Coverage across input types, nested dialogs, saves, and desktop/mobile interactions.                                                                                                                                            |

Recheck the inventory at implementation time for indirect input types and any new time fields.
Extend this map for any additional owners found. Preserve unrelated working-tree changes.

## Implementation sequence

1. Add the pure classifier and boundary tests. Parse complete native input values strictly; do not
   classify empty, invalid, or partial values as unusual. Cover seconds if supported by a caller.
2. Build the shared input and web composition. Keep input state compatible with existing controlled
   forms and audition normalization. Avoid duplicating existing timezone conversion logic.
3. Implement baseline and acknowledgement handling. Capture the value being confirmed; a stale
   response must not confirm a newer edit. Handle external resets, successful saves, unmounts, and
   focus moving between time fields without stale prompts or repeated blur loops.
4. Integrate each inventoried field and its save path. Coordinate multiple unusual fields in a
   deterministic order. Clicking Save can cause blur before click; ensure that the pending dialog
   cannot race with a mutation. Keyboard submission must follow the same rule. After **Keep time**,
   an explicit save attempt may continue once all applicable confirmations are resolved; **Change
   time** leaves the form unsaved and focuses the relevant field. Confirmation itself never
   initiates a save that the user did not request.
5. Verify portal scoping inside existing editor dialogs and interaction with unsaved-change prompts.
   Escape or dismissal behaves like **Change time**, never implicit acceptance. Do not stack
   competing confirmation dialogs or trap the user in a reappearing blur prompt.
6. Run focused checks and review the final inventory to ensure every manually editable clock-time
   field uses the shared path. Record implementation and verification evidence in this plan.

## Verification and acceptance criteria

This is a material shared browser behavior change. Use focused checks during development:

- Domain tests: 00:00, 02:30, 11:59, 12:00, 21:59, 22:00, 22:01, 23:59, and invalid/partial values;
  include supported second precision to prove the exact upper boundary.
- Shared component tests: no prompt during typing; blur prompt only after a meaningful edit;
  untouched unusual baseline; Keep/Change actions; acknowledgement invalidation; empty/required
  fields; preserved event handlers, refs, native attributes, and accessibility descriptions.
- Form tests: `time` and `datetime-local`, multiple unusual fields, bulk generation, unchanged
  legacy data, successful and failed saves, click/Enter/SaveBar submission, and stale confirmation
  responses. Keep existing domain validation such as schedule ordering intact.
- Timezone tests: Organization and browser in different zones; the same Organization-local 2:30 AM
  warns regardless of device zone. Preserve existing DST-invalid/ambiguous-time handling.
- Focused Playwright desktop/mobile checks in light/dark themes: nested dialog focus trapping,
  keyboard actions, Change refocus, no repeated prompt loop, and no mutation before confirmation.
- Run focused Vitest/UI suites with repository configs, the focused Playwright spec, formatting,
  lint, typecheck, and the affected web build. Inspect build warnings and route splitting.

For this plan-only change, validate Markdown formatting. Runtime checks are deferred until code is
implemented. No route change is planned, so route checks and Worker integration tests are not
required unless implementation expands into those boundaries.

If later authorized to push to main or deploy staging: focused checks → cohesive local commit →
`npm run check:release` on the clean committed candidate → push → guarded staging deployment when
authorized. Do not duplicate the full gate immediately beforehand. This plan does not authorize
release or hosted changes.

## Risks, rollback, and documentation

- Accessibility: blur-triggered modal focus, nested portals, and keyboard submission need explicit
  browser coverage. The warning must remain understandable without color or an AM/PM-native picker.
- Performance: classification and state are bounded per field; no network calls, polling, storage
  scans, or per-generated-record prompts.
- Tenant isolation and external effects: the warning uses the active Organization's existing time
  context; it adds no tenant selection, persistence, provider calls, or external effects. Existing
  save authorization remains unchanged.
- Migration and rollback: no schema or stored-data change. Revert the cohesive component and caller
  change to remove the advisory warning without transforming saved times.
- Artifacts: implementation regenerates the web bundle through the standard build. No generated
  source, mockups, or other assets are required by this plan.
- No ADR is needed for this reversible UI policy. Organization Timezone is already defined in
  `CONTEXT.md`; the warning introduces no new domain entity or glossary term requiring an update.

## Local implementation evidence

Implemented the domain classifier and one application-owned shared `UnusualTimeInput`, replacing all
14 identified native clock inputs across the nine inventoried form modules. The wrapper retains
native input handlers and uses the repository confirmation dialog. Added a backwards-compatible
`cancelLabel` option to that primitive. A separate generic UI input was unnecessary: the wrapper is
an application workflow, and its native input remains directly reusable across these forms.

A blocked Save attempt requires pressing Save again after confirming. It is not automatically
replayed, avoiding stale form snapshots and duplicate mutations. Change time retains the draft.

Verification: 14 domain cases and eight focused UI tests (including existing confirmation tests)
passed; focused ESLint and the web build passed. An earlier workspace typecheck passed; the final
rerun reports TS2769 errors in unrelated, already-modified RosterPageRemoval, PublicWebsiteManager,
and PublicOrganizationSite UI tests. Those changes were preserved. No schema, route, provider, or
hosted-resource changes. The web build regenerates local `dist` assets normally. Browser
desktop/mobile and theme checks remain pending; no Playwright qualification or full release gate was
run. Changes are local, uncommitted, unpushed, and undeployed.
