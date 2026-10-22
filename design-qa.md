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
