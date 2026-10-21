# Organization Admin feature registration

`registry.ts` owns browser navigation metadata. It never authorizes access, registers a route, or
selects Organization storage. The dispatcher and server access checks remain authoritative.

## Register a feature once

1. Implement and test its authorized route first. Add a stable `OrganizationFeatureId`, canonical
   `href`, explicit aliases, canonical `ModuleId | null`, and semantic `iconId` to the registry.
2. Choose one `groupId` from the six shared `organizationFeatureGroups`: People & membership, Events
   & attendance, Music & content, Communications, Finance, Insights & settings. These records own
   both surfaces' headings, order, icons and accents. Home is the separate Dashboard landing
   destination above the groups.
3. Declare sidebar and dashboard positions. Every primary destination requires both placements. Only
   three narrow coverage exceptions exist: landing (Dashboard), configuration (Modules, Setup
   Checklist, Organization Security through the Organization Settings gateway), contextual (Patrons
   Dashboard, a Donations card without a duplicate sidebar entry). Parity tests compare eligible
   primary feature IDs in every module context; new unpaired features fail.
4. Add an SVG line path to `icons.ts` when a new subject is needed. `OrganizationFeatureIcon` is the
   single renderer used by sidebar, rail, cards and quick actions. Projections carry IDs; they never
   carry React components or emoji. Quick actions inherit their parent feature's icon.
5. Preserve palette result IDs and parent-linked subdestinations. Verify existing consuming query
   parameters before adding shortcuts. Known pure terminology templates are `{performer}`,
   `{performers}` (lowercase plural) and `{parts}`. Reuse existing normalization; do not add grammar
   or hooks to records. Keep search synonyms when renaming a familiar title (Admin Overview).
6. Run parity, UI, navigation, accessibility and browser tests, and the required material/release
   gates. Capture light/dark expanded, compact and drawer screens at full and reduced modules.

All enabled, full-access projections contain 25 sidebar destinations, 22 cards in 5/5/4/6/2 groups,
and five unchanged quick actions. Contacts, Membership Invitations, Seasons & Dues and Reports now
have real cards. Contacts and Performer Directory remain distinct. `practice_player` remains a
member-only configuration module without an invented Organization destination.

## Navigation state

The Organization shell shares accordion expansion across desktop and mobile. A versioned
hostname/workspace key stores only valid group IDs; People opens on first visit and navigation
reveals the active destination's group. Manual collapse lasts until subsequent navigation. A
separate versioned hostname key stores compact preference. Existing pinned/unpin state remains
independent. Member, Account and Platform retain their original navigation behavior.

Desktop compact categories open native auto popovers in the browser top layer, outside clipping
scroll containers. Buttons support click, Enter and Space; native outside dismissal and Escape are
preserved, with focus restored to the invoker. Guarded links close flyouts only after accepted
navigation. Mobile uses the existing Sheet and full labeled accordion. No hover-only destinations.

## Modules, terminology and search

The shell owns one reactive module catalog. Loading/initial errors withhold gated navigation;
missing IDs default visible only inside a successfully fetched catalog. Confirmed saves patch it,
invalidate old reads and trigger one deduplicated abortable readback. Failed readbacks retain
confirmed changes; retry/foreground refresh require no polling. Snapshots and terminology reset with
the hostname/session shell key and never enter browser storage. Server module labels remain
independent of feature labels.

Recents remain hostname/workspace scoped, resolve current registered titles, and recheck eligibility
on render/selection without deleting history. Every search trigger opens the same full palette:
server-backed roster, events, music and polls remain independent of static navigation metadata.
Prefixes, debounce, cancellation and current role/Owner restrictions remain in force.

Existing action URLs remain unchanged. Seating Formations `?tab=formations` and Audit History
`#audit` still require separate page-consumer work; no new page flow is introduced here. Roster
configuration uses the existing `?section=settings`; other settings retain their real DOM anchors.
