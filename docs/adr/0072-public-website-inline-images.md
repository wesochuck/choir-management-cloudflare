# Public website inline images

Status: Accepted Date: 2026-11-01

## Decision

Extend the existing Markdown editor only for Home About Us and custom website pages. Keep all
existing fields, formatting, document insertion, SaveCoordinator and explicit Save draft / Publish
behavior. Other Markdown consumers do not enable image rendering or image controls.

Standalone image blocks use `![Alt text](choir-image:<UUID> "Optional caption")`. Require nonempty
alt text (at most 500 characters); captions allow at most 1,000 characters. Escape Markdown
delimiters and render descriptions/captions as React text. Remote URLs, HTML, SVG and data URLs are
not inline image sources. Ordinary Markdown and existing settings bounds continue to apply.

Reuse authenticated Organization-private uploads (JPEG, PNG, WebP; 5 MB maximum). On draft save,
validate at most 50 distinct referenced files against the owning Organization's indexed private-file
metadata. Include these references in the existing immutable, Organization/version-scoped media
publication pipeline, retaining the existing total limit of 102 published images. Public rendering
resolves only IDs listed in the published snapshot. Schedule refresh uses published settings, never
private draft references. File reclamation protects references in the current draft; removing an
image from text does not delete its source or immutable published copies.

No schema migration, new endpoint, index, external provider or storage system is introduced. Images
are private until publication, unlike hosted documents which remain immediately public.

Preview is visible by default. Hide/Show preview changes local display state only, preserves edits,
selected page and device size, and retains the existing mobile Edit/Preview workflow. Hidden preview
gives the editor the existing full-width layout. Keyboard focus moves to the surviving control or
restored preview region. No persistence or website publication is triggered by toggling preview.

## Rollback

Keep the existing revision-aware settings and immutable publication pipeline required by ADR 0071.
Reverting these additions preserves Markdown text and existing snapshots but older web renderers
will show image markers as text. Restoring inline image rendering restores their display. Source
files and published copies must be retained; reverting UI alone does not delete them. No migration
rollback is needed. Deployment and promotion remain separately authorized operations.
