# Organization Admin feature registration

`registry.ts` is browser navigation metadata. It does not authorize access, register routes, select
an Organization, or replace the React dispatcher. Imports flow from renderers to pure selectors to
registry/types/icons; the registry never imports renderers or APIs.

To add a feature:

1. Implement its authorized route and tests through the existing dispatcher first. Add its stable ID
   to `OrganizationFeatureId` and its canonical route, explicit aliases, canonical `ModuleId` (or
   `null`), semantic icon key, label and page metadata to `organizationFeatures`.
2. Declare sidebar and dashboard group/position independently. Retain surface-specific copy and
   tones. Known terminology templates are `{performer}`, `{performers}` (lowercase plural), and
   `{parts}`. Inputs come from `normalizeOrganizationTerminology`; do not implement pluralization or
   hooks in registry records.
3. Declare a palette entry only when the feature should be searchable. Preserve existing result IDs
   for stored Recents. Link settings/subview shortcuts to a primary feature using `parentId`; verify
   the actual consuming query parameter or DOM anchor. Add dashboard quick actions using
   `featureId`, retaining the existing action URL and glyph variant.
4. Declare every omitted dashboard placement with an approved typed coverage reason and update the
   coverage test intentionally. A new primary feature cannot silently disappear from a surface.
5. Run registry/route tests, UI tests, desktop/mobile browser and accessibility checks, then the
   repository material-change gates. Capture visual evidence whenever projections change.

Current projections deliberately preserve 25 sidebar destinations, 18 Overview cards (7/6/3/2), and
five quick actions. The four deferred dashboard gaps are Contacts, Membership Invitations, Seasons &
Dues, and Reports. Overview is a landing page. Modules, Setup Checklist and Organization Security
are configuration pages. Patrons Dashboard is a contextual Donations shortcut. These are distinct
coverage reasons; configuration pages are not additional parity gaps. `practice_player` remains a
server-controlled module setting and has no Organization Admin destination.

The shell owns one reactive module catalog (`useOrganizationModuleState`) and shares it with the
Modules form. Loading/initial errors withhold module-dependent navigation. Only a successfully read
catalog defaults a missing module ID to visible. Acknowledged saves patch the catalog, invalidate
older reads and trigger one deduplicated abortable readback. Failed readbacks preserve confirmed
changes and expose retry; foreground transitions refresh once with no polling. Snapshot/terminology
state resets with the hostname/session shell key and is never stored in browser storage. Server
module labels/descriptions are retained independently of navigation labels.

Palette Recents remain stored by hostname/workspace. Eligibility is re-evaluated for registered
static shortcuts and known entity categories on each render and immediately before selection;
registered titles/URLs resolve from current metadata. Hiding a module does not delete history.
Entity API search, prefixes, debounce and abort behavior remain independent of registry data.

Existing unrelated palette action URLs (`?action=new`, `?action=add`, `?action=compose`) remain
unchanged. The Seating Formations `?tab=formations` and Audit History `#audit` shortcuts have no
supported automatic selection equivalent in their current consumers; this refactor retains them
rather than adding page flows. Follow-up work should fix those consumers. Roster configuration uses
the supported `?section=settings`; branding, timezone, provider and payment settings use existing
DOM anchors. Their result IDs remain stable.
