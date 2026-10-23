# ADR 0063: Public website hosted documents

- Status: Accepted
- Date: 2026-10-23

## Context

Choral organizations frequently need to share downloadable administrative or legal forms on their
public-facing websites and donation pages (e.g. mail-in donation pledge forms, sponsorship packets,
handbooks, or tax exemption letters). Previously, all uploaded files through the private file API
were protected by session authentication or short-lived signed tokens and could only be linked
internally. Organization administrators had no dedicated facility to upload printable forms and
distribute permanent public URLs.

Furthermore, public website content edits (such as About Us copy, appearance, and navigation)
operate on a draft-and-publish model requiring explicit draft saves and publication version
verification. Requiring administrators to republish their entire public website merely to host a PDF
or DOCX file would introduce unnecessary friction and accidental premature draft releases.

## Decision

We introduce dedicated Organization-scoped public website hosted documents with the following
architecture:

1. **Storage and Immediate Availability**:
   - Files are stored in the existing Organization-scoped R2 bucket via the existing private file
     upload pipeline (`/api/organization/files`).
   - A dedicated metadata table, `public_website_documents`, and a unique slug reservation index
     table, `public_website_document_slugs`, are created in Organization SQLite via forward-only
     migration `124`.
   - Creation and edits to public documents take effect immediately upon upload/save; they do NOT
     alter the draft publication version or require clicking "Publish saved draft".

2. **File Types and Guardrails**:
   - Allowed file formats are PDF (`application/pdf`, `.pdf`) and Word
     (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `.docx`).
   - Maximum file size is strictly 5 MB per document.
   - Maximum hosted documents per Organization is capped at 50 documents to prevent unmetered
     storage abuse.
   - Slugs are automatically derived from document titles via standard slugification (lowercase
     alphanumeric and hyphens), with automatic `-2`, `-3` deduplication. Slugs are unique per
     Organization.

3. **Public URL and Serving Semantics**:
   - Permanent public download URLs follow the format: `/api/public/documents/:slug.:ext` (e.g.,
     `/api/public/documents/donation-form.pdf`).
   - Requests are routed to the public route handler `GET /api/public/documents/:slugWithExtension`.
   - The Organization is resolved solely from the validated hostname and authoritative registry
     (tenancy rule §4).
   - PDFs are served with `Content-Disposition: inline` allowing browser previewing.
   - DOCX files are served with `Content-Disposition: attachment` forcing download.
   - Strong security headers are applied to all served documents: `X-Content-Type-Options: nosniff`
     and a restrictive
     `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` to prevent
     cross-site scripting or untrusted document execution.
   - Fallback content type and file name resolution inspects R2 object custom metadata
     (`original-name`, `content-type`) for backward compatibility with existing uploaded private
     files.

4. **Durable Object RPC Boundaries**:
   - `OrganizationStore` exposes typed RPC methods: `listPublicWebsiteDocuments`,
     `createPublicWebsiteDocument`, `updatePublicWebsiteDocument`, `deletePublicWebsiteDocument`,
     and `getPublicWebsiteDocumentBySlug`.
   - All mutations execute in synchronous SQLite transactions inside the Organization Durable
     Object.
   - When a document is replaced or deleted, the underlying R2 private file is safely cleaned up
     only if no other references exist (checked via `privateFileIsReferenced`).
   - Store code performs no outbound fetches, WebSockets, or unbounded operations, preserving
     hibernation safety (`check:do-runtime`).

5. **Markdown Integration and Donation Page Upgrade**:
   - A dedicated Documents tab is added to the Public Website Manager.
   - A dropdown picker is added to `MarkdownLinkEditor` allowing administrators to insert hosted
     documents with one click into Markdown copy.
   - The Donation Page Settings description field is upgraded to Markdown with full
     `MarkdownToolbar` support and rendered on `PublicDonationView` using `PublicCopy` (supporting
     safe Markdown links).

## Consequences

- Backward compatibility is preserved: existing private files and draft settings continue to
  function.
- Rollback: if rolled back, migration 124 tables remain harmlessly in SQLite.
- External systems: no external providers or Stripe mutations are touched.
