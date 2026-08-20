# Support Organization Custom Email Domains and Universal Reply-To

Organizations may configure a dedicated sending subdomain (e.g. `mail.seattlechorus.org`) and an
Organization-wide `Reply-To` contact address (e.g. `info@seattlechorus.org`). Cloudflare Email
Sending remains the delivery transport, using automated API registration and DNS-over-HTTPS
verification for SPF, DKIM, DMARC, and Return-Path records.

All Organization Communications (event reminders, ticket receipts, audition notices, and
announcements) attach the Organization's `Reply-To` address by default. If a custom sending domain
is not configured or is degraded, delivery falls back to the platform sending address with the
Organization's display name and `Reply-To` address preserved. Platform Transactional Email (sign-in
OTPs, password resets, Platform Administrator MFA) remains on the centralized platform domain.

All operational email settings and DNS verification state are owned by the Organization Durable
Object accessed via typed Worker RPC (`communicationRpc`), with verified domain lookup indexed in D1
for fast event feedback routing.

**Why:** Dedicated subdomains protect the organization's primary domain reputation and existing
office mailboxes (Google Workspace/M365) from receiving bounce or bulk traffic. Universal `Reply-To`
gives every choir an immediate branding and reply channel without forcing complex DNS setup, while
automated Cloudflare Email Sending verification allows advanced organizations to achieve complete
white-label email authentication.
