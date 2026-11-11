# Mobile Set List option 3 design QA — November 7, 2026

final result: passed

Selected source:
`/Users/wesosborn/.codex/generated_images/01a1b77a-51d7-7bf2-b74d-1c13d2dbbd93/exec-34021187-cec7-4ab3-be1f-9390887edb74.png`.
Implementation captures: `/private/tmp/choir-set-list-dark.png` and
`/private/tmp/choir-set-list-light.png`. Side-by-side visual review:
`/private/tmp/choir-set-list-comparison.png`. Both reference and implementation were opened and
compared at 390 pixels wide. The implementation viewport is 390 × 844 CSS pixels; the reference is a
cropped concept, with no specified device viewport. State: three songs, first song active, its
options expanded and its recording saved offline. The other recordings remain streamable in the
fixture.

The content-height bottom sheet, orange active-row edge, full-width titles, compact metadata,
separate playback and disclosure controls, and explicit offline removal label follow option 3. The
requested per-song part picker is included inside the expanded options. It retains the existing
persistent pin and Follow default behavior. Existing typography, surface tokens and picker are
reused; there are no new raster assets. The expanded row is taller than the concept to accommodate
this requested picker and accessible control sizes. The real player behind the sheet also retains
its existing artwork and layout.

Findings resolved:

- Grid tracks previously stretched the rows to fill the screen. Rows now size to their content, and
  the sheet has a bounded scrolling region for longer lists.
- Track badges crowded song titles. Part and offline metadata now sit below the title; disclosure
  actions remain separate from playback.
- The original selected-row colors failed light-theme contrast checks. Active-row secondary text now
  uses the main text token. Both themes have zero serious or critical axe findings in the sheet.
- Remove now reads Remove offline copy, preserving its existing callback.
- Theme-transition animations are allowed to finish before accessibility scans and screenshots,
  avoiding captures of transitional foreground/background colors.

Validation: 21 player browser tests passed; one desktop-only project skip is intentional for the
mobile geometry test. The long-list case covers widths 320, 375, 390 and 430, active-track
auto-reveal, no horizontal overflow and playback selection. The new flow checks independent song
pins, returning to Follow default, unchanged active playback, the correct download URL, saving valid
fixture audio, offline removal availability, both themes, Escape and trigger focus restoration. 32
player/Sheet component tests passed. Web typecheck, focused ESLint, spacing, control alignment and
no-eyebrows checks passed. No remaining actionable P0/P1/P2 findings. P3: optional download icon
treatment can be considered separately; the existing labeled button remains usable. This is local
verification, not a release qualification or deployment.

# Mobile workspace chooser design QA — November 7, 2026

final result: passed

Source visual:
`/Users/wesosborn/.codex/generated_images/01a1b77a-51d7-7bf2-b74d-1c13d2dbbd93/exec-3f881811-96f2-4bfe-b90a-a55632180bee.png`.
Implementation: `/private/tmp/choir-mobile-workspace-more-dark.png` and
`/private/tmp/choir-mobile-workspace-more-light.png`. Full-view comparison:
`/private/tmp/choir-workspace-comparison.png`.

The source is 852 × 1846 pixels, normalized to 390 pixels wide. Implementation screenshots are 390 ×
844 pixels at a 390 × 844 CSS viewport with deviceScaleFactor 1. State: Organization Admin selected,
More open, all three authorized workspace choices visible. The fixture brand and background page
differ from the mock; the comparison targets the menu and header controls.

Findings and fixes:

- Initial light-theme selected-row description had insufficient contrast. The selected row now uses
  the existing main text color; both light and dark axe scans have zero serious/critical findings in
  the new menu.
- Initial longer Member menu exceeded its usable height at CSS zoom. Percentage height limits, a
  nonshrinking header/footer and a scrollable body keep Close and bottom controls reachable.
  Existing landscape, small-screen and 200% zoom checks pass. Resources remain reachable by
  scrolling.
- Escape now explicitly restores focus to the originating Admin bottom-navigation control. Member
  dismissal also restores the prior page scroll, limited to the same page so navigation is not
  scrolled back to an earlier destination's position.
- Initial chooser heading inherited a serif face. It now explicitly uses the app's sans-serif token.
  The final combined comparison confirms the corrected heading, full labels and selected marker.
- No remaining actionable P0/P1/P2 menu findings. The real menu retains its existing Finance,
  Insights & settings and Quick search entries rather than removing destinations to match the mock's
  shorter illustrative list. Consequently, the real sheet is taller and its body scrolls.

Fidelity surfaces: existing sans-serif fonts, weight/size tokens, readable wrapping descriptions,
full-width rows, muted separators, light/dark palette and selection tint match the chosen direction.
Existing Organization feature icons and current-selection check are reused; no raster assets or
dependencies were added. The app's actual workspace names and destination labels remain intact. The
full-width comparison makes labels, spacing and contrast legible; no additional crops were needed.
Remaining polish: the mock's generic person icon is represented by the existing Member icon.

Behavior checked: Admin → Member → Account → Admin; current-selection no-op; unavailable Admin
choices absent; Account fallback More entry; desktop native selector; resizing out of a modal;
Escape/focus, scroll preservation and unsaved-change cancellation. Only the existing authorized
workspace list and guarded switch handler are used. No authorization, backend, schema or provider
behavior changed.

Validation: full UI suite (1,201 tests), 34 related desktop/mobile browser tests, web typecheck,
changed-file lint and web builds passed. New browser checks reject external requests, page errors,
unexpected API calls, broken images and normal-size horizontal overflow. Full release qualification
and manual screen-reader testing remain outside this local implementation.

## Earlier design QA

# Notification inbox design QA — November 7, 2026

final result: passed

Selected visual: third displayed design,
`/Users/wesosborn/.codex/generated_images/01a1b77a-51d7-7bf2-b74d-1c13d2dbbd93/exec-64245bf1-78ce-4e65-86df-17cbdd945b27.png`.
Rendered evidence: `/private/tmp/choir-notifications-mobile-dark.png` and
`/private/tmp/choir-notifications-mobile-light.png`. Combined comparison:
`/private/tmp/notification-design-comparison.png`.

The source is 984 × 1599 pixels. Mobile Chromium uses the Pixel 7 viewport (412 × 839 CSS pixels,
device scale factor 2.625); the full-page implementation capture is 1082 × 2349 pixels. Both images
were normalized to 393 pixels wide for the combined comparison. The implementation scrolls; its
full-page height is not the viewport height. State: first notification expanded, second collapsed,
all notifications selected, read notifications. The test also opens and closes the second row with
Enter and Space and selects a category through the native selector.

Findings and comparison history:

- Initial rendered capture exposed a duplicate Notifications heading from the shell and page. Fixed
  by letting this route own its heading, matching other independently headed pages.
- Initial capture exposed extra content inset from a nested main element. Replaced it with a
  labelled section, preserving one main landmark and restoring usable width.
- Initial View record action stretched across its row. Scoped its width and alignment to retain the
  mock's left-aligned action. The final combined comparison confirms those fixes.
- No remaining actionable P0/P1/P2 findings in the notification content. The mock's global header
  and bottom navigation are reference context; the existing shell is preserved. The test account
  workspace uses the fixture brand and has no Organization bottom navigation. This is an expected
  fixture/state difference, not a navigation change. The separately reported mobile workspace
  switcher remains outside this implementation.

Required fidelity surfaces:

- Typography: existing Inter/system stack and shared size/weight tokens; full wrapping titles and
  1rem body text. The deliberately longer second fixture title verifies wrapping without ellipsis.
- Spacing: flat list, dividers, icon gutter, metadata above title, readable open details and
  separate count/pagination. Larger real content remains scrollable rather than clipped to the mock
  frame.
- Colors: existing light/dark tokens and native selector; zero serious/critical axe findings in the
  changed region in either theme.
- Assets: existing Organization feature icons and shell brand; no generated replacement assets.
- Copy: short subtitle and category selector match the chosen direction. Real notification titles,
  descriptions, destinations and read-state actions remain sourced from the existing API.

The same combined image makes the selector, title wrapping and action alignment readable at normal
scale, so separate cropped evidence was not needed. Focused desktop/mobile browser tests also verify
no horizontal overflow, page errors, external requests or broken images, and exactly one h1. Fifteen
notification component tests, web typecheck and changed-file lint passed. Screen-reader testing and
full release qualification were not performed for this local implementation.

## Earlier design QA

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

# Communications Overview design QA

final result: passed

## Comparison evidence

- Reference: approved Communications landing-page concept,
  `/Users/wesosborn/.codex/generated_images/01a1c8d7-a111-7243-b87b-948b53c7256b/exec-88f76c2f-ec73-4814-a3cf-44d131836564.png`
  (1487 × 1058).
- Implementation: authenticated local application at `/admin/communications`, using deterministic
  fictional browser-test records. No production data or real delivery was used.
- Desktop viewport: 1807 × 1058 CSS pixels, scale factor 1. The existing sidebar and shell leave a
  1487-pixel-wide Communications surface. The content-only capture is 1487 × 910; its shorter height
  reflects fewer fixture rows than the concept.
- Mobile viewport: Pixel 7, 393 × 851 CSS pixels, scale factor 2.75. Full-page captures contain
  fixed navigation at its viewport position; separate scrolled viewport captures verify the middle
  and bottom sections remain readable and reachable.
- Dark reference and rendered surface were opened together in
  `/tmp/communications-overview-comparison-final.png`. Desktop light/dark and mobile captures were
  inspected separately, including the scrolled mobile Recent messages and Automatic messages
  regions.
- Retained evidence:
  `/Users/wesosborn/.codex/visualizations/2026/11/11/01a1c8d7-a111-7243-b87b-948b53c7256b/communications-overview-{dark,light,mobile,comparison,mobile-middle,mobile-bottom}.png`.

## Findings and corrections

1. **P2, resolved: excessive sidebar height.** Initial automatic-message rows placed every
   owning-settings action beneath its description. Inline actions and smaller row gaps restore the
   compact directory and Coming up panel. Final desktop and mobile captures show readable wrapping
   without horizontal overflow.
2. **P2, resolved: draft-count hierarchy.** The shared help-text style initially broke the exact
   draft count onto a separate line. It now stays inline with the heading, at the shared small-text
   size. Counts are omitted when the capped result cannot establish an exact total.
3. **P1, resolved: mobile composer controls.** Registering the composer with the existing
   unsaved-change coordinator introduced a second floating Save draft bar over the existing composer
   actions. The composer retains its own persistent save controls and navigation protection; the
   duplicate bar is hidden in this workspace and the composer actions clear the mobile bottom
   navigation. Desktop/mobile send and draft-resume tests verify the correction.

No unresolved P0, P1, or P2 design findings remain.

## Fidelity and behavior review

- **Typography:** existing application font family, heading hierarchy, weights, and type tokens are
  retained. The generated concept uses larger display text; adopting the repository's existing
  heading scale is intentional. Subjects and actionable labels remain readable when wrapped.
- **Spacing/layout:** Overview, Messages, Automations, Templates, and Settings navigation; prominent
  header action; quiet delivery-status strip; compact divided rows; and the main/sidebar hierarchy
  follow the concept. Mobile order is delivery status, drafts, recent messages, coming up, then the
  directory. There are no KPI tiles or repeated large history cards.
- **Colors/tokens:** existing navy/slate dark surfaces, light surfaces, orange selected navigation,
  blue actions, and semantic delivery-status colors are retained. Automated Axe checks report no
  violations within Communications in either theme; overflow checks pass at both viewport sizes.
  Theme transitions are disabled during measurement.
- **Assets:** this screen requires no new illustration or raster asset. Existing application
  identity and shared UI primitives remain in use. The concept's decorative mail/check/chevron icons
  are replaced by explicit accessible action/status labels; no new icon drawing system was
  introduced.
- **Copy/content:** approved introductory copy is used. Recorded automatic sends, partial failures,
  potentially delayed claims, real scheduled items, and projected previews have distinct labels.
  Recipient eligibility is explained once beneath Coming up. The existing local simulated-delivery
  banner remains visible so recorded test sends are understood correctly. Fictional example
  subjects/counts are not copied into application defaults.
- **Interaction:** tested default and legacy navigation, bookmarkable status/type filters,
  Back/Forward, keyboard section activation, owning-settings links, delivery details, draft
  create/save/resume, cancel/discard protection, focus refresh, retryable errors, and existing
  notification cancellation. Failure states do not fabricate healthy or empty sections.

## Regeneration and implementation checklist

- Run `npm run test:e2e -- communications.spec.ts` to regenerate screenshots under
  `/tmp/communications-overview-*` and exercise desktop/mobile behavior.
- Use the content-only desktop dark capture beside the approved image for composition review;
  inspect mobile viewport captures for fixed-navigation clearance.
- Screenshot files are review artifacts, not runtime assets. The production application renders
  HTML/CSS and shared components.
- Overview reads remain Organization-local, bounded, and side-effect free. Migration 142 adds only
  query indexes and is compatible with older application code. Existing notification cleanup
  migration and mutation behavior are preserved.
- Full release qualification is intentionally separate from this local implementation; no push or
  deployment is included.

The scheduler attention index uses immutable job-kind/job-ID fields. An index on mutable status or
claim timestamps changed Cloudflare billed-write counts and broke the older job handlers' success
checks. The immutable index preserves that rollback contract; status and age remain residual filters
within the three scheduler-kind partitions. The existing job-ledger write-accounting, queue replay,
retry, event-reminder snapshot, and scheduler tests pass without weakening their assertions.
