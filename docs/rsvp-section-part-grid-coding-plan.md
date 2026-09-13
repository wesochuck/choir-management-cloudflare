# Roster and RSVP Section-to-Part Grid Alignment Coding Plan

## Goal

Update both **Roster → Part balance** and **Event RSVPs → Part RSVP balance** so the section cards
above the part cards stretch or contract to match the exact width of the parts that belong to each
section.

The same visual rule must apply in both places.

For example:

```text
2 + 2 configuration

|             TENORS             |             BASSES             |
|       T1       |       T2       |       B1       |       B2       |
```

For an uneven configuration:

```text
1 + 3 configuration

|   TENORS   |                     BASSES                     |
|     T1     |     B1     |     B2     |     B3     |
```

The core layout rule is:

```text
part = one equal-width grid track
section width = number of child part tracks
```

Do not calculate section widths using arbitrary percentages or counts. The layout must come from the
configured section-to-part relationships.

---

## 1. Address Both Existing Surfaces in the Same Change

The same balance UI pattern currently exists in two places.

### Roster

The Roster page renders `VoicePartBalance` from:

```text
apps/web/src/account/components/RosterPage/shared.tsx
```

`RosterPage/view.tsx` mounts that component on the main Roster tab.

`VoicePartBalance` currently renders:

```text
roster-balance__sections
roster-balance__parts
```

as two separate rows.

### Event RSVPs

The RSVP page renders its balance controls in:

```text
apps/web/src/account/components/RsvpManager/components/RsvpManagerFilters.tsx
```

It also renders:

```text
roster-balance__sections
roster-balance__parts
```

as two separate rows.

### Shared styling

Both surfaces use the balance styles in:

```text
apps/web/src/styles/components/signed-in-workspace.css
```

The current CSS sizes the two rows independently:

```css
.roster-balance__sections {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.roster-balance__parts {
  grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr));
}
```

That independent sizing is the root problem.

The change should fix the shared layout model once and apply it consistently to both Roster and
RSVP.

---

## 2. Keep the Change Tightly Scoped

Expected files:

```text
apps/web/src/account/rosterBalanceLayout.ts
apps/web/src/account/rosterBalanceLayout.test.ts

apps/web/src/account/components/RosterPage/shared.tsx

apps/web/src/account/components/RsvpManager/components/
  RsvpManagerFilters.tsx

apps/web/src/styles/components/
  signed-in-workspace.css

existing Roster and RSVP component/browser tests
```

Potential test files may vary based on the repository's existing E2E organization.

No changes should be required to:

```text
packages/contracts
apps/worker
D1
Durable Object schemas
Roster APIs
RSVP APIs
roster persistence
RSVP persistence
roster configuration semantics
RSVP count calculations
Roster filtering business rules
RSVP filtering business rules
Seating behavior
```

This should remain a contained UI/layout change.

---

## 3. Use One Shared Pure Layout Helper

Because both Roster and RSVP need the same section-to-part geometry, do not create an RSVP-only
helper.

Create a shared helper such as:

```text
apps/web/src/account/rosterBalanceLayout.ts
```

The helper should be pure and contain no React state, API calls, counts, or filtering behavior.

Its responsibility is only to convert an already-reportable list of sections and parts into a layout
model.

Conceptually:

```ts
type RosterSection = OrganizationRosterConfiguration["sections"][number];

type RosterVoicePart = OrganizationRosterConfiguration["voiceParts"][number];

interface RosterBalanceSectionGroup {
  readonly section: RosterSection;
  readonly parts: readonly RosterVoicePart[];
  readonly span: number;
}

interface RosterBalanceLayout {
  readonly sections: readonly RosterBalanceSectionGroup[];
  readonly orderedParts: readonly RosterVoicePart[];
  readonly columnCount: number;
  readonly valid: boolean;
}
```

A function might look conceptually like:

```ts
buildRosterBalanceLayout(sections, voiceParts);
```

The helper should receive the visible/reportable sections and parts from the caller rather than
taking over unrelated product filtering logic.

That keeps the existing Roster and RSVP `reportableSections()` / `reportableVoiceParts()` behavior
intact.

---

## 4. Preserve the Existing Reportable-Item Rules

Both Roster and RSVP already exclude track-only sections and the parts that belong to those
sections.

Do not change those rules as part of this work.

### Roster currently uses

```text
apps/web/src/account/components/RosterPage/utils.ts
```

with:

```ts
reportableSections(configuration);
reportableVoiceParts(configuration);
```

### RSVP currently uses

```text
apps/web/src/account/components/RsvpManager/historyUtils.tsx
```

with equivalent reportable-section and reportable-part behavior.

Each surface should continue calling its existing helpers and then pass those results into the new
shared layout helper.

This prevents a visual change from silently changing what is considered reportable.

---

## 5. Group Parts by Section Efficiently

Inside the shared layout helper, build a map from section code to the parts assigned to it.

Conceptually:

```ts
const partsBySection = new Map<string, RosterVoicePart[]>();

for (const section of sections) {
  partsBySection.set(section.code, []);
}

for (const part of voiceParts) {
  const sectionParts = partsBySection.get(part.sectionCode);

  if (sectionParts) {
    sectionParts.push(part);
  }
}
```

Then build the section groups in section configuration order.

Avoid repeatedly running:

```ts
sections.map((section) => voiceParts.filter((part) => part.sectionCode === section.code));
```

The repository explicitly prefers precomputed `Map` or `Set` lookups over avoidable nested linear
scans.

Do not use `any`.

---

## 6. Make Section Order Authoritative

Preserve the configured section order.

Within each section, preserve the configured voice-part order.

For example, if configuration data happens to contain:

```text
Sections:
Tenors
Basses

Parts:
T1
B1
T2
B2
```

the balance display should render:

```text
T1 T2 B1 B2
```

because parts need to appear directly beneath their owning section.

The shared helper should therefore build `orderedParts` by flattening the section groups:

```text
section 1 parts
then section 2 parts
then section 3 parts
...
```

This rule must be applied in both Roster and RSVP so the two surfaces cannot drift apart.

---

## 7. Calculate One Shared Column Count

The helper should return:

```ts
columnCount = orderedParts.length;
```

Examples:

```text
T1 + T2 + B1 + B2 = 4 columns
```

```text
T1 + B1 + B2 + B3 = 4 columns
```

```text
S1 + S2 + A1 + A2 + T1 + T2 + B1 + B2 = 8 columns
```

Every visible part occupies exactly one equal-width desktop grid column.

This count is layout metadata only. It has nothing to do with how many singers or RSVP responses are
in each part.

---

## 8. Calculate Each Section Span

For every section group:

```text
span = number of visible parts assigned to the section
```

Examples:

```text
Tenors: T1, T2
span = 2

Basses: B1, B2
span = 2
```

and:

```text
Tenors: T1
span = 1

Basses: B1, B2, B3
span = 3
```

For every normal valid layout:

```ts
sum(section.span) === columnCount;
```

Add this as a tested invariant.

---

## 9. Use Generic Shared CSS Custom Properties

Because the same CSS is used by Roster and RSVP, use generic variable names rather than
RSVP-specific names.

Recommended:

```css
--roster-balance-columns
--roster-balance-section-span
```

Do not use names such as:

```css
--rsvp-balance-columns
```

because the Roster page now needs the same behavior.

---

## 10. Add a Shared Assignment-Layout Wrapper to Both Surfaces

Wrap the section and part rows in a shared layout container.

Conceptually:

```tsx
<div className="roster-balance__assignment-layout" style={balanceGridStyle}>
  <div className="roster-balance__sections">...</div>

  <div className="roster-balance__parts">...</div>
</div>
```

Apply this in:

```text
RosterPage/shared.tsx → VoicePartBalance
```

and:

```text
RsvpManagerFilters.tsx
```

Set:

```css
--roster-balance-columns: <layout.columnCount>;
```

on the wrapper.

Use strict TypeScript.

For example:

```ts
import type { CSSProperties } from "react";

type BalanceGridStyle = CSSProperties & {
  "--roster-balance-columns": number;
};
```

If the repository's existing custom-property style convention uses strings, follow that local
convention instead.

Do not import React solely for JSX.

---

## 11. Apply Each Section's Span Through a CSS Custom Property

Each section button should receive its calculated span.

Conceptually:

```tsx
const sectionGridStyle: SectionGridStyle = {
  "--roster-balance-section-span": sectionGroup.span,
};
```

and:

```tsx
<button
  className="roster-balance__section"
  style={sectionGridStyle}
  ...
>
```

Keep the grid behavior in CSS:

```css
.roster-balance__section {
  grid-column: span var(--roster-balance-section-span);
}
```

This allows the responsive breakpoint to override the behavior cleanly.

---

## 12. Make Both Rows Use the Same Desktop Grid

Replace the independent desktop grid templates with one shared definition.

Conceptually:

```css
.roster-balance__sections,
.roster-balance__parts {
  display: grid;
  grid-template-columns: repeat(var(--roster-balance-columns), minmax(0, 1fr));
  gap: var(--spacing-sm);
}
```

Then:

```css
.roster-balance__section {
  grid-column: span var(--roster-balance-section-span);
}
```

The same gap value must be used by both rows.

That is important because a section spanning two tracks must cover:

```text
part track 1
+ the gap between parts
+ part track 2
```

so its outer edges match the exact outer edges of those two child part cards.

---

## 13. Update Roster `VoicePartBalance`

In:

```text
apps/web/src/account/components/RosterPage/shared.tsx
```

`VoicePartBalance` currently independently maps:

```ts
reportableSections(configuration);
```

and:

```ts
reportableVoiceParts(configuration);
```

Change it to:

1. Get the reportable sections.
2. Get the reportable voice parts.
3. Build the shared balance layout.
4. Render section buttons from `layout.sections`.
5. Render part buttons from `layout.orderedParts`.
6. Apply the shared column count.
7. Apply each section's span.

Do not change:

```text
counts.sections
counts.voiceParts
counts.unassigned
selectedFilters
sectionFilterKey()
voicePartFilterKey()
onToggle()
profileSectionCode()
profile counting behavior
```

The Roster page's count and filtering semantics must stay exactly the same.

The screenshot's Roster configuration should therefore change from visually behaving like:

```text
| TENORS | BASSES | empty | empty |
|   T1   |   T2   |  B1   |  B2   |
```

to:

```text
|        TENORS        |        BASSES        |
|    T1    |    T2     |    B1    |    B2    |
```

---

## 14. Update RSVP `RsvpManagerFilters`

In:

```text
apps/web/src/account/components/RsvpManager/components/
  RsvpManagerFilters.tsx
```

replace the independent section and part iteration with the same shared layout model.

Use:

```text
layout.sections
layout.orderedParts
layout.columnCount
```

Do not change:

```text
sectionCounts
voicePartCounts
assignmentFilter
toggleAssignmentFilter()
filter
view
RSVP status filtering
event selection
history behavior
```

This is a display-layout change only.

The RSVP surface and the Roster surface must now use the same geometry rules.

---

## 15. Do Not Merge the Two Balance Components Unnecessarily

The Roster and RSVP balance areas have different count sources and filter behaviors.

Do **not** turn this task into a broad component consolidation unless a very small shared
presentational primitive is clearly beneficial.

Preferred scope:

```text
share:
- pure section/part layout helper
- CSS grid behavior

keep separate:
- Roster counts
- Roster filters
- RSVP counts
- RSVP filters
- surface-specific headers and controls
```

This fixes the duplication that matters without creating a larger refactor.

---

## 16. Preserve Existing Roster Filtering Behavior

The Roster balance cards currently filter the roster by section or part.

Do not change:

```text
selectedVoiceFilters
toggleVoiceFilter
profileMatchesVoiceFilters
UNASSIGNED_VOICE_FILTER
section filter keys
part filter keys
```

Reordering the visual part cards must not change which profiles are selected by a filter.

The section-to-part relationship already exists in the roster configuration; this task only uses
that relationship for layout.

---

## 17. Preserve Existing RSVP Filtering Behavior

The RSVP balance cards currently filter the RSVP roster by configured section or voice part.

Do not change:

```text
assignmentFilter
sectionCounts
voicePartCounts
activeRows
balanceRows
visibleRows
RSVP status counts
RSVP status tabs
```

The new geometry must not affect RSVP filtering, sorting, or counts.

---

## 18. Preserve Seating Behavior

Do not change seating-chart filtering or seating behavior as part of this work.

The balance-layout helper may consume the same roster configuration types, but this task is
specifically scoped to:

```text
Roster → Part balance
Event RSVPs → Part RSVP balance
```

No seating logic should be modified.

---

## 19. Preserve Mobile Usability

Do not force four, six, eight, or more narrow part tracks onto a phone.

The repository already has a narrow-screen breakpoint around `40rem` for these balance styles.

At the existing mobile breakpoint, explicitly disable desktop section spanning.

Conceptually:

```css
@media (max-width: 40rem) {
  .roster-balance__sections {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .roster-balance__section {
    grid-column: auto;
  }

  .roster-balance__parts {
    grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr));
  }
}
```

Target behavior:

```text
desktop/tablet:
exact section-to-part alignment

mobile:
readable responsive cards
```

Apply the same responsive behavior to both Roster and RSVP automatically through the shared classes.

---

## 20. Handle Empty and Invalid Configurations Defensively

Verify whether the roster contract guarantees that every visible part references an existing visible
section.

For valid data:

```text
every displayed part belongs to a displayed section
```

For invalid or partially inconsistent data, do not silently drop parts.

Preferred fallback:

```text
valid configuration
→ aligned spanning layout

invalid section mapping
→ preserve all reportable parts
→ safe fallback layout
```

Do not invent a fake section such as `Other` unless existing product behavior defines one.

Also ensure the code never produces:

```css
repeat(0, ...)
```

or:

```css
grid-column: span 0;
```

A configuration with no reportable parts must render safely on both screens.

---

## 21. Add Shared Pure Helper Tests

Create:

```text
apps/web/src/account/rosterBalanceLayout.test.ts
```

Cover at least the following.

### Case 1: 2 + 2

```text
Sections:
Tenors
Basses

Parts:
T1
T2
B1
B2
```

Expected:

```text
columnCount = 4
Tenors span = 2
Basses span = 2
orderedParts = T1, T2, B1, B2
```

### Case 2: 1 + 3

```text
Sections:
Tenors
Basses

Parts:
T1
B1
B2
B3
```

Expected:

```text
columnCount = 4
Tenors span = 1
Basses span = 3
orderedParts = T1, B1, B2, B3
```

### Case 3: Interleaved raw part order

Input:

```text
Sections:
Tenors
Basses

Parts:
T1
B1
T2
B2
```

Expected display order:

```text
T1
T2
B1
B2
```

### Case 4: Multiple uneven sections

Use something like:

```text
2 + 3 + 1
```

Expected:

```text
all spans sum to columnCount
```

### Case 5: Zero visible parts

Expected:

```text
safe output
no invalid grid count
no invalid section span
```

### Case 6: Invalid or missing section mapping

If contracts allow it:

```text
visible part is not silently lost
layout reports/falls back safely
```

---

## 22. Add a Roster Component Regression Test

Add or extend a test around:

```text
VoicePartBalance
```

or the existing Roster page tests.

For a `2 + 2` configuration verify that the rendered output contains:

```text
Tenors
Basses
T1
T2
B1
B2
```

and that the layout metadata represents:

```text
--roster-balance-columns: 4
Tenors span: 2
Basses span: 2
```

Also verify that clicking the section and part buttons still invokes the same filters.

The test should prove that the layout change did not break Roster filtering.

---

## 23. Add an RSVP Component Regression Test

Add or extend the existing RSVP tests.

For a `2 + 2` configuration verify that the RSVP balance output contains:

```text
Tenors
Basses
T1
T2
B1
B2
```

with:

```text
--roster-balance-columns: 4
Tenors span: 2
Basses span: 2
```

Also verify that section and part button behavior still updates the same assignment filter.

The existing RSVP functionality and counts must remain unchanged.

---

## 24. Add Browser Geometry Coverage for Both Screens

The key regression is visual geometry, so at least one real browser test should inspect actual
element bounds.

Ideally verify the shared geometry on both:

```text
Roster
Event RSVPs
```

For the `2 + 2` case, measure:

```text
Tenors
Basses
T1
T2
B1
B2
```

and assert with a small 1–2 CSS pixel tolerance:

```text
Tenors.left ≈ T1.left
Tenors.right ≈ T2.right

Basses.left ≈ B1.left
Basses.right ≈ B2.right

T1.left ≈ overall balance grid left
B2.right ≈ overall balance grid right
```

Also assert:

```text
no unintended horizontal page overflow
```

The browser coverage should make it difficult for either Roster or RSVP to regress independently.

---

## 25. Test an Uneven Layout

Do not test only `2 + 2`.

A hard-coded 50/50 implementation could pass that case.

Add at least one uneven configuration:

```text
1 + 3
```

or:

```text
2 + 3 + 1
```

For example:

```text
| TENORS |                BASSES                |
|   T1   |   B1   |   B2   |   B3   |
```

Verify that the same uneven geometry works in the shared layout helper and at least one
browser/component test.

---

## 26. Preserve Accessibility

Keep the existing real button elements.

Preserve:

```text
button elements
aria-pressed
keyboard focus
focus-visible styles
selected state
existing click behavior
```

Do not replace interactive buttons with clickable `div` elements.

Do not introduce raw theme colors or arbitrary spacing values when existing tokens already cover the
need.

---

## 27. Visually Verify Both Surfaces

Check both:

```text
Roster → Part balance
Event RSVPs → Part RSVP balance
```

in at least:

```text
desktop dark theme
desktop light theme
tablet or narrow desktop
mobile at or below 40rem
```

Verify on each surface:

```text
section left edge matches the first child part
section right edge matches the last child part
all part cards have equal desktop width
the last part reaches the right edge of the grid
there is no dead space caused by unused section columns
selected-state borders do not shift dimensions
focus outlines are visible and not clipped
no unexpected wrapping occurs
mobile remains readable
no horizontal overflow appears
```

---

## 28. Run Focused Verification

During implementation, run the relevant focused checks, including:

```bash
npm run typecheck
npm run lint
```

plus:

```text
shared layout helper tests
Roster balance component tests
RSVP balance component tests
focused Playwright geometry tests
```

Because this is a visual-system change, also manually or automatically verify:

```text
light theme
dark theme
responsive layouts
focus states
keyboard interaction
```

If the change is being pushed to `main` or promoted to permanent staging, run the repository's
canonical release gate:

```bash
npm run check:release
```

Do not replace that release gate with an ad-hoc set of commands.

---

# Definition of Done

Both **Roster → Part balance** and **Event RSVPs → Part RSVP balance** must use the same
section-to-part grid geometry.

Each reportable part must occupy one equal-width desktop grid column.

Each reportable section must span exactly the columns occupied by its reportable parts.

For:

```text
T1 T2 B1 B2
```

both screens must render the equivalent of:

```text
|             TENORS             |             BASSES             |
|       T1       |       T2       |       B1       |       B2       |
```

For:

```text
T1 B1 B2 B3
```

both screens must render the equivalent of:

```text
|   TENORS   |                     BASSES                     |
|     T1     |     B1     |     B2     |     B3     |
```

The implementation must preserve:

```text
Roster counts
Roster section filtering
Roster part filtering
Roster unassigned filtering
RSVP counts
RSVP status filtering
RSVP section filtering
RSVP part filtering
button behavior
accessibility
light and dark themes
mobile usability
```

The implementation must not change:

```text
API behavior
contracts
persistence
Worker behavior
roster configuration semantics
RSVP business logic
Roster business logic
Seating behavior
```

The final layout must be driven entirely by the existing configured relationship between sections
and parts, and the Roster and RSVP implementations must share the same geometry logic so they stay
consistent over time.
