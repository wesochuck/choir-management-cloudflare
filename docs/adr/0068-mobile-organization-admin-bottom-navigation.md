# ADR 0068: Mobile Organization Admin bottom navigation and modal sheets

Status: Accepted

## Context

On mobile phone viewports (<=48rem / 768px), Organization Admin previously rendered a persistent
4.25rem icon rail on the left side of the screen. This compressed operational tables, cards,
editors, and dashboards into narrow widths. Navigation across secondary and tertiary administrative
destinations required expanding a drawer or tapping small icon controls.

## Decision

Reclaim the full screen width on phone viewports (<=48rem / 768px) for Organization Admin by
eliminating the persistent 4.25rem rail and left column allocation. Replace the rail with a
bottom-anchored navigation bar presenting four primary controls: Home, People, Events, and More.

1. **Touch Targets and Accessibility:** Bottom controls meet minimum 44x44px touch targets. Group
   buttons advertise dialog popups (`aria-haspopup="dialog"`, `aria-expanded`). Visual selection
   reflects current section with `data-active="true"`; `aria-current="page"` is reserved strictly
   for specific destination links.
2. **Guarded Navigation:** Tapping Home routes directly to `/admin` using guarded navigation
   (`navigate(href)`). Tapping any destination within a modal sheet closes the sheet only when
   navigation succeeds without unsaved-change cancellation.
3. **Modal Sheets and Modal Interaction Boundary:** Tapping People or Events opens labeled bottom
   modal sheets containing that category's destination links. Tapping More displays secondary
   categories (Music & content, Communications, Finance, Insights & settings) and global Quick
   search; selecting a category transitions to its destination links with a Back button. Bottom
   navigation controls remain interactive while a sheet is open by rendering them within the sheet's
   modal boundary footer, avoiding inert backdrop interference and maintaining Radix focus
   containment.
4. **Layout Protection:** Main content padding allocates
   `calc(4.5rem + env(safe-area-inset-bottom, 0px))` bottom spacing to prevent the closed bottom bar
   from occluding scrollable content. Floating save bars and action drawers adjust their bottom
   positioning accordingly.
5. **Scope & Stability:** Desktop expanded, compact, and pinned navigation behaviors remain
   completely unchanged. Member, Platform, and Account workspaces remain unaffected.

## Consequences

Administrative features gain full content width on phone viewports without horizontal crowding.
Navigation destinations are easily accessible with single-hand bottom gestures. No database
migrations, Worker storage changes, or external provider configurations are required. Rolling back
restores the 4.25rem mobile sidebar rail.
