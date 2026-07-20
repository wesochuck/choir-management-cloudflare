# Separate Platform and Organization Email

Cloudflare Email Service will send only platform transactional messages from a platform-owned
domain. Each Organization that uses campaign email or SMS—including newsletters, event invitations,
reminders, and combined-channel sends—must connect an Organization-owned communications provider
account and verified sending identities; Brevo is the first supported Organization Communications
Provider behind a provider-neutral delivery interface.

**Why:** Cloudflare Email Service is intended for transactional email rather than marketing or bulk
campaigns and does not replace the baseline's SMS capability, while shared campaign channels would
make the free platform absorb sending cost and couple every Organization's deliverability
reputation. Separate lanes trade additional Organization onboarding and encrypted
provider-credential handling for clearer consent, branding, cost ownership, suppression behavior,
and reputation isolation.
