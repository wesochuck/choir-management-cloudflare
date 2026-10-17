# ADR 0056: Public links and configurable page names

Status: Accepted

Organizations can customize the navigation label and page heading independently for Performances,
History, Tickets, Donate, and Auditions. Empty overrides retain existing defaults, including
Auditions. Public paths and signed-link parameters do not change. These settings use the existing
Organization website draft, save snapshot, and explicit publication flow. Migration 117 adds one
JSON column with an empty-object default. Older projections omit these optional settings safely.
Older clients may reset overrides when saving website settings without the new field.

Website and event public-details editors use the shared Markdown link dialog. It accepts a display
label, a safe destination, and an open-in-new-tab choice, and can edit or remove a link containing
the text cursor. An explicit tab choice is stored as `[label](url){target="_blank"}` or
`[label](url){target="_self"}`; legacy Markdown links retain their existing new-tab behavior. Only
those two target values are recognized. No arbitrary attributes or raw HTML are executed. HTTP(S),
mailto, root-relative paths, and fragment destinations are allowed; protocol-relative URLs, control
characters, backslashes, and executable schemes are rejected. Plain HTTP(S) and mailto URLs also
render as links. Public copy links are bold and underlined, with keyboard focus styling.

Performance public details are rendered with the same safe copy component on ticket detail pages, as
well as public performance cards. Existing card purchase overlays preserve independent links. No
endpoints, external provider calls, or indexes are added. Rollback leaves migration 117 in place;
older binaries ignore custom names and may display explicit target markers as text until upgraded.
