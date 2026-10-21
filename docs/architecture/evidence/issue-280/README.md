# Issue 280 visual evidence

Starting source: `e53721b`, exported into `/tmp/choir-280-baseline` with `git archive` (the working
checkout was preserved). The same deterministic `organization-feature-visual.spec.ts` ran against
baseline and feature builds, using the same Chromium installation and mocked APIs, fixed time, all
modules enabled, and matching desktop/Pixel 7 projects. Actual viewport overflow is asserted.

All six before/after PNG pairs were byte-identical: zero changed pixels. Compact lossless WebP
copies of those matching captures are committed here; screenshots are also attached by Playwright.

| Capture                                         | Pixels      | Identical before/after PNG SHA-256                                 |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| [Desktop light](desktop-overview-light.webp)    | 1280 × 1651 | `69ce6251b117920385e8af9d9f08c774f5f98ad5a6d0891428ce065c7e4d12bb` |
| [Desktop dark](desktop-overview-dark.webp)      | 1280 × 1653 | `e3ffb44b16f408d7932ab91e3c367f78268035c5ae0bf7c331b97926e734fe38` |
| [Mobile light](mobile-overview-light.webp)      | 1082 × 7266 | `c10bd56c9b623f6ca547a8fdbb596fd4c5e862668abb256c2677748a5b9df6a6` |
| [Mobile dark](mobile-overview-dark.webp)        | 1082 × 7271 | `a010bb4a342761dd4076bcd58c7794eff04d6d92d6384c39b68a1bc038e98e42` |
| [Mobile drawer light](mobile-drawer-light.webp) | 1082 × 7266 | `93e8ffa1f83dad23ec58a5aa64fdc4cf996cf68c78ab965a20b450e4854a9c5a` |
| [Mobile drawer dark](mobile-drawer-dark.webp)   | 1082 × 7271 | `ccb236b22ab810dc07551efa977d96e8ea74a474764cca61121f89026c37b06b` |

Regenerate feature captures with:

```sh
npm run test:e2e -- organization-feature-visual.spec.ts
```

Playwright writes original PNGs and attachments under ignored `test-results/`. The original source
baseline uses the same spec copied to its exported checkout and a local preview on port 4174. The
screenshots preserve the greeting, KPI banner, full search trigger, five actions, 18 cards, 25
sidebar links, current grouping, glyphs, tones and branding. Missing dashboard cards and sidebar
redesign remain outside this issue.
