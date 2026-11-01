# Bounded Public Website Content Pages

Status: Accepted Date: 2026-10-31

## Decision

The website has one private draft and an explicitly published immutable Organization-bound snapshot.
Home owns `/`. Up to 50 additional text pages own validated single-segment root URLs; application,
transaction, authentication, platform, API, and asset paths take precedence. Unknown, removed, and
empty pages return a not-found view and HTTP 404 on direct requests. Navigation visibility does not
restrict access. Array order determines navigation order.

Pages have stable IDs, titles/slugs of at most 120 characters, Markdown bodies of at most 100,000
characters, and a navigation flag. Settings content is limited to 500,000 serialized UTF-8 bytes,
below the existing 1,048,576-byte HTTP body guard and 1,000,000-byte complete projection guard.
Response/concurrency metadata is excluded from the content budget; the store validates the final
compatible History shadow and default fields before committing. The complete projection guard
remains authoritative when event and commerce data add overhead.

Forward-only Organization migration 130 adds nullable `pages_json` and `draft_revision` to the
settings singleton. No index is added: access is a single primary-key row. NULL denotes legacy data;
an explicit empty array denotes intentional deletion. Nonempty legacy History normalizes to stable
ID `legacy-history`, slug `history`, its configured heading and a separate compatible navigation
label. Reading or migration does not republish content or rewrite immutable R2 snapshots.

Modern saves require the expected draft revision; stale writes fail with `website_draft_conflict`.
Clients omitting pages cannot overwrite a modern collection. First legacy writes normalize History.
Page URLs cannot change after the page is saved; arbitrary renaming/redirects are deferred.
Publication versions remain distinct from draft revisions. Automatic event refresh carries forward
pages exclusively from the current published snapshot, including empty arrays and navigation flags.
All affected store calls use typed Workers RPC; storage operations contain no provider I/O.

The CMS uses Pages, Appearance, Navigation, Footer, and Documents tabs, the existing
SaveCoordinator, and explicit publication. Document insertion reuses Organization-hosted document
paths and Markdown link safety. Documents remain immediately public under ADR 0063, independently of
draft publication.

## Rollback

Keep additive columns and data in place. Older runtimes cannot render custom pages and must not be
allowed to save website settings after modern pages are enabled, since they lack revision checks.
For rollback, retain this revision-aware store boundary and the page-preserving publication/refresh
pipeline, or temporarily disable website writes and automatic refresh; restore a prior publication
pointer through the guarded release procedure if required. Never reverse migration 130, mutate old
snapshots, or promise that rollback restores deleted documents.

A hosted rollout must retain a tested artifact containing this compatible boundary as its rollback
target before allowing page authoring. Creating and qualifying that release artifact is deferred to
the separately authorized release; local implementation does not authorize deployment or establish
an older incompatible Worker as a safe rollback target.
