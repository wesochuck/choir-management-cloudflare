# ADR 0054: Organization public website footer embeds

Status: Accepted

## Context

Organizations need editable public footer content and their own third-party badges or widgets,
including Candid/GuideStar seals. Provider URLs differ by Organization. Executing pasted HTML in the
application origin would compromise authenticated administration and public transaction pages.

## Decision

Store optional Markdown footer text (10,000 characters) and at most six structured embed records in
the Organization's existing private website draft. Each record has an image/iframe kind, required
accessible description, HTTPS source, optional HTTPS link, and bounded iframe height. Credentials in
URLs are rejected. Migration 115 expands the singleton settings table with empty defaults. Existing
published projections that omit these fields remain readable.

The editor imports linked-image and iframe snippets through an inert DOMParser document, extracts
only validated fields, and discards styles, event handlers, srcdoc, and supplied permissions.
Script, object, and embed snippets are rejected. Raw HTML is never persisted or rendered. Public and
preview footers share one renderer. Existing copyright, Privacy, Terms, and contact links remain
available. Draft saves do not change the immutable public projection until explicitly published.

Allow HTTPS image/frame sources in the Worker and static CSP because Organizations select different
providers. Parent-document script, connection, form, object, and framing restrictions remain intact.
Iframes always use sandbox="allow-scripts" without same-origin, forms, popups, downloads, or top
navigation permissions, and cannot inherit user-provided permissions. Images and iframes use
no-referrer and lazy loading. Providers may reject framing or require unsupported permissions; the
editor explains this limitation and offers a preview. No server-side fetching/proxying is
introduced.

## Consequences

Each Organization owns its footer content through the existing host-resolved authorization and
publication paths. Third parties receive browser requests only when a configured embed loads; there
is no additional Durable Object or provider I/O. External content availability and tracking remain
provider-controlled. A failed widget cannot prevent the remaining footer from rendering.

Rollback can retain the additive columns and older binaries ignore the new projection properties. An
older binary saving and publishing a draft may omit footer content from its publication; the stored
columns remain available after upgrading again. No indexes or new endpoints are required.
