# Organization admin overview visual QA

- Reference: supplied Organization admin overview screenshot.
- Viewport checked: 408 × 694, including the compact mobile layout.
- Result: passed.
- Verified: green greeting banner, live summary pills, quick-action strip, grouped emoji navigation
  cards, keyboard focus treatment, and light-theme presentation.
- Mobile refinement: navigation cards use the legacy full-width row pattern with a leading icon,
  compact title/description block, and trailing arrow; the desktop grid remains unchanged.
- Data used for visual verification: typed local API mocks only; no external messages, charges, or
  hosted data were touched.
- Additional verification: the focused visual Playwright check passed. The full browser suite
  remains environment-blocked by the uninitialized local D1 schema and unrelated existing selector
  mismatches.

# New music piece Tutti track visual QA

- Reference: supplied “Tutti Practice Track (Optional)” drag-and-drop screenshot.
- Implementation state checked: the first Piece details step now exposes the drop zone for new
  pieces and movements, with click-to-browse, drag-over feedback, selected-file state, and removal.
- Result: blocked for a live authenticated screenshot.
- Verified from source and production build: the drop zone uses the existing theme tokens and
  accessible label/input pattern; no custom icon art or external assets were introduced.
- Blocker: the in-app browser could reach the local Worker, but the anonymous local session only
  rendered the unpublished public-site message. The authenticated editor requires the E2E fixture
  API mocks, which are not available through that browser session.

# Set-list public practice player visual QA

- Source visual truth: supplied mobile practice-player screenshot at
  `/var/folders/x2/hhl314r50lj4bh38lx0bvyn00000gn/T/TemporaryItems/NSIRD_screencaptureui_MMgsOQ/Screenshot 2026-07-31 at 12.32.34 PM.png`.
- Target state: 454px-wide set-list player with track pills, now-playing controls, rehearsal
  options, control guide, and set-list download actions.
- Implementation: public `/player` route with an event-scoped signed token; no live screenshot
  captured because the local Worker startup configuration and authenticated fixture session were
  unavailable in the in-app browser.
- Source review: responsive wrapping, compact cards, visible control grouping, keyboard-labeled
  controls, and Tutti fallback messaging are implemented from the supplied reference.
- Security review: public media requests are limited to files referenced by the signed event
  playlist and remain Organization-hostname bound.
- Final result: blocked for rendered screenshot comparison.

# Seating hover zoom visual QA — 2026-10-04

- Scope: implement the approved seat-shaped hover effect in the existing application. Enlarge the
  center seat by 1.7 and immediate horizontal neighbors by 1.15, keeping layout and drop targets
  fixed.
- Source visual truth:
  `/Users/wesosborn/.codex/generated_images/01a1069f-1b1a-74a2-bde5-6689273916d1/exec-538d8458-d991-46be-99b6-ebdb1b560ac2.png`
  (1672 × 941 pixels). This is an interaction reference, not authorization to redesign the page.
- Implementation full view:
  `test-results/auth.seating-seat-shaped-z-2641d-s-or-blocking-seat-controls-chromium/seat-shaped-zoom.png`
  (1280 × 1242 full-page pixels; 1280 × 720 CSS viewport, density 1).
- Focused desktop comparison:
  `test-results/auth.seating-seat-shaped-z-2641d-s-or-blocking-seat-controls-chromium/seat-shaped-zoom-canvas.png`
  (960 × 534 pixels, density 1). Compared the three highlighted seats against the same region in the
  source, using relative scale and fixed seat centers rather than whole-page pixel equality.
- Focused mobile comparison:
  `test-results/auth.seating-seat-shaped-z-2641d-s-or-blocking-seat-controls-mobile-chromium/seat-shaped-zoom-canvas.png`
  (1019 × 1129 pixels; Pixel 7 viewport 393 × 727 CSS pixels, density 2.75). Judged at CSS scale;
  mobile has horizontal chart scrolling and starts in read-only mode.
- State: Row 2 Seat 5 (Ashley Cooper) magnified, Katherine Brown and Jordan Miles subtly magnified
  on either side. Light-theme screenshots provide the direct source comparison; the browser suite
  also checks dark theme, keyboard focus, Escape dismissal, fullscreen editing and print.

**Findings and comparison history**

- Initial center width obscured too much of neighboring names. Removed the extra minimum visual
  width so center magnification preserves the seat's width; final screenshots show both neighbors'
  initials and voice parts clearly.
- Initial remove button overlapped the enlarged seat label. Moved it just outside the visual corner;
  final editing tests verify that it opens the assignment-clear confirmation and Cancel preserves
  the assignment.
- Full names can wrap and grow the visual surface vertically. The outer seat and every other grid
  cell retain their exact resting bounds; browser assertions enforce that contract.
- No remaining actionable P0/P1/P2 findings for the requested interaction.

**Required fidelity surfaces**

- Typography: retained app fonts and weights; full name replaces initials only on the central seat.
  Two-line names are intentional on narrow seats. Neighbor initials remain readable.
- Spacing/layout: center and neighbor surfaces scale over their original centers. No grid tracks,
  seat bounds, row spacing, or drag/drop bounds change during magnification. Scroll padding reserves
  space for lens edges. Existing front/back row ordering is retained.
- Colors/tokens: retained light/dark theme tokens, assigned-seat tint, modest rounded corners and
  orange center outline. Existing name and voice-part colors take precedence over illustrative
  differences in the mockup.
- Assets: existing UI assets retained; magnification is actual interactive HTML content, not a
  raster screenshot. No new illustration, logo, icon, or runtime image asset was needed.
- Copy: full display name, seat label and voice part remain real chart data. Existing editing
  controls, empty states and accessible full-name labels are preserved.

**Verification and implementation checklist**

- Passed all 14 seating browser tests across desktop and mobile Chromium and all 36 focused seating
  UI tests. Passed affected ESLint, formatting, TypeScript/web build, parity validation and parity
  implementation audit. Build output retained route splitting and emitted no bundle-size warning.
- Browser screenshots and local web assets are regenerated by the focused Playwright suite and
  `npm run build -w @choir/web`, respectively; neither is a committed runtime design asset.
- Backend integration, full `check:ci` and `check:release` were skipped: this is a scoped frontend
  change with no routes, contracts, persistence, Worker changes, push or deployment.
- No migrations, tenant-data changes or external effects. Rollback is a frontend code revert.
  Deliberate visual overlap is part of the approved design. Surface pointer handling preserves the
  underlying seat hit targets, and magnification is suppressed while a drag is active.
- Hover updates occur on seat-entry changes, not each pointer-move frame; grid layout stays fixed.
- No animation is introduced; reduced-motion and print checks pass.

final result: passed

# Seating zoom calibration and mismatch-name repair — 2026-10-04

- Current calibration: center 1.5× (previously 1.7×), horizontal neighbors 1.08× (previously 1.15×).
- User evidence:
  `/var/folders/v0/skhm36qx07zgfydxw0_vcwb00000gn/T/codex-clipboard-775d46c1-c0f2-4e33-8c8f-868c734f105a.png`.
- Root cause: fixed-height flex seats squeezed the name when suggestion, voice part and mismatch
  warning competed for vertical space. Seat text now retains its height, uses compact line spacing,
  and mismatch rows reserve 7rem at rest. Their layout stays unchanged through hover/focus.
- Surface sizing includes the existing 1px borders, so visual magnification matches the stated
  scales precisely. Printing retains its existing content-driven layout.
- Regression evidence:
  `test-results/auth.seating-mismatch-seat-9cd76-est-and-as-either-lens-seat-chromium/mismatch-neighbor-light.png`
  and corresponding dark/mobile screenshots. Inspected the full name and mismatch warning together
  at rest, as the center lens and as a neighboring lens. Wide desktop viewport: 1536 × 960 CSS px;
  mobile: Pixel 7. No vertical clipping remains in these states.
- Passed 16 desktop/mobile seating browser tests, then both mismatch regression tests again with
  full names explicitly visible on the wider desktop chart. Passed ESLint, formatting, diff checks
  and the TypeScript/web production build, with no bundle-size warning.
- An intermediate run hit a page-load timeout before the mobile seating screen appeared; the
  unchanged test passed on the full-suite rerun. No assertions or timeouts were weakened.
- Local assets and screenshots were regenerated using the web build and focused Playwright commands.
  Full CI/release and backend integration were skipped because this change affects only seat styling
  and browser regression evidence, with no backend changes, push or promotion. Parity gates were not
  rerun because neither routes nor the parity ledger changed.
- No migration, tenant-storage or external-effect changes. Rollback is a styling/test code revert.
  Expected visual impact: mismatch rows have extra baseline height for the warning. No new animation
  or recurring work was added; keyboard, print and stationary grid checks continue to pass.

final result: passed

# Full-name reveal for initials-only seats — 2026-10-04

- The hovered or keyboard-focused seat reveals its complete display name and returns to initials
  when magnification ends. Its visual surface has a 7rem minimum width so dense rows wrap names
  readably instead of breaking them into tiny fragments. The outer seat bounds remain fixed.
- Immediate neighbors retain their existing name presentation and gentle 1.08× scale; the center
  retains 1.5×. An exploratory three-name reveal crowded narrow rows and was not retained.
- Added desktop/mobile browser regression evidence for a long name in a 16-seat row, readable width,
  unclipped text, stationary seat bounds, and restoration of initials. Inspected both final
  `hover-full-names.png` screenshots. Existing keyboard, theme, print, mismatch and control checks
  remain covered. All 18 seating browser tests passed, as did affected ESLint and the web build
  (including TypeScript); no bundle-size warnings were emitted.
- Screenshots are regenerated by the focused Playwright suite; local web assets by
  `npm run build -w @choir/web`. No new committed runtime assets were added.
- Full CI, release qualification and backend integration were skipped for this scoped frontend fix
  with no push, promotion or backend change. Parity gates were not rerun because routes and the
  parity ledger are unchanged. No migration, tenant-isolation or external-effect changes. Rollback
  is a CSS/test revert. The surface may overlap nearby seats as intended by the lens design; fixed
  hit targets and entry-based updates preserve interaction and performance.

final result: passed
