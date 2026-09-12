# Passkey-First Authentication with Organization MFA Satisfaction

**Status:** accepted

Passkeys are adopted as the preferred everyday authentication method for Choir Management. A
one-time code (OTP) sent to an identity's verified email address serves as the universal account
fallback and recovery path. Account passwords remain optional and user-managed.

A successful passkey authentication requires WebAuthn user verification (biometric or device PIN). A
verified passkey sign-in creates server-owned session authentication assurance
(`session_auth_assurance`) that satisfies Organization multi-factor authentication (MFA) for the
lifetime of that authenticated session without presenting an additional TOTP or recovery-code
challenge. For sessions created through email OTP or password authentication, the existing
Organization TOTP and recovery-code requirements and 12-hour assertions remain unchanged.

Platform Administrator MFA assertions (`platform_mfa_assertions`) and the one-hour freshness
requirement for elevated access operate on a separate elevation model and are explicitly out of
scope for this decision.

**Considered Options:**

1. _Inferring passkey authentication from user credentials or browser state._ Rejected because the
   mere possession of a registered passkey does not prove the current session was authenticated with
   WebAuthn user verification.
2. _Challenging passkey users with Organization TOTP._ Rejected because WebAuthn user verification
   already provides hardware-bound, phishing-resistant multi-factor assurance, making an additional
   TOTP prompt redundant friction.
3. _Modifying Platform Administrator MFA to accept passkeys._ Deferred to a separate architectural
   decision because platform administration involves high-privilege cross-organization elevation
   with distinct audit and recency requirements.

**Consequences:**

- The sign-in interface highlights passkeys as the primary sign-in action with discoverable
  credentials, with email code readily available as a fallback.
- Better Auth configuration derives Relying Party ID (RP ID) with Public Suffix List and localhost
  awareness, using `requestUrl.hostname` on `workers.dev` to prevent eTLD registration violations.
- Server assurance is recorded synchronously on successful passkey verification and deleted on
  session revocation via foreign key cascade (`ON DELETE CASCADE`).
- Organization authorization queries evaluate both `session_auth_assurance` and
  `organization_mfa_assertions` in a single D1 query.
- Existing TOTP enrollment, lockout, and recovery code flows remain fully functional for non-passkey
  sessions.
