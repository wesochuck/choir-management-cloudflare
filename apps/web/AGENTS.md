# Web Application Agent Instructions

These instructions inherit the repository root `AGENTS.md` and apply under `apps/web/`.

## React and Browser State

- Keep infrastructure details and business rules out of React. Consume typed contracts and domain
  helpers instead.
- Do not import React only for JSX; use type-only imports when needed.
- Follow Hook purity and exhaustive-dependency rules. Do not place hooks below early returns or call
  impure functions during render.
- Do not blindly copy query data into local state. Background refetches must not erase unsaved
  input.
- Do not render editable forms from fallback query values while initial data is loading. Show an
  explicit loading state and initialize drafts from confirmed data.
- Preserve typed mutation errors through the browser client and UI. Prefer stable error codes and
  actionable messages; test success, validation, authorization, and operational failures.
- Keep localized date displays, browser control values, and ISO timestamps distinct. Normalize
  date/time input before timezone conversion and use deterministic timezone tests.
- Shared query keys belong in one typed registry.
- For camera features, wait for `loadedmetadata` and successful `video.play()` before enabling
  capture. Stop media tracks when closing or unmounting.

## Components and Accessibility

- Use repository-owned primitives from `@choir/ui`, built on Radix, for dialogs, confirmations,
  tables, and other shared interactions. Do not introduce Shoelace or Web Awesome implementations.
- Full-page settings views, configuration forms, and editable entity pages must use
  `usePersistedDraft` (or register with `SaveCoordinator` via `useSaveRegistration`) with explicit
  baseline snapshotting, pure boolean `dirty` computation, and snapshot concurrency isolation so the
  unified `SaveBar` appears and in-app navigation, tab switching, workspace switching, sign-out, and
  window unload are guarded with accessible confirmation prompts before discarding unsaved edits.
- Modal dialogs with editable form fields must use the `@choir/ui` `Dialog` component and pass
  `dirty` (or rely on `Dialog`'s built-in input dirty tracking). Cancel buttons inside dialogs must
  be wrapped in `<DialogClose asChild><button ... type="button">Cancel</button></DialogClose>`
  rather than calling `onClose()` directly, ensuring that dismissal attempts (Cancel button, Escape
  key, backdrop click, or header close button) prompt with a confirmation dialog before discarding
  unsaved edits.
- Destructive actions require a danger-styled confirmation with a visible Cancel action.
- Icon-only controls require accessible labels. Hide decorative icons from assistive technology.
- Use the shared `DataTable` for tabular data and preserve its mobile-card behavior.
- Displayed data columns must have sortable, keyboard-accessible headers unless a documented product
  reason makes a column non-sortable. Action columns are not data columns.
- Performer eligibility is a non-empty `voicePart`, not an authorization role.
- Use the exact product language in `CONTEXT.md`: Organization, Organization Profile, Organization
  Membership, Platform Administrator, and On Break in the UI; use `Idle` in storage, API, and CSV.

## Styling

- Tailwind CSS v4 is imported from `apps/web/src/main.css` and coexists with layered BEM component
  styles under `apps/web/src/styles/`.
- Design tokens live in the `@theme` block in `main.css`. `theme.css` is the ordered stylesheet
  manifest, and `tokens.css` owns aliases, control geometry, and dark-theme overrides.
- Prefer Tailwind utilities for new UI and retain BEM classes for existing components. Preserve the
  import and cascade order in `theme.css`.
- Redefine tokens for dark mode instead of adding raw component-level dark-mode overrides.
- Use the existing `--font-size-*`, `--line-height-*`, `--font-weight-*`, `--radius-*`, and
  `--shadow-*` scales. Adjust the nearest shared token when a scale step is genuinely wrong rather
  than adding a one-off raw value.
- Native `<select>` elements must retain their browser-provided chevron and readable option colors
  in both themes.
- For custom `<details>` dropdowns, match `.music-genre-filter summary::after`: use `⌃`, rotate it
  180 degrees while closed, and return it to 0 degrees while open.
- Inline form action buttons placed in the same row as `<input>` or `<select>` controls (such as
  inline search bars, copy rows, quick-add performance actions, or scanner toolbars) must match
  `--control-height` (`2.5rem` / `40px`) using
  `height: var(--control-height); min-height: var(--control-height); padding: 0.55rem 0.75rem; box-sizing: border-box;`
  (or `.button--control-height`) so that their top and bottom baselines align seamlessly with
  neighboring inputs. Standalone buttons in dialog footers (`.dialog__actions`) and floating save
  bars retains standard full-size control styling (`min-height: 3rem`).

## Web Verification

- Run focused component or browser tests for changed flows.
- Check light and dark themes, responsive layouts, focus states, keyboard interactions, and relevant
  print views after visual-system changes.
- If a push touches browser-visible behavior, run the full browser E2E suite after
  `npm run check:ci`.
