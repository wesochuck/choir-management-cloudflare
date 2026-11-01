# Public Website CMS Implementation Plan

Date: October 31, 2026. Status: implemented and verified locally. No release authorized.

This plan covers the approved CMS concept, custom content pages, and direct document insertion. The
user separately authorized committing and pushing on November 1, 2026. Deployment, hosted resource
changes, and production remain outside the authorized scope.

## Outcome and visual contract

Give Organization administrators a familiar, compact website editor without turning the application
into a general-purpose page builder.

Visual references:

- [Approved Pages workspace](assets/public-website-pages-concept.png)
- [Document insertion refinement](assets/public-website-document-picker-concept.png)

Preserve these decisions:

- Keep the existing admin navigation as the only vertical navigation.
- Use horizontal **Pages, Appearance, Navigation, Footer, Documents** tabs.
- Remove the publication readiness summary entirely; do not move its checklist into another panel.
- Use headings, spacing, and dividers for the editor. Do not wrap the editor or each section in
  cards.
- In Pages, use a page selector and **Add page** beside the editor, with a draft preview to the
  right.
- Home keeps its banner, subtitle, image, image-position controls, and introduction. Put image
  positioning behind **Adjust image** rather than displaying another large image by default.
- Additional pages have a title, URL, Markdown content, and **Show in navigation**.
- Add **Insert document** beside the existing Link toolbar action.
- Keep separate **Save draft** and **Publish** actions. Saved website content stays private until
  explicitly published.

The mockups establish structure, not a replacement design system. Use current application tokens,
Organization branding, theme, and repository-owned primitives. The generated white public content
area, invented admin menu, sample documents, dates, and fonts are illustrative. Preserve the actual
public site's configured appearance. The mockup omits the history navigation link despite showing
the checkbox selected; the implementation must render it correctly.

Out of scope: arbitrary layouts, blocks, nested pages, custom HTML/scripts, templates, per-page
themes, SEO settings, scheduling, autosave, individual-page publish workflows, and a new file
system.

## Verified starting points

| Responsibility                             | Current owner and finding                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CMS state, save, publish, verification     | `apps/web/src/account/PublicWebsiteManager.tsx`; Home and History are fixed tabs, and the manager already registers with `useSaveRegistration`.                                                                                                  |
| Editing controls                           | `apps/web/src/account/components/PublicWebsiteEditorTabs.tsx`; Home fields and History Markdown already exist.                                                                                                                                   |
| Draft preview                              | `apps/web/src/account/components/PublicWebsitePreview.tsx`; currently restricted to Home and History.                                                                                                                                            |
| Formatting and links                       | `MarkdownToolbar.tsx`, `MarkdownLinkEditor.tsx`, and `apps/web/src/shared/markdownLinks.ts`; hosted documents are already available inside the Link dialog.                                                                                      |
| Hosted documents                           | `PublicWebsiteDocumentsEditor.tsx`, `apps/web/src/api/publicDocuments.ts`, `packages/contracts/src/publicDocuments.ts`, and `apps/worker/src/organization/publicDocumentStore.ts`.                                                               |
| Website transport contracts                | `packages/contracts/src/organization.ts` and the projection schema in `packages/contracts/src/ticketing.ts`.                                                                                                                                     |
| Draft persistence and snapshot preparation | `apps/worker/src/organization/publicWebsiteStore.ts`; fixed fields include `history_text`, with explicit construction of publication settings.                                                                                                   |
| Worker orchestration                       | `apps/worker/src/organization/organizationPublicWebsite.ts`, `apps/worker/src/publication/publishOrganization.ts`, and `apps/worker/src/routes/organizationWebsite.ts`.                                                                          |
| Public rendering and route classification  | `apps/web/src/public/PublicOrganizationSite.tsx` and `apps/web/src/App.tsx`; current site paths include `/`, `/history`, and `/performances`.                                                                                                    |
| Layout styling                             | `apps/web/src/styles/components/website-editor.css`; already modified in the starting working tree. Preserve and reconcile those edits.                                                                                                          |
| Architectural boundaries                   | ADR 0063: hosted documents are immediately public, independent of website publication. ADR 0058: automatic Performance refresh must use published settings, never the administrative draft. ADR 0056 owns existing public links and page labels. |

The document picker is an improvement in discoverability and interaction, not a new upload feature.
The Pages model is a material contract, persistence, routing, and publication change.

## Proposed behavior and bounded model

### Pages

Home remains the fixed root page and cannot be deleted or assigned a custom slug. Include it in the
page selector; its editor retains the current structured Home controls.

Represent additional pages as a bounded collection inside the website draft. Each has a stable ID,
title, single-segment slug, Markdown body, and `showInNavigation` flag. Array order supplies stable
navigation order initially; do not introduce drag-and-drop ordering. Suggested initial limits are 50
additional pages, 120 characters per title/slug, the existing 100,000-character body ceiling, and a
1 MiB UTF-8 aggregate settings ceiling. Confirm these limits against existing HTTP and publication
payload guards before recording the ADR; enforce them server-side as well as in the UI.

Use a nullable additive `pages_json` column on the website settings singleton as the initial storage
design. This matches whole-site saving/publication and avoids a separate page CRUD API or recurring
table scans. `NULL` means legacy format; `[]` means an intentionally empty modern collection. Never
interpret an explicit empty collection as a request to regenerate History. Validate unique IDs/slugs
and all cross-field constraints at contract and store boundaries. No new SQL index is needed for
this bounded singleton access path.

New pages enter the local draft with a stable ID. **Add page** focuses the title field; derive a
slug until the user edits it or first saves. Require a valid title and slug to save. Keep the slug
fixed after first save in this initial release, with explanatory copy, to avoid silently breaking
links. Editing the title later does not change the URL. Arbitrary slug renaming and redirects are
deferred.

Additional pages are text pages; do not add a per-page hero or arbitrary image uploads. Empty pages
may be saved as drafts but are excluded from public routes and navigation until they contain text.
Explain this beside the content field. Unchecking **Show in navigation** removes a menu link only;
the published page remains publicly accessible by URL. It is not an access-control feature.

Allow removal of additional pages through a small secondary action with danger confirmation. Removal
is a draft edit; the live page disappears only after publication. Home cannot be removed. Do not
allow a page switch, section switch, or background refetch to silently discard unsaved content.

### History compatibility and public URLs

Keep the existing `/history` address. Convert nonempty legacy History into an ordinary page with a
stable identity and slug `history`, preserving its configured heading/navigation label. Do not turn
it into `/our-history` merely to match the sample image. Preserve distinct legacy heading and menu
labels through a compatibility override when they differ; do not silently discard either.

Custom pages use `/<slug>`. Build a shared reserved-path policy from the actual public, transaction,
member, authentication, platform, API, and asset route inventories. Reject collisions and encoded or
ambiguous path forms; enforce system-route precedence on canonical and custom public hosts. The
migrated History page owns `/history`; no second page may claim it. Unknown or removed pages show a
real not-found view, not Home. Check HTTP status behavior for direct requests as well as SPA
routing.

Do not broadly classify all unknown paths as public content before authorization/host checks. Audit
both Worker public-host allowlisting and frontend dispatch. Content pages must never expose account
routes on custom public domains. Preserve shared headers/footers on existing transaction pages.

### Saving and publication

Keep a single website draft and whole-site publication. Page selection changes which fields are
edited, not what the Save action persists. Integrate with SaveCoordinator and the existing SaveBar;
do not create two competing sticky save controls. Publish remains unavailable while edits are
unsaved, with an explanation directing the user to Save draft.

Add an optimistic draft revision/expected-version contract so a stale tab cannot overwrite a newer
page collection. Check it atomically in the Organization store and return a typed conflict without
overwriting local inputs. Publication-version checks remain separate from draft revision checks. Do
not treat an omitted `pages` field from an older client as an empty array: preserve current pages or
reject incompatible stale writes explicitly.

All pages enter the immutable Organization-bound R2 snapshot. Public page views read that snapshot,
not the operational store. Automatic Performance updates must carry forward pages from the current
published snapshot, including deletions and navigation flags, never from the saved draft. Keep the
current conditional activation, bounded retry, and version-verification behavior.

Replace the readiness panel with compact publication state: not published, publishing, verification
pending/failed, or confirmed live. Only show confirmed **Live** after the existing verification path
succeeds; retain retry verification and actionable failures. Do not imply that an unpublished draft
is live because it saved successfully.

### Insert document

Add a labeled document action to MarkdownToolbar using the existing Organization website-document
list. Use an accessible repository-owned anchored picker; use a Dialog fallback on narrow screens if
the available primitives require it. Search the existing bounded list locally. Show title, file
type, and size; provide loading, empty, no-match, and error/retry states.

Capture textarea selection before opening. Choosing a document inserts a link at that selection,
using selected text as the label, otherwise the document title. Reuse `formatMarkdownLink`, the
existing safe URL rules, target behavior, escaping, and focus/caret restoration. Use the server's
Organization-relative `downloadPath`; never construct a signed/private file URL or hardcode a host.
Treat cancellation as no edit. Restore focus to the toolbar trigger on dismissal and to the textarea
after successful insertion. Protect against applying an old selection to changed text.

**Manage documents** opens the existing Documents tab through the same unsaved-change guard;
canceling that navigation must retain editor text and selection. The picker does not upload files,
search private member files, or create public documents implicitly. Only authenticated authorized
website document data may be loaded; expose fetch errors rather than silently making failure look
empty.

Preserve ADR 0063: document uploads, replacements, and deletion take effect immediately. Saving or
publishing page text does not publish or restore the document itself. Explain immediate availability
in Documents and warn on document deletion that existing links may stop working. Do not promise that
old website snapshots preserve a deleted or replaced file.

## Implementation sequence

### Phase 1 — Record contracts and compatibility decisions

- Add a new ADR for bounded custom pages, root URL ownership, explicit publication, History
  compatibility, draft concurrency, and schema/rollback support. Do not edit accepted ADRs to
  silently reverse their decisions.
- Add shared unrefined page schemas, aggregate validation, reserved-path helpers, and deterministic
  legacy normalization. Extend settings and published projection parsing compatibly.
- Record the final storage and payload limits and ensure browser and Worker contracts agree.
- Define omission versus empty-array semantics and old-client conflict handling before changing UI.

Exit: contract tests demonstrate legacy settings/projections, modern pages, unique identities,
reserved paths, empty/deleted History, field limits, and stale draft rejection semantics.

### Phase 2 — Expand persistence and publication

- Allocate the next migration number at implementation time; never rewrite an applied migration.
- Add nullable page storage and draft revision through forward-only migrations and real SQLite
  tests. Normalize legacy data deterministically; do not republish during migration or mutate old R2
  objects.
- Implement new/changed store operations through typed OrganizationStore RPC, replacing the affected
  legacy internal website HTTP calls as needed. Keep provider/R2 I/O outside the store runtime.
- Extend explicit snapshot construction and automatic Performance refresh to retain the correct
  complete page collection. Preserve transactional revision checks and conditional activation.
- Ensure Organization exports include page content through the existing settings record.
- Verify admin route parsing, authorization, bounded payload handling, and typed conflict errors.

Exit: populated-store upgrade tests and publication tests prove old data survives, drafts stay
private, event refresh cannot leak page edits, and cross-Organization operations fail closed.

### Phase 3 — Public content routes and rendering

- Extend route classification and host allowlists with system-route precedence and reserved slugs.
- Add a reusable content-page renderer using PublicCopy and existing configured typography/branding.
- Render enabled custom-page links in stable order and preserve transaction/module navigation.
- Handle direct loads, reloads, navigation, document titles, empty pages, removed pages, and unknown
  paths. Keep old `/history` snapshots working without duplicate navigation entries.
- Retain route-level code splitting and verify public request caching stays snapshot-based.

Exit: old and new snapshots render correctly on canonical and custom public hosts; routing cannot
shadow protected/system endpoints and unknown pages return the intended not-found response.

### Phase 4 — Approved CMS workspace

- Replace Home/History tabs with Pages and add the page selector, Add page, plain fields, and
  guarded removal. Preserve existing Home, appearance, footer, module labels, and Documents
  capabilities.
- Remove readiness UI and use compact truthful publish status and verification retry controls.
- Flatten editor surfaces, move image positioning behind Adjust image, and keep the main app
  sidebar.
- Connect preview to stable page IDs and shared public rendering rules, including navigation links.
- Reuse draft registration, SaveBar, baseline isolation, and accessible discard confirmations.
- At small widths retain the existing Edit/Preview switch instead of squeezing two columns together.

Exit: page edits survive switching/refetches as intended, saves cannot erase newer input,
publication is deliberate, and desktop/mobile/light/dark layouts match the approved structure.

### Phase 5 — Document insertion and regression coverage

- Add the direct toolbar picker without duplicating document APIs or upload ownership.
- Cover text selection, cursor insertion, escaped labels, existing links, missing documents, failed
  loading, selection drift, dismissal, focus return, and guarded Manage documents navigation.
- Preserve existing Link-dialog behavior and donation-description Markdown integration.
- Finish focused end-to-end coverage across pages, document insertion, navigation, save, and
  publish.

Exit: keyboard and touch users can insert the correct Organization's website document without losing
content; document immediacy is clear and shared Markdown consumers retain their behavior.

### Phase 6 — Qualification and authorized staging release

Run focused checks during development. Use `npm run check:ci` for browser-free comprehensive
verification when appropriate. If release is authorized, follow the canonical sequence: focused
checks → cohesive local commit(s) → `npm run check:release` on the clean committed candidate → push
→ `npm run deploy:staging -- --yes`. Do not repeat check:ci/build immediately before check:release.
Update route registrations/probes and run `npm run check:routes` for endpoint/route changes;
maintain safe boundary evidence with `npm run qualify:staging:evidence` when endpoints change.

Deployment qualification remains API-only per the staging runbook. Local desktop/mobile E2E is part
of release qualification; do not introduce a hosted browser smoke step or direct Wrangler promotion.
Production remains out of scope.

## File Responsibility Map

Paths below are current owners or explicitly proposed new modules; split large components rather
than expanding PublicWebsiteManager into a second routing or domain layer.

| Files/modules                                                                                                                                                                 | Responsibility                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/organization.ts`, `ticketing.ts`, `publicWebsitePages.ts`                                                                                             | Page/settings/projection schemas, revision transport, compatibility and bounded validation.               |
| `packages/contracts/src/publicWebsitePages.ts`                                                                                                                                | Wire-format compatibility normalization and shared route validation used by schemas, browser, and Worker. |
| `apps/worker/src/organization/schema/migrations.ts`, migration registry/tests                                                                                                 | Additive singleton page storage and revision; populated upgrade/compatibility tests.                      |
| `apps/worker/src/organization/publicWebsiteStore.ts`, `OrganizationStore.ts`                                                                                                  | Authoritative validation, atomic draft writes, RPC methods, audit records, and publication preparation.   |
| `apps/worker/src/organization/organizationPublicWebsite.ts`, `publication/publishOrganization.ts`                                                                             | Worker-side publication, published-only refresh, snapshot compatibility, conditional activation.          |
| `apps/worker/src/routes/organizationWebsite.ts`, relevant public/host routing modules                                                                                         | Existing admin endpoints, concurrency errors, safe custom-page public route classification and probes.    |
| `apps/web/src/api/organization.ts` or current website API owner located during implementation                                                                                 | Typed page/revision transport and problem preservation.                                                   |
| `apps/web/src/account/PublicWebsiteManager.tsx`, proposed `components/PublicWebsitePagesEditor.tsx`                                                                           | Workspace state, page selector/forms, guarded draft lifecycle, truthful publish status.                   |
| `apps/web/src/account/components/PublicWebsiteEditorTabs.tsx`, `HeroImagePositionEditor.tsx`                                                                                  | Existing fields, flat grouping, deferred image-adjustment controls.                                       |
| `apps/web/src/account/components/PublicWebsitePreview.tsx`                                                                                                                    | Selected-page preview, responsive device mode, shared public rendering.                                   |
| `apps/web/src/account/components/MarkdownToolbar.tsx`, proposed `PublicDocumentPicker.tsx`, `MarkdownLinkEditor.tsx`, `apps/web/src/shared/markdownLinks.ts`                  | Direct document insertion, existing Link behavior, safe formatting and selection restoration.             |
| `apps/web/src/account/components/PublicWebsiteDocumentsEditor.tsx`, `apps/web/src/api/publicDocuments.ts`                                                                     | Existing public library management, immediate-effect copy, query reuse.                                   |
| `apps/web/src/App.tsx`, `public/PublicOrganizationSite.tsx`, proposed `public/PublicContentPage.tsx`                                                                          | Public route dispatch, page rendering, navigation, metadata, and not-found behavior.                      |
| `apps/web/src/styles/components/website-editor.css`                                                                                                                           | Flat workspace, one preview boundary, responsive layout, token-based theme support.                       |
| Contract/domain tests, `apps/worker/test/publicWebsite.integration.test.ts`, `publication.integration.test.ts`, `publicWebsiteDocuments.integration.test.ts`, migration tests | Model, upgrade, publication, security, and rollback evidence.                                             |
| Existing CMS/Markdown UI tests and `apps/web/e2e/website-editor-layout.spec.ts`, `website-links-labels.spec.ts`, `website-hero-position.spec.ts`, `website-cms.spec.ts`       | Desktop/mobile editing, document insertion, draft guards, image behavior, focus and accessibility.        |
| ADR 0071, `docs/architecture/data-model.md`, this plan                                                                                                                        | Accepted decisions, schema/publication documentation, implementation progress and evidence.               |

## Acceptance and risk checklist

- [x] No readiness summary or duplicate CMS sidebar; editor uses flat headings/dividers.
- [x] Home retains all current editing capabilities; custom pages can be added, edited, selected,
      hidden from navigation, and removed from the draft.
- [x] `/history`, old snapshots, empty legacy History, configured labels, and existing public module
      routes remain compatible; no migration publishes a draft.
- [x] Old-client omissions cannot erase pages; stale saves return a recoverable typed conflict.
- [x] Saving does not change public page content; publishing activates and verifies a whole
      snapshot.
- [x] Event-triggered refresh preserves only published pages, even with newer saved/unsaved drafts.
- [x] Public content reads avoid per-page DO access; bounded payloads and maps/sets prevent repeated
      scans and quadratic lookup work. Bundle-size/build warnings are investigated.
- [x] Hostname determines the Organization before authorization; wrong-host page/document access,
      private-file substitution, and custom-host authenticated-route access are rejected.
- [x] Markdown remains safely rendered; raw HTML, unsafe schemes, encoded path bypasses, and
      cross-tenant file references do not create a new execution or data-leak path.
- [x] Direct document insertion uses the existing public download path and preserves selected text,
      escape handling, focus, draft state, and independent immediate document lifecycle.
- [x] Keyboard tabs, selector, picker, dialogs, validation announcements, Edit/Preview, sticky
      actions, zoom, light/dark themes, mobile overflow, and long menus are verified.
- [x] Required focused tests and affected integration/build gates pass; all skipped checks have an
      explicit reason. Release evidence is collected only on the clean committed candidate.

## Migration, rollback, and handoff

Treat this as a material change. Retain legacy History columns and parsing during the compatibility
window; synchronize compatible History fields when saving modern pages where needed. Read old
projections through a deterministic compatibility adapter. Preserve the distinction between absent
pages and intentionally deleted pages in every layer, including automatic event refresh.

An old Worker ignoring new JSON fields is not automatically a safe rollback target: its automatic
publication could strip pages, and its UI could overwrite current drafts. Establish a compatible
baseline release that reads/preserves pages before enabling page authoring, or keep a tested
compatible rollback artifact. Do not enable authoring until this rollback path is demonstrated.
Rollback uses compatible code and retained snapshots; it does not reverse migrations or delete page
data. A snapshot-only rollback is temporary because a later automatic event refresh can publish
again. Test this explicitly and document the supported rollback version in release evidence.

No new provider, queue, schedule, D1 operational storage, domain, credentials, or
real-message/charge flow is needed. Public publication is the intended external effect, and document
replacement/deletion retains its existing immediate effects. Those effects require integration
coverage, not a new provider workflow.

The two PNGs are planning references copied from the selected ImageGen concepts; they are not
runtime assets. Regenerate only for an intentional design revision using the existing screenshots
and approved feedback. These PNGs are not imported into the application. GOAL and READINESS remain
unchanged because this is not active milestone execution.

Starting tree includes unrelated compliance/settings/shell changes and an existing website-editor
stylesheet edit. The CMS commit includes its website layout dependencies while preserving unrelated
compliance/settings work outside the commit. Release qualification must run against a separate clean
checkout of the committed CMS candidate before pushing. No hosted mutation or deployment is
authorized.

## Local implementation evidence (November 1, 2026)

Phases 1–5 are implemented with Organization migration 130 and ADR 0071. The final settings ceiling
is 500,000 UTF-8 bytes to fit the existing 1,048,576-byte JSON request and 1,000,000-byte complete
projection guards. The shared compatibility/route helpers live beside their wire schemas in
`packages/contracts/src/publicWebsitePages.ts`; no domain-package dependency cycle was introduced.
The store validates the final compatible History shadow before committing; response and concurrency
metadata do not consume the content budget. Additional responsibility: `packages/ui/src/Dialog.tsx`
owns optional anchored positioning with the existing responsive dialog fallback;
`MarkdownDocumentPicker.tsx` owns document-list interaction. The existing SaveBar supports a
registration-provided save label so the CMS has one Save draft bar.

Focused contract/migration/route tests and editor/Markdown/public-rendering UI tests pass. Desktop
and mobile Chromium tests cover light/dark layouts, image crop controls, content-page authoring,
document insertion, focus, accessibility, save/publish, History labels, and module navigation.
`npm run check:ci` passed all 19 steps: high-severity dependency audit, lockfile and runtime checks,
formatting, lint, Knip, types, contracts/routes, 2,295 unit tests, 1,133 UI tests, deployable build,
artifact verification, and 588 workerd integration tests. The focused Chromium desktop/mobile set
passed 26 cases across `website-cms`, `website-editor-layout`, `website-hero-position`, and
`website-links-labels`. The maximum collection (50 menu pages), maximum title length (120
characters), 320px reflow, and 200% text sizing were exercised on public pages. The final small
secondary Remove page action was rechecked through all six CMS browser cases.

Playwright generated light/dark desktop/mobile screenshots under `test-results/website-cms-*`;
regenerate them with the same focused specs. The deployable web/Worker bundles and artifact hash
manifest were regenerated by `check:ci`. No bundle-size/build-output warning remained. Those local
checks preceded commit/push authorization. A clean committed candidate must now pass
`npm run check:release` before pushing; hosted `qualify:staging:evidence` remains outside scope.
Local authenticated, wrong-host, custom-host, stale-write, snapshot, and document boundary tests
passed. No new provider, queue, schedule, index, or external-effect lane was added. Page documents
retain ADR 0063 immediacy.

The existing settings-route edits had a browser-only `window.location.hash` assumption; a minimal
environment guard preserves the browser behavior and makes existing Node route tests pass in the
original working tree; those unrelated settings edits remain outside the CMS commit. No reusable
release evidence is claimed from the dirty working tree. Commit/push is authorized, with complete
qualification required on the isolated clean candidate. Staging promotion and its compatible
rollback artifact remain pending deployment authorization. GOAL and READINESS remain unchanged
because this work is not active milestone execution.
