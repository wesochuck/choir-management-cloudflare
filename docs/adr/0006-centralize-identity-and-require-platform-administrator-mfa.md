# Centralize Identity and Require Platform Administrator MFA

The Cloudflare application will use Better Auth with its identity, session, invitation, and
Organization Membership records stored in control-plane D1. Portal Sign-In is invitation-only,
defaults to a verified-email one-time code, and permits a person to add a conventional password;
multi-factor authentication is mandatory for Platform Administrators and optional for Organization
Owners, Organization Administrators, and Organization Members.

**Why:** A central identity lets one person safely join multiple Organizations while the Better Auth
Organization model matches the selected owner, administrator, and member roles. Email codes reduce
password friction without eliminating conventional passwords, and mandatory MFA protects the only
role with cross-Organization authority, trading uniform elevated-account MFA for a lower-friction
policy chosen by each Organization.
