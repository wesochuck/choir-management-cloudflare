# UI/UX Improvement Plan — Web + UI Primitives

- Date: 2026-09-04
- Status: Plan only — no source changes made.
- Scope: `apps/web/src/**`, `packages/ui/src/**`, `apps/web/src/styles/**`, `apps/web/src/main.css`
- Sources: read-only review of `App.tsx`, `public/*`, `auth/*`, `persistence/*`, `styles/*`,
  `main.css`, `packages/ui`; `apps/web/AGENTS.md`, `packages/AGENTS.md`, root `AGENTS.md`.
- Non-goals: no route renames, no contract changes, no tenancy/storage changes, no milestone 7 /
  production, no legacy imports, no external component libraries.

## 0. Constraints

- Strict TypeScript; no `any` / `as any`; narrow `unknown`.
- Editable dialogs use `@choir/ui` `Dialog` + `<DialogClose asChild>` for Cancel; all close paths
  route via `requestClose()`.
- Use shared `DataTable`; preserve mobile-card; sortable keyboard headers unless documented.
- Inline-row buttons match `--control-height: 2.5rem` via `.button--control-height`; dialog footers
  / save bars keep `min-height: 3rem`.
- No eyebrows; use `h1`/`h2` + `page-heading__description`. `npm run check:no-eyebrows` must pass.
- Redefine tokens for dark mode; use `--font-size-*`, `--radius-*`, `--shadow-*`, `--spacing-*`
  scales.
- Never strip `?token=` on `/player`, `/rsvp`, `/poll`, `/auditions`, `/unsubscribe`.
- One Organization = one tenant; player offline scope stays `window.location.host`.

## Phase 0 — Baseline

1. Record `git status --short --branch` (clean `main...origin/main` observed on 2026-09-04).
2. Capture baseline: `npm run format:check`, `npm run lint`, `npm run typecheck`,
   `npm run check:no-eyebrows`.
3. Capture focused tests: `vitest run apps/web/src/public apps/web/src/persistence packages/ui`.
4. Manual matrix to re-check after each phase: light/dark (`data-theme`), 320/768/1280px,
   keyboard-only, `prefers-reduced-motion`, print where touched.

## Phase 1 — Accessibility correctness

### 1.1 Decorative icons hidden

- `apps/web/src/public/PublicPollView.tsx:122` — add `aria-hidden="true"` to decorative check
  `<svg>`.
- `apps/web/src/account/components/MusicCatalog/MusicTableTuttiDropTarget.tsx:185` already has
  `aria-hidden="true"` on the `<svg>`; extend `MusicTableTuttiDropTarget.test.tsx:89` to assert
  `expect(html).toContain('aria-hidden="true"')` to protect against regressions.
- `apps/web/src/account/components/CommandPalette/CommandPaletteModal.tsx:180-190,261-272,338-400` —
  add direct `aria-hidden="true"` on each icon `<svg>`.
- Audit callers of `.table-filter-badge button`
  (`apps/web/src/styles/components/data-table.css:466-474`) — ensure every icon-only `×` has an
  accessible label like `aria-label="Remove … filter"`.
- Done when: Screen readers announce no decorative SVG artifacts; unit tests pass.

### 1.2 Field-error linkage

- Add `id` + `aria-describedby` / `aria-errormessage` + `aria-invalid` wherever
  `notice--error role="alert"` sits above inputs:
  - `apps/web/src/account/VenuesPage.tsx:228-243`: link `p.notice--error` (`id="venue-form-error"`)
    to inputs via `aria-describedby="venue-form-error"` and `aria-invalid={Boolean(error)}`.
  - `apps/web/src/account/PollsPage.tsx`:
    - `PollEditDialog` (lines 339–405) currently lacks an in-dialog error display. Add
      `notice--error role="alert" id="poll-dialog-error"` inside the dialog and link fields via
      `aria-describedby` and `aria-invalid`.
    - Fix `savePoll` (lines 538–543), which currently puts save errors into `message` outside the
      dialog. Set a dialog-scoped error state so users inside the dialog see why saving failed.
    - (Note: lines 193 and 588 are read-only results and page load errors, not form input errors).
  - `apps/web/src/account/components/EventsPage/dialogs.tsx`: link error alerts at lines 119, 416,
    576, 614 to adjacent inputs with unique IDs and `aria-describedby`.
  - `apps/web/src/public/PublicDonationView.tsx:109-138`: associate error alert with custom amount
    and billing inputs.
  - `apps/web/src/public/PublicTickets.tsx:369-394`: link checkout and discount code errors to input
    controls.
  - `apps/web/src/auth/SignInView.tsx`, `apps/web/src/auth/ResetPasswordView.tsx`: link submission
    error alerts to email/password/code fields.
- Model on `MySchedule.tsx:293,303`, `DashboardView.tsx:438,448`, `MusicFolderReport/view.tsx:320`.
- Done when: every field error is programmatically associated; axe / `getByDescribedBy` assertions
  pass.

### 1.3 Live regions for warnings

- Add `role="status"` to actionable warnings currently silent:
  - `MemberDuesPage.tsx:99`, `DashboardView.tsx:51,301,320,337,361`,
    `OrganizationSettingsPage.tsx:211`, `TicketScanner.tsx:358`,
    `PlatformEmailSuppressions.tsx:443,496`, `OrganizationMfaPrompt.tsx:48`.
- Model on `SeatingFinder.tsx:72`, `SetupChecklistView.tsx:122`, `DashboardView.tsx:714`.
- Done when: warnings are announced to screen readers without stealing keyboard focus.

### 1.4 Tabs — APG tabs vs toolbar & shared primitive

- Architectural distinction:
  - **True content-panel tabs**: `SeasonsManager.tsx:242-272`, `TicketingManager.tsx:460-480`,
    `RosterPage/view.tsx:132-167,525-591`, `ReportsView.tsx:121-143`,
    `DeadLetterWorkspace.tsx:11-33`, `DonationsManager.tsx:162-211`, `EventsPage/page.tsx:414-431`,
    `MusicCatalog/view.tsx:353-393`, `AuditionManager/page.tsx:304-326`, `SeatingTabs.tsx:8-30`.
  - **Filter toggles**: `RsvpManagerFilters.tsx:86-115` mixes table row filters (Attending,
    Declined, No response) with view switching (Roster vs History). Separate into an accessible view
    switch and a filter group (`role="toolbar"` or `role="group"` with `aria-pressed`), instead of
    pseudo-`role="tablist"` without tabpanels.
- Reusable UI primitive:
  - Avoid implementing ad-hoc roving tabindex and Arrow key listeners across 10 manager files.
  - Introduce a lightweight, repository-owned `Tabs` primitive (or `useRovingTabs` hook) in
    `packages/ui` following `packages/AGENTS.md`.
  - Encapsulate `role="tablist"`, roving `tabIndex={selected ? 0 : -1}`,
    `ArrowLeft`/`ArrowRight`/`Home`/`End` keyboard navigation, `role="tabpanel"`, and
    `aria-selected` / `aria-controls` bindings.
- Done when: keyboard arrow keys navigate tabs seamlessly, tab key skips inactive tabs to panel
  contents, and `userEvent.keyboard` tests verify APG compliance.

### 1.5 Command palette + listboxes + radios + disclosure

- `CommandPaletteModal.tsx:247-258,323-335`: `role=option` divs are mouse-only — add per-option
  `id` + `aria-activedescendant` on input pointing at the active item.
- `CommandPaletteModal.tsx:158-160`: replace `setTimeout(focus, 50)` with Radix
  `DialogPrimitive.Content` `onOpenAutoFocus`.
- `SetListManager/view.tsx:444`: verify/add listbox keyboard navigation.
- `public/player/components/PlayerPartSelector.tsx:141-189`: `role="radiogroup"` currently places
  all radios in Tab sequence; implement standard APG radiogroup keyboard navigation
  (`tabIndex={isSelected ? 0 : -1}` + Arrow navigation).
- `apps/web/src/account/components/PlatformOperations/OrganizationDomains.tsx:58-74`: ensure toggle
  chevron `<svg>` has `aria-hidden="true"`.
- `MemberProfileDirectory.tsx:376-410`: camera dialog is currently a hand-rolled `role="dialog"`
  lacking focus trapping; migrate to `@choir/ui` `Dialog` to guarantee focus trapping, Escape
  handling, and focus return.
- Done when: browse-mode screen reader and keyboard testing confirm zero focus loss or trapped focus
  escapes.

## Phase 2 — Dialogs + SaveBar

### 2.1 Cancel via `DialogClose`

Replace direct `onClose()` / `close*` Cancel buttons with:

```tsx
<DialogClose asChild>
  <button disabled={saving} type="button">
    Cancel
  </button>
</DialogClose>
```

- Target files:
  - `account/PollsPage.tsx:398`
  - `account/PlatformEmailSuppressions.tsx:464,516-522`
  - `account/components/SeatingManager/shared.tsx:29`
  - `account/components/SeasonsManager/DeleteSeasonDialog.tsx:40`
  - `account/AttendanceManager.tsx:125`
  - `account/components/EventsPage/dialogs.tsx:582,624`
  - `account/components/EventsPage/bulkRehearsals.tsx:139`
  - `account/components/SetListManager/dialogs/PrintPreviewDialog.tsx:31`
  - `account/components/AuditionManager/tableAndDialogs.tsx:345,370`
  - `account/components/AuditionManager/shared.tsx:185,329`
- Reference existing correct patterns: `VenuesPage.tsx:258-262`, `MySchedule.tsx:308-312`,
  `DashboardView.tsx:453-461`, `CommunicationTestDialog.tsx:62-66`.
- In `PollsPage.tsx:331-335`, ensure dismissal routes through `requestClose()` so that unsaved
  changes trigger the confirmation prompt.
- Done when: Cancel button, Escape key, backdrop click, and header close icon all route through
  `packages/ui/src/Dialog.tsx:41-54` confirm dialog when form is dirty.

### 2.2 Busy-state discipline

- Disable Cancel button during active saving (`disabled={saving}`) to prevent conflicting dismissal
  during network mutations (`SeasonDialog.tsx:102`, `PollsPage.tsx:398`,
  `PlatformEmailSuppressions.tsx:464,516`).
- Add `aria-busy="true"` where labels swap but screen readers have no status region
  (`VenuesPage.tsx:263-264`, `PlatformAccess.tsx`, `PollsPage.tsx:401`,
  `OrganizationBrandingPanel.tsx:274-297`).
- `TicketScanner.tsx:443`: add `Validating…` label swap.
- Done when: in-flight mutations block conflicting cancel actions, and loading status is announced.

### 2.3 `SaveBar.tsx:3-39` failure surfacing

- `persistence/SaveCoordinator.tsx:79-113` returns `{ errors: readonly string[]; success: boolean }`
  from `saveAll()`. `SaveBar` currently runs `void saveAll()` and discards the return value.
- Update `SaveBar`:
  - Track `saveError: string | null` in local state.
  - Await `saveAll()`; if `errors.length > 0`, render `notice--error role="alert"` with error
    details and a retry button.
  - Clear error state on subsequent save attempts or when `discardAll()` is invoked.
  - Preserve `role="region" aria-label="Unsaved changes" aria-live="polite"`.
- Done when: persistence failures surface actionable feedback in `SaveBar`; test error return paths.

### 2.4 Focus initial

- Remove competing `autoFocus` on first inputs inside dialogs (`VenuesPage.tsx:235`,
  `PlatformEmailSuppressions.tsx:451,503`, `SeasonDialog.tsx:50`, `EventsPage/dialogs.tsx:127`,
  `SeatingDialogs.tsx:75,293,395`).
- Rely on Radix Dialog's built-in focus trap or explicit `onOpenAutoFocus` to prevent focus racing
  and viewport jump bugs.
- Done when: dialog open transitions are smooth and focus lands predictably on the first interactive
  control.

## Phase 3 — Visual token convergence

### 3.1 Pill radius

- `main.css:38` defines `var(--radius-full: 9999px)`.
- Replace ~50× raw `999px` (`player.css`, `music-piece.css`, `seating-editor-layout.css`,
  `calendar-attendance.css`, `signed-in-shell.css`, `autocomplete.css`, `account-schedule.css`) and
  3× `9999px` (`account-managers.css:301,369,377`) with `var(--radius-full)`.
- Keep raw `50%` circles.
- Fix one-offs: `account-managers.css:418,441: 4px` → `var(--radius-sm)`; `auth-account.css:129`,
  `autocomplete.css:33` → token scale.
- Done when: `rg "999px"` returns zero hits outside comments; visual regression checks show
  identical appearance.

### 3.2 Type / weight / spacing

- Convert raw rem font sizes to tokens:
  - `account-managers.css:291: 0.75rem, 320: 0.875rem, 354: 1rem, 397: 0.8125rem`,
    `autocomplete.css:55: 0.7rem`, `signed-in-shell.css:301: 1.15rem`,
    `music-settings.css:890: 1.5rem`, `signed-in-workspace.css:301` →
    `var(--font-size-xs/sm/md/lg)`.
- Raw `font-weight: 500/600` → `var(--font-weight-medium/semibold)`.
- `forms-layouts.css:240-241: height: 2.5rem` → `var(--control-height)`.
- Done when: raw typography values outside tokens are removed.

### 3.3 Control-height unification

- Canonical baseline: `tokens.css:16` (`--control-height: 2.5rem` / 40px) and
  `.button--control-height` (`shell-refinements.css:36-41`).
- As mandated by `apps/web/AGENTS.md:81-87`, all inline form action buttons placed in the same row
  as `<input>` or `<select>` controls must match `--control-height` (40px) so baselines align
  seamlessly.
- Reconcile competing button heights:
  - Standalone buttons in dialog footers (`.dialog__actions`) and `SaveBar` retain standard
    `min-height: 3rem`.
  - Resolve `.button--small` conflict: `signed-in-shell.css:78-82` (`2.6rem`) vs
    `usability-themes.css:114-117` (`2.3rem`). Standardize `.button--small` to
    `--control-height-sm: 2rem` (32px) in `tokens.css` and use consistently.
  - Align inline search, filter, and action buttons in `data-table.css`, `signed-in-shell.css`,
    `account-managers.css`, `forms-layouts.css`, `music-settings.css`, `usability-themes.css` with
    `--control-height`.
- Done when: inline input+button rows align top and bottom at 40px; no mixed heights within
  toolbars.

### 3.4 Dark-mode token discipline

- `styles/components/command-palette.css:33-527` (13 raw dark blocks `#12161f/#272f3d/#1e2430…`) →
  `var(--color-surface-raised/border/text-muted)` + dark tokens in `tokens.css`.
- `music-settings.css:563-607` genre chips → define `--genre-chip-*` tokens in `main.css:@theme` and
  configure dark overrides in `tokens.css`.
- Replace undefined tokens and raw hex fallbacks:
  - Fix `data-table.css:336,362`: replace undefined `var(--foreground)` with `var(--color-text)` and
    `var(--card)` with `var(--color-surface)`.
  - Replace `overlays.css:142,154: --color-primary-hover` with defined hover tokens.
  - Reconcile `communications-provider.css:718-732: --color-info/success/danger` and
    `account-managers.css:376: --color-primary,#2563eb`.
- Replace raw `color-mix` hex (`signed-in-shell.css:284-285: #d97706`,
  `forms-layouts.css:346,350,354: #ec4899/#f59e0b/#10b981`, `player.css:303,310`, `base.css:31`)
  with semantic tokens.
- Done when: no raw hex colors exist in dark-mode style blocks.

### 3.5 Headings / no-eyebrows

- No `.eyebrow` class exists — ensure `npm run check:no-eyebrows` remains completely green.
- Audit uppercase text transforms: preserve `text-transform: uppercase` for table headers, badges,
  and navigation tags. Convert eyebrow-like headers (`summary-card__label`, `workspace-hero__label`,
  `poll-respondents-heading`) to `page-heading__description` or section copy.
- Consolidate competing `h1`/`h2` rules across `public-site.css`, `usability-themes.css`, and
  `shell-refinements.css`. Single-source scale in `main.css` (`--font-size-hero/section`); eliminate
  one-off `clamp()` expressions.
- Done when: heading hierarchy is visually consistent and unaffected by stylesheet cascade order.

### 3.6 Inline styles + focus-ring consistency

- Convert static `style={{}}` declarations to CSS utility or component classes
  (`OrganizationBrandingPanel.tsx`, `OrganizationEmailSettingsPanel.tsx`, `ModuleSettingsView.tsx`,
  `SetupView.tsx`, `AddToSetListDialog.tsx`, `SetListManager/view.tsx`, `SeatingManager/view.tsx`,
  `EventsPage/page.tsx`, `tracksAndBulkEdit.tsx`).
- Preserve dynamic styles (progress percentages, seat coordinates, theme token demos).
- Unify focus rings to `base.css:99` (`0.2rem var(--color-accent)`); eliminate conflicting ring
  widths (`2px` vs `3px`).
- Done when: lint passes without static style warnings; focus rings are uniform across all
  interactive controls.

## Phase 4 — Public flows + auth

### 4.1 Consistent loading / error / empty

- Signed-link preservation:
  - As required by `apps/web/AGENTS.md:23-27`, `/player`, `/rsvp`, `/poll`, `/auditions`, and
    `/unsubscribe` must NEVER strip `?token=` on mount or view transitions.
  - Retry buttons on public views must trigger in-place state refetches and must NOT call
    `window.location.reload()` or perform URL manipulations.
- Loading and error states:
  - Replace bare `<h1>Loading…</h1>` in `PublicPlayerView.tsx`, `PublicRsvpView.tsx`,
    `PublicPollView.tsx`, `PublicAuditionView.tsx` with shared `role="status"` skeletons and retry
    actions.
  - `PublicDonationView.tsx:70-85`:
    - When settings fail to load, display a `role="alert"` notification.
    - Fix empty levels bug: when `loaded.levels` is empty, set `useCustom = true` and initialize
      amount to `$0` (with required validation) rather than silently charging an unexpected default
      `$25`.
  - `PublicPollView.tsx`: render an explicit empty state when `options.length === 0` instead of a
    perpetually disabled submit button.
  - `PublicAuditionView.tsx:617-619`: when settings fetch fails, do NOT fallback to `enabled: true`
    (`fallbackPublicAuditionSettings`); render an explicit error state with a retry button.
  - `PublicAuditionView.tsx:399-421`: display `role="alert"` feedback if audition update submission
    fails.
- Standardize empty states:
  - Convert bare `<p>No … yet.</p>` to `<div className="empty-state">` with actionable next-step
    buttons across ticketing, dues, donations, patrons, seasons, and resources tabs.
- Done when: every asynchronous view has comprehensive loading, error+retry, and empty states.

### 4.2 Form semantics + validation

- Public RSVP (`PublicRsvpView.tsx`):
  - Do NOT automatically coerce unresponded/pending status (`details.rsvp === "Pending"`) to `"Yes"`
    (line 134). Initialize `rsvp` to `null` so users must make an explicit selection before
    submission.
  - Convert Yes/No buttons to a proper `radiogroup` with `aria-checked` inside a
    `fieldset`/`legend`.
  - Rehearsal decline note validation: when declining a rehearsal, connect the required note
    validation error to the textarea via `aria-describedby` and `aria-invalid`.
- Public Poll (`PublicPollView.tsx`):
  - Convert custom option buttons to standard `role="radio"` / `role="checkbox"` with `aria-checked`
    inside a `fieldset`/`legend`.
  - Provide descriptive guidance when submit is disabled.
- Audition Form (`PublicAuditionView.tsx`):
  - Convert `div.form-stack` to `<form onSubmit={...}>` with native email and phone validation.
  - Add optional availability notes field to initial creation form to match update form
    capabilities.
- Public Donations (`PublicDonationView.tsx`):
  - Custom amount input: use `inputMode="decimal"` and validate positive currency format.
  - Associate top `role="alert"` with invalid fields.
- Public Tickets (`PublicTickets.tsx`):
  - Clamp ticket quantities (`0 < q <= maxPerOrder`) and display inline validation messages.
  - Discount code validation: provide `Checking…` indicator and clear success/error live
    announcements.
- Authentication:
  - `SignInView.tsx:322-332`: "Request a new code" currently calls `setStep("credentials")`
    identical to "Use a different email". Update "Request a new code" to call the resend endpoint
    for the existing email address, start a 30-second countdown timer, and announce code dispatch.
  - `ResetPasswordView.tsx`: add an accessible show/hide password toggle.
- Done when: form validation errors are programmatically linked to fields, no disabled buttons lack
  explanatory context, and authentication resend works correctly.

## Phase 5 — Responsive + player

### 5.1 Tables + pagination

- `packages/ui/src/DataTable.tsx`:
  - Move `<nav className="data-table-pagination">` and `<div className="data-table-cards">` outside
    `.table-scroll`.
  - `.table-scroll` should only wrap `<table className="data-table">` so that pagination controls
    and mobile cards do not participate in or cause horizontal scrolling.
  - Fix dark-mode pagination color: replace undefined `var(--foreground)` with `var(--color-text)`
    and `var(--card)` with `var(--color-surface)` in `data-table.css:336,362`.
  - Add `:focus-visible` ring styling for `table-filter-badge button`.
- Verify seating chart canvas responsiveness at 320px viewport.
- Done when: 320px viewport exhibits zero horizontal overflow outside intentional table scrolling,
  and pagination is always visible.

### 5.2 Practice Player gaps

- Playback symmetry:
  - Make `nextTrack` and `previousTrack` symmetrical: both should preserve the active playback state
    (`selectItem(targetIndex, playing)`).
- Online audio error handling:
  - In `PublicPracticePlayer.tsx:206-222`, remove `if (navigator.onLine) return;` so that online
    playback failures (404, CORS, expired signed token, media decode error) are surfaced via a
    `role="alert"` live region with a "Retry playback" action.
- Mobile Sheet volume:
  - Document the platform constraint: iOS Safari disables software `audio.volume` control in favor
    of physical device buttons. Display volume controls on desktop/tablet sheets, and display an
    informational note on mobile touch viewports.
- Bottom sheet & part selector:
  - Migrate `PlayerPartSelector.tsx:102-140` from hand-rolled modal backdrop to `@choir/ui` `Sheet`,
    leveraging Radix focus trapping, Escape handling, and `restoreFocusRef`.
  - Implement APG radiogroup keyboard navigation on voice part items
    (`tabIndex={isSelected ? 0 : -1}` + Arrow navigation).
- Done when: transport controls remain visible above the fold on mobile, audio playback failures are
  clearly reported, and voice part selection is fully accessible.

## Phase 6 — Contrast / dark / focus polish

- Contrast verification:
  - Restrict accent `#ea580c` and success `#16a34a` to large headings, bold text, and UI containers;
    never use for standard body copy.
  - Verify `table-filter-badge` badge contrast, `text-button--danger` on transparent backgrounds,
    and muted text (must meet ≥ 4.5:1 ratio).
- Focus visibility:
  - Add high-contrast `:focus-visible` styling for audio player scrubber and volume sliders in
    `player.css`.
  - Add visible outline for `command-palette-item.is-selected` under keyboard navigation.
  - Enhance dialog backdrop overlay contrast in dark mode.
- Print stylesheet:
  - Preserve high-contrast grayscale styling (`#555`) in `print.css` for paper printing without
    affecting screen themes.
- Done when: axe contrast checks pass across all changed flows in light and dark modes.

## Verification

- Verification after each phase:
  - `npm run format:check`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run check:no-eyebrows`
  - Focused vitest runs: `npx vitest run apps/web/src/public apps/web/src/persistence packages/ui`
- Parity checks:
  - If any route or parity matrix entry is modified, run `npm run check:parity` and
    `npm run check:parity:implementation` (not expected for UI/UX improvements).
- Release qualification:
  - Build artifact: `npm run build`
  - Complete check suite: `npm run check:ci`
  - End-to-end tests: ensure Chromium is installed, then run `npm run test:e2e`
- Manual verification:
  - Test light and dark themes via `data-theme` toggle.
  - Test viewports: 320px, 768px, and 1280px.
  - Perform full keyboard-only walkthrough of dialogs, tabs, forms, and audio player.
  - Verify screen reader announcements for `role="alert"` and `role="status"`.
  - Confirm `?token=` parameter persists across public view interactions.

## Risks, rollback, isolation

- **Tabs interaction**: Migrating to APG tabs alters keyboard navigation (Tab moves past inactive
  tabs). Mitigate with roving tabindex and comprehensive keyboard unit tests before rolling out
  across views.
- **Token unification**: Replacing raw radii and heights could cause slight visual shifts. Mitigate
  by checking responsive layouts before and after changes.
- **Dirty dialog guards**: Ensuring all Cancel paths route through `DialogClose` ensures unsaved
  work is protected. Verify with automated dirty-guard tests.
- **Rollback strategy**: All changes are modular, pure client-side TypeScript and CSS without schema
  migrations or backend dependencies. Slices can be independently reverted.
- **Tenant isolation**: Offline audio storage remains scoped to `window.location.host`. No storage
  keys, auth tokens, or API contracts are altered.
- **Performance**: Retain route-level code splitting (`lazyComponents.ts`). Ensure no O(N²) sorting
  or linear scans are introduced in item lists.

## Suggested execution order (PR slices)

1. **PR 1**: Decorative icons (1.1), field-error linkages (1.2), warning live regions (1.3), and
   Dialog Cancel via `DialogClose` (2.1).
2. **PR 2**: Accessible `Tabs` primitive and view/filter separation (1.4), command palette /
   radiogroup keyboard navigation (1.5), busy states (2.2), `SaveBar` failure surfacing (2.3), and
   dialog initial focus (2.4).
3. **PR 3**: Token convergence — radius (3.1), typography (3.2), control-height unification (3.3),
   and `DataTable` pagination layout fix (5.1).
4. **PR 4**: Dark mode tokens (3.4), heading hierarchy (3.5), inline styles cleanup (3.6), and
   contrast/focus polish (Phase 6).
5. **PR 5**: Public flow loading/error/empty states (4.1), form validation semantics, and auth code
   resend fix (4.2).
6. **PR 6**: Practice player playback symmetry, online audio error surfacing, mobile Sheet volume,
   and part selector Sheet migration (5.2), followed by full `check:ci` and Playwright E2E
   verification.
