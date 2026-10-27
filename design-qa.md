# Bulk track review design QA

final result: passed

## Current annotation follow-up

The user's October 22 screenshots supersede the mock's large filename-derived heading. The current
implementation uses a compact Recording group heading, explicitly states when no Music Library piece
is selected, places search beneath that explanation without a caret, and aligns Use Tutti with Skip
this file on desktop. Missing destinations have a disabled Mark reviewed & next button rather than
another search-launching footer action. The footer explains that selecting a Music Library piece
enables review. Unmatched groups do not show Why this match. The recording filename remains next to
playback; it is never presented as a selected library title.

Current focused evidence: `ai-no-match-dark.png` in the weak-AI music-catalog test directory and
`streamlined-focused-dark.png` in the large-batch desktop/mobile directories. These captures were
inspected together after the change. Focused tests check no duplicate destination action, no search
caret, missing-destination messaging, native selector focus, and same-row recording actions. The
existing template typography and colors are retained; source instructions and the visible search
label now have matching accessible names. No new image assets are required.

## Visual target and evidence

- Source: user-approved refined split-workspace mock, generated image
  `exec-e576ba67-ed61-4bdd-8913-bd89514ad8a7.png` in this chat's generated-image directory.
- Desktop implementation:
  `test-results/music-catalog-streamlines--adc32-estination-controls-in-dark-chromium/streamlined-review-dark.png`.
- Mobile focused state:
  `test-results/music-catalog-streamlines--adc32-estination-controls-in-dark-mobile-chromium/streamlined-focused-dark.png`.
- Equivalent light-theme captures use the light test directories and filename suffixes.
- Regenerate with `npm run test:e2e -- --grep 'streamlines a large review'`.
- Desktop source and capture: 1443 × 1090 pixels, CSS viewport 1443 × 1090, DPR 1. Source and
  implementation were opened together in one comparison input.
- Mobile: CSS viewport 390 × 844, capture 1024 × 2216 at the mobile project's DPR 2.625. Mobile is a
  responsive adaptation; the source supplies no mobile design.
- State: Christmas Time is Here, song 7 of 40, destination selected, voice part missing, 12 eligible
  Tutti suggestions, AI result kept, evidence disclosure collapsed. Fixture uses 40 synthetic audio
  files rather than the mock's 41; duration is unavailable because these files intentionally do not
  contain playable audio.

## Comparison history

1. Initial capture: nested borders were removed, but an inherited global footer width let content
   peek beside the action bar. Desktop height also hid assignment controls. Fixed with a full-width
   review footer and a larger desktop bulk-import dialog.
2. Further comparison: source text was repeated above the recording, AI copy was too long, and
   inherited search-input styling recreated a nested box. Removed repetition, shortened the
   kept-result copy, restored a single search-field surface, and adjusted title hierarchy.
3. Mobile capture: desktop dialog sizing left an unnecessary side gap; three stacked footer buttons
   consumed too much space. Restored full viewport sizing for this dialog and placed secondary
   actions side by side. Post-fix captures show the focused selector, Tutti action, and file
   exclusion action above the opaque footer.

## Fidelity surfaces and interaction checks

- Typography: existing sans UI family and serif song heading retained, with the song title enlarged
  using the existing scale. Application token sizes are retained for other text.
- Layout: queue/detail split, one vertical rule, open destination/recording sections, compact Change
  piece action, inline Tutti batch action, and collapsible matching evidence match the approved
  direction. Existing Guided review/Batch overview controls remain available.
- Colors: repository light/dark semantic tokens retained. Existing state pills, selected queue tint,
  focus outlines, and danger conflict treatment remain meaningful.
- Assets: no raster artwork is required. Existing playback and native select controls are retained;
  the mock's decorative audio controls do not add new playback behavior.
- Copy: source filenames remain next to the actual player. Review requirements and manual-edit
  protection remain explicit. The ordinary kept-result explanation is shorter.
- Focused comparison: recording selector and Tutti controls were inspected in desktop and mobile
  captures; focused selectors remain above the footer. No horizontal overflow.
- Tested interactions: queue switching, destination search, keyboard evidence toggle, part choice,
  individual/batch Tutti acceptance, Undo, explicit review, and protected conflicts.
- Browser checks cover uncaught page errors and duplicate React-key errors in the large batch. These
  are UI/layout tests, not real audio codec qualification.
- No relevant print surface changed.

## Findings and follow-up

No actionable P0/P1/P2 visual findings remain. Existing component/token typography and native
controls intentionally take precedence over decorative details in the generated mock. There are no
required implementation follow-ups from this comparison.

# Tablet roster and shared tablet layouts — October 27, 2026

final result: passed

## Selected target and state

The selected target is the **second displayed mockup**, the full-width roster with drawer
navigation, compact section filters, and email beneath the name. Its source is
`exec-4fe68c98-8774-48bc-8e76-f0069a85244c.png` in this chat's generated-image directory. The first
displayed image (icon rail) and third image (expandable rows) are not the target.

The reference is 1048 × 1500 pixels, representing an approximately 834 × 1194 CSS tablet viewport.
Final WebKit captures use that CSS viewport at DPR 2 (1668 pixels wide); Chromium captures use DPR
1, and the mobile Chromium project uses DPR 2.625. Source and implementation were inspected
together, comparing layout and readable content rather than their raw pixel sizes. The roster test
exercises 820, 834, 1024, and 1180px widths in both themes.

Final captures are copied to the ignored `.wrangler/design/tablet-roster/` directory:
`roster-dark.png`, `roster-light.png`, `contacts-after.png`, `events-after.png`,
`ticketing-after.png`, and `donations-after.png`. Test-owned originals are regenerated by the
focused browser commands below. Baseline roster and Contacts captures are in
`/tmp/choir-tablet-review/` for the current local session.

Intentional differences from the illustrative mock: existing Roster Settings/Automation tabs and CSV
import/export remain available; section names/counts come from Organization configuration; fixture
branding uses an initials avatar; eight synthetic Profiles replace the mock's 64; and pagination
appears only when the real page size requires it. Name sorting uses the actual table sort behavior.
Existing typography, icons, status language, and theme tokens are retained.

## Review iterations

1. Baseline: the full sidebar consumed about a third of the portrait viewport, and unrestricted cell
   breaking reduced names to vertical letter fragments. Contacts showed the same problem.
2. First implementation: tablet drawer and combined identity cells restored readable names, but
   section filters still stacked label/count vertically. Reset their inherited flex direction.
3. Interaction and accessibility pass: preserved section/part filtering, All reset, sorting,
   selection, CSV controls, photo viewer, profile editing, and drawer focus return. Fixed the
   existing roster status-pill text contrast exposed by the new axe check.
4. Desktop regression pass: the tablet rule included exactly 1280px and hid the established desktop
   Edit action. Excluded the desktop boundary; the compact table applies only below it. Phone icon
   rails and saved desktop navigation preferences remain intact.
5. Final visual pass: names and email are readable, section chips are compact, primary Add Profile
   aligns with the heading, touch actions are usable, and tables stay inside their containers. No
   remaining P0/P1/P2 visual findings.

Required fidelity surfaces: system fonts and existing type tokens match the product; spacing uses
repository tokens; navy/blue colors retain the existing themes; supplied/generated branding is not
replaced with invented imagery; and copy uses Organization/Profile/On Break terminology. The name,
email, section controls, and row actions were inspected as readable details as well as in full view.

## Other-view scan

- **Contacts:** confirmed the same cramped name/email problem. At tablet widths, email now appears
  beneath the name; phone, email status, and actions remain visible. Lists/source/update metadata
  remain in the existing Details view and full desktop table.
- **Events:** inspected populated long-title/venue rows. Drawer navigation and whole-word table
  wrapping provide usable width without a separate redesign.
- **Ticketing and Donations:** inspected summaries, controls, and empty order/donation states.
  Shared navigation provides more room. No populated-table design claim is made for these captures.
- The responsive audit also covers member/admin dashboards, polls, seasons/dues, set lists,
  Organization/module settings, and the website editor across 390, 640, 768, 834, 900, 1024, 1180,
  and 1280px. It checks document overflow and inline-control alignment. Required roster, Events, and
  Contacts fixtures must actually load rather than passing on an error banner.

## Verification and limits

- Affected Chromium desktop/mobile suites: 91 passed, one desktop-only test skipped on mobile.
- Focused Safari/WebKit tablet tests pass in light/dark themes, including the same filtering,
  sorting, selection, editing, drawer focus, geometry, and axe assertions.
- 73 affected UI tests and 25 Contacts unit tests pass. Web build/typecheck, focused ESLint and
  formatting, spacing/control-alignment/no-eyebrow gates, and diff whitespace checks pass.
- API-mocked tablet tests block the caching service worker, matching existing mocked browser suites,
  so WebKit cannot bypass route fixtures. Offline behavior remains covered separately.
- Automated browser emulation is not a physical iPad qualification or a claim of complete WCAG
  compliance. Full release qualification/hosted probes were not run because no push or deployment is
  requested in this change.
- No routes, contracts, schema, authentication, tenant storage, or provider operations change.
  Rollback is a code revert. Shared layout impact is covered by the cross-page browser audit. Web
  build artifacts are regenerated with `npm run build --workspace @choir/web`.

Commands for current focused browser evidence:

```bash
npm run test:e2e -- apps/web/e2e/roster-profile.spec.ts apps/web/e2e/sidebar.phase3.spec.ts apps/web/e2e/organization-navigation.spec.ts apps/web/e2e/responsive.audit.spec.ts
npm run test:e2e:webkit -- apps/web/e2e/roster-profile.spec.ts --grep 'tablet roster'
```

Run browser commands sequentially: their local server setup rebuilds the same `apps/web/dist`.
