# Sidebar UI/UX implementation plan

- Status: Proposed; implementation has not started.
- Scope: Authenticated workspace navigation in pinned desktop and unpinned drawer states.
- Source: User-provided screenshots and sidebar UI/UX discussion; repository inspection.
- Delivery: Documentation now. A future coding agent implements the core phases below when assigned.
- Related plan: [Web UI/UX improvement plan](2026-09-04-ui-ux-improvement-plan.md).
- Repository instructions: Read root and applicable directory AGENTS.md files before implementing.

## Goal

Make navigation easier to scan, reduce space consumed above the first destination, and make the
difference between persistent and temporary navigation clear. Preserve the navy/orange visual
identity, existing routes, workspace permissions, Organization context, and unsaved-change protection.

The screenshot review identified inconsistent headers between states, oversized visual emphasis on
pin/collapse controls, generous vertical spacing, muted links that can resemble disabled controls,
and repetitive navigation dots. Screenshots do not establish CSS pixel dimensions, measured contrast,
or live keyboard behavior. Capture a fresh baseline before implementation.

## Existing implementation and responsibility map

| File | Responsibility |
| --- | --- |
| `apps/web/src/account/components/AuthenticatedShell/shell.tsx` | Pinned preference, drawer state, toolbar/header rendering, search handoff and focus restoration |
| `apps/web/src/account/components/AuthenticatedShell/navigation.tsx` | Shared navigation groups, links and current-page semantics |
| `apps/web/src/account/components/AuthenticatedShell/hooks.ts` | Route changes and unsaved-change guard; preserve behavior |
| `apps/web/src/account/components/AuthenticatedShell/workspacesUtils.tsx` | Workspace navigation definitions; inspect before changing labels |
| `apps/web/src/styles/components/signed-in-shell.css` | Sidebar geometry, controls and navigation styles |
| `apps/web/src/styles/components/shell-refinements.css` | Existing style refinements; inspect cascade before adding overrides |
| `apps/web/src/main.css`, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/theme.css` | Verify actual token/manifest locations before editing; retain existing token and import ownership |
| `apps/web/e2e/auth.admin-navigation.spec.ts` | Existing admin navigation regression coverage |
| `apps/web/e2e/responsive.audit.spec.ts` | Existing responsive coverage |
| `apps/web/e2e/accessibility-axe.spec.ts` | Existing accessibility coverage |

Inspection confirms that the current pin preference uses localStorage key
`choir-sidebar-pinned:${window.location.hostname}` and tolerates unavailable storage.
Navigation already chooses one most-specific current route and uses `aria-current="page"`.
The route hook calls `requestGlobalLeave`; sidebar changes must not bypass that guard.

Revalidate file locations and behavior against the implementation checkout. Treat prior plans as
intent rather than evidence that a feature is present.

## Core behavior contract

Use separate concepts for saved desktop pin preference and temporary drawer visibility. Do not
overwrite desktop preference merely because the viewport becomes narrow.

| State or action | Required outcome |
| --- | --- |
| Desktop, pinned | Sidebar participates in page layout; main content remains interactive |
| Desktop, unpinned and closed | Content uses available width; navigation trigger remains visible |
| Desktop, unpinned and open | Modal drawer overlays content with backdrop and focus containment |
| Pin an open desktop drawer | Close modal layer, release scroll lock, show persistent sidebar and transfer focus to its corresponding control |
| Unpin desktop sidebar | Keep navigation available in the drawer and transfer focus to its corresponding control |
| Collapse desktop sidebar | Hide sidebar, set preference to unpinned, and focus the visible navigation trigger |
| Close drawer by button, Escape or backdrop | Close drawer without navigation; restore focus to the visible trigger |
| Select destination while pinned | Navigate through existing guard; sidebar stays visible |
| Select destination in drawer | Close only after accepted navigation; cancellation of unsaved-change confirmation keeps current route and usable navigation |
| Modified link click | Preserve native new-tab/window behavior without forcing drawer closure |
| Narrow viewport | Drawer navigation only; hide pin control; retain saved desktop preference |
| Return to desktop | Restore layout from saved preference; remove stale backdrop, focus trap or body scroll lock |

Reuse the existing shared Sheet/modal primitive. Avoid simultaneous interactive copies of navigation.
When resizing, retain focus if its element remains visible; otherwise transfer it to a visible,
equivalent control. Do not steal focus during ordinary layout changes.

## Phase 0 — Baseline and implementation reconnaissance

- [ ] Inspect Git status and preserve all unrelated work.
- [ ] Read root/web instructions, current shell, navigation, Sheet, command-palette trigger,
      responsive CSS, style import order and existing tests.
- [ ] Record actual breakpoint and CSS dimensions; screenshots may have device scaling or zoom.
- [ ] Capture matching before screenshots for pinned and unpinned desktop, plus mobile drawer.
- [ ] Exercise pin, unpin, collapse, close, route selection, search and dirty-form cancellation.
- [ ] Classify each required behavior as existing, partial or missing; retain working behavior.

Done when the coding agent has a short baseline and exact files to change, with no assumptions that
existing accessibility or persistence must be rebuilt.

## Phase 1 — Compact, consistent visual structure

- [ ] Share the workspace heading/context presentation between sidebar and drawer.
      Use the existing workspace label as the main heading (for example, Organization Admin).
      Retain Organization identity in the global header and any context necessary when the drawer
      covers it. Avoid redundant large identity blocks and generic Workspace kicker text.
- [ ] Align heading and controls in one compact header area; place search immediately below.
      Allow long Organization/workspace names to wrap without overlapping controls.
- [ ] Start with approximately 18rem desktop width, evaluating a 280–304 CSS px range only if
      needed. The current base CSS already reaches 18rem; do not increase width blindly.
      Use existing responsive rules and tokens; mobile must fit a 320px viewport.
- [ ] Reduce header padding and inter-group gaps before shrinking typography or hit targets.
      Keep navigation rows comfortably clickable, at least the existing 40px baseline, and
      provide approximately 44px touch targets on touch layouts using repository tokens.
- [ ] Replace large circular control outlines with quiet control styling, explicit hover/focus
      states, and a visibly active pin treatment.
- [ ] Provide clear accessible action names and tooltips: Keep sidebar open, Unpin sidebar,
      Collapse navigation, Close navigation. Preserve toggle-state semantics.
- [ ] Brighten ordinary navigation labels using semantic text tokens. Keep group labels secondary.
- [ ] Retain active-row background and orange edge treatment; remove repetitive navigation dots.
      Use text-first navigation for this core pass; a new icon library is unnecessary.
- [ ] Keep header/search stationary while the navigation list scrolls. Use a bounded flex/grid
      layout with an explicitly shrinkable list region; account for dynamic header/banner height.
- [ ] Preserve theme token ownership and stylesheet order. Do not introduce eyebrow headings,
      hard-coded dark-mode component colors, or unrelated global control-size changes.

Done when both states have the same heading hierarchy, visibly available links, readable long labels,
and more useful navigation space without clipping or focus-ring loss.

## Phase 2 — State transitions, focus and scroll continuity

- [ ] Implement only missing portions of the behavior contract above.
- [ ] Preserve the existing hostname-scoped pin key and storage-failure fallback.
- [ ] Retain navigation scroll position during sidebar/drawer transitions and reopen.
      Keep transient position in memory scoped to the active workspace; do not persist route lists
      or introduce backend storage.
- [ ] After route or workspace changes, reveal the active item only if it is outside the visible
      navigation area. Avoid unnecessary scrolling or moving keyboard focus.
- [ ] Keep command-palette search available in both states with existing keyboard shortcuts.
      Ensure closing the palette restores focus to a visible element, including drawer-to-palette
      handoff.
- [ ] Respect reduced-motion preference; avoid double animations and background page jumps.
- [ ] Preserve current-route matching, permissions, workspace switching, SaveCoordinator guards,
      route-level code splitting and skip-link behavior.

Done when keyboard and pointer transitions work across breakpoints without invisible focused
elements, stale modal locks, lost unsaved edits or navigation preference resets.

## Phase 3 — Verification and evidence

Extend existing tests with behavior assertions; avoid snapshots that merely mirror markup.

- [ ] Pinned versus drawer layout, pin/unpin/collapse transitions and reload persistence.
- [ ] Storage unavailable: navigation still usable; narrow viewport does not overwrite desktop preference.
- [ ] Mobile and desktop resize while drawer is open, including focus and scroll-lock cleanup.
- [ ] Escape, backdrop and close button; modal focus containment and visible focus restoration.
- [ ] Dirty form: cancel and accept navigation from both states; verify route and drawer outcome.
- [ ] Search from both states, keyboard shortcut, close and focus restoration.
- [ ] Exactly one current-page link, nested route matching, native modified-click behavior.
- [ ] Long navigation list: scroll restoration, active item visibility and reachable last destination.
- [ ] All available workspace roles and module visibility; no new destinations exposed.
- [ ] Light/dark, 320/768/1280px widths and breakpoint boundaries; long labels, 200% zoom,
      keyboard-only use and reduced motion.
- [ ] Measure text contrast and inspect focus/control contrast; do not infer compliance from images.
- [ ] Capture after screenshots at the same viewport, theme, route and scale as the baseline.

Run focused component/browser tests through existing scripts, plus applicable formatting, lint,
typecheck, no-eyebrows and build checks. Read package.json to choose actual supported commands.
Before any push changing browser-visible behavior, follow repository requirements:
`npm run check:ci`, then the full `npm run test:e2e` suite with Chromium installed.
If routes or parity evidence change, also run `npm run check:parity` and
`npm run check:parity:implementation`. Do not weaken gates or introduce GitHub Actions.

Record commands, outcomes and exact reasons for skipped checks. This plan-only documentation change
does not constitute implementation verification.

## Optional follow-up — separate from core completion

These ideas require a separate implementation assignment; do not silently expand the core change.

1. Collapsible navigation groups: use semantic disclosure buttons, stable group identifiers and
   workspace-scoped preference storage; reveal the current route group automatically and test
   permissions/module changes. Avoid auto-collapsing unrelated groups.
2. Shorter labels: consider Invitations instead of Membership invitations only after reviewing
   product terminology and command-palette discoverability. Keep URLs unchanged.
3. Favorites: define add/remove controls, ordering, limits, persistence scope, empty state and
   permission revocation behavior before implementing.
4. Destination icons: evaluate against text-first navigation using existing repository assets.

## Scope boundaries, risk and handoff

No backend, schema, authentication, authorization, public signed-link, route rename or deployment
work is required. Preserve Organization isolation and existing preference scope. The main risks are
CSS cascade regressions, dirty-navigation races, focus restoration during modal transitions, and
preference resets at breakpoints.

Suggested commits: (1) shared header and visual density with focused evidence; (2) missing interaction
and scroll behavior with regression tests. Keep each commit cohesive. Reverting these UI commits
should restore previous behavior without a data migration; retain the existing pin storage format.

Core completion requires all core acceptance checks, matching before/after images, test results and
a short list of any remaining issues. Update this plan's status and checkboxes only with actual
implementation evidence. Do not deploy or begin the optional follow-ups as part of this plan.
