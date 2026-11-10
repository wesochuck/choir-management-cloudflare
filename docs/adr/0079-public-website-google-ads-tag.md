# Google Ads tag on published Organization websites

Status: Accepted Date: 2026-11-09

## Decision

Managers may save an optional Google Ads destination ID (`AW-` followed by digits) in Public Website
Tracking settings. Empty disables tracking. Arbitrary scripts and Tag Manager containers are not
accepted. The ID follows the existing authorized draft/save/publish boundary and Organization-owned
immutable publication projection. Migration 139 adds one optional-value column with an empty
default; existing sites remain disabled. Older code can ignore the additive column and optional
payload field.

Public website and ticket catalog/purchase pages load the asynchronous Google tag. Administrative
previews, authentication, member pages, donation pages, and checkout recovery pages do not load it.
Confirmed ticket receipts report a conversion when a configured label exists, the authoritative API
returns paid, and checkout mode is stripe or free. Fake, pending, expired, and refunded purchases do
not report conversions. Bundles follow the same receipt path. Conversion data contains only the
globally unique purchase UUID (within Google’s 64-character transaction ID limit), paid amount,
currency, and configured Ads destination. No buyer name, email, scan credential, or signed token is
supplied in the event. Enhanced conversions are disabled. A bounded sessionStorage history
suppresses repeat reports in the same tab; Google receives a stable transaction_id for deduplication
across reloads/devices. This is browser-based reporting, so blockers, missing receipt visits, and
cleared storage can affect measurement; no server-side Google delivery pipeline is introduced. The
configured page location excludes query strings and fragments, and the configured referrer is empty.
Installing the Google tag enables Google's standard advertising measurement behavior; an
Organization choosing to enable it is responsible for its visitor disclosures and consent setup. No
consent-management interface is introduced by this feature.

Google script and connection origins are permitted only in public content and ticket HTML responses,
retaining nonce and existing Cloudflare allowances without enabling unsafe inline scripts or eval.
Published page requests continue reading cached publication data, without new operational-store
calls.

## References

- https://developers.google.com/tag-platform/gtagjs/configure
- https://developers.google.com/tag-platform/security/guides/csp
