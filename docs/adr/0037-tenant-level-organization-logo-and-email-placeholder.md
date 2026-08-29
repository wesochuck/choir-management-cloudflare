# Tenant-Level Organization Logo and Email Placeholder

Organizations may upload a canonical Organization Logo image in Organization Settings and First-Run
Setup. The logo represents the Organization across authenticated navigation headers, member
touchpoints, invitation/welcome pages, and outbound communications.

The Structured Public Website inherits the Organization Logo by default when no specific public
website logo override is configured.

All outbound Organization Communications automatically brand the outer email document header with
the Organization Logo and name (with fallback to an initials badge derived from the Organization
Name). In addition, the Communication Composer and system templates support the `{organizationLogo}`
placeholder tag in message bodies, rendering an email-safe responsive `<img>` element pointing to
the Organization's public edge URL, with graceful fallback to styled Organization Name text when no
image exists and plain text in SMS channels.

Logo storage and metadata are owned by the Organization Durable Object in private R2 storage and
automatically published to the edge public projection for authenticated and public access.

**Why:** Choirs need recognizable visual identity across both their private member portal and
public-facing/member communications without having to maintain multiple detached logo uploads.
Unifying the tenant logo at the Organization boundary while auto-publishing to edge URLs guarantees
that email clients (Gmail, Apple Mail, Outlook) can reliably load the brand asset while preserving
strict tenant isolation and reliable SMS/plain-text fallbacks.
