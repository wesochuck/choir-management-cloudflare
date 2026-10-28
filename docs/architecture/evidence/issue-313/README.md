# Issue 313 visual evidence

## Outcome

Attendance event selector truncation and removal of explainer paragraph:

1. The visible explainer paragraph
   (`Tap a name to cycle Pending, Present, and Absent. Changes save immediately.`) has been removed
   entirely without an empty paragraph element or leftover vertical gap.
2. The closed event selector strictly remains on one single line at all supported viewport widths
   (including mobile breakpoints 320, 375, 390, and 430 CSS px as well as tablet and desktop
   viewports). Long selected event text truncates with an ellipsis.
3. Full event title, date, and location remain fully accessible through the native control's `title`
   attribute, `aria-label`, and the option elements in the picker popup/sheet.

## Captures

Deliberately long event title:
`2026 Christmas & New Year Holiday Masterworks Mega Gala Concert Rehearsal with Combined Symphony and Special Guest Soloists · Dec 20, 2026, 2:00 PM · Sanctuary Main Hall, North Campus Education Wing Room 101, Building B`

| State                 | Light                                  | Dark                                 |
| --------------------- | -------------------------------------- | ------------------------------------ |
| Mobile (390 CSS px)   | [Light](mobile-attendance-light.webp)  | [Dark](mobile-attendance-dark.webp)  |
| Desktop (1280 CSS px) | [Light](desktop-attendance-light.webp) | [Dark](desktop-attendance-dark.webp) |

## Verification

Regenerate PNGs and attachments using:

```sh
npx playwright test apps/web/e2e/auth.attendance.spec.ts -g "keeps a long selected event"
```

Original PNGs live under gitignored `test-results/`. Lossless WebP conversion without resizing is
performed via Sharp.
