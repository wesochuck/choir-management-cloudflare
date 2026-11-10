# Google Ads tag on published Organization websites

Status: Accepted Date: 2026-11-09

## Decision

Managers may save an optional Google Ads destination ID (`AW-` followed by digits) in Public Website
Tracking settings. Empty disables tracking. Arbitrary scripts and Tag Manager containers are not
accepted. The ID follows the existing authorized draft/save/publish boundary and Organization-owned
immutable publication projection. Migration 139 adds one optional-value column with an empty
default; existing sites remain disabled. Older code can ignore the additive column and optional
payload field.

The published public website layout loads the asynchronous Google tag. Administrative previews,
authentication, member pages, and signed-link/transaction layouts do not load it. No custom events,
order values, user identities, enhanced conversions, or purchase conversion events are supplied. The
configured page location excludes query strings and fragments, and the configured referrer is empty.
Installing the Google tag enables Google's standard advertising measurement behavior; an
Organization choosing to enable it is responsible for its visitor disclosures and consent setup. No
consent-management interface is introduced by this feature.

Google script and connection origins are permitted only in public content HTML responses, retaining
nonce and existing Cloudflare allowances without enabling unsafe inline scripts or eval. Published
page requests continue reading cached publication data, without new operational-store calls.

## References

- https://developers.google.com/tag-platform/gtagjs/configure
- https://developers.google.com/tag-platform/security/guides/csp
