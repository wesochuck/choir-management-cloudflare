Yes. I’d give the coding agent a fairly explicit plan, because the important part is not adding
WebAuthn itself; it is defining the **authentication-assurance rule** correctly so passkey users do
not get an unnecessary TOTP prompt.

One scope choice I would make up front: **a passkey-authenticated session should satisfy
Organization MFA, but this first change should not alter the separate Platform Administrator
MFA/elevation system.** Platform Administrator access currently has its own one-hour MFA assertion
and additional enrollment requirements, so I would leave that higher-privilege path alone for now.

## Coding Agent Plan: Passkey-First Authentication with Organization MFA Satisfaction

### Target behavior

Implement the following authentication model:

| Situation                                          | Result                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| User has a passkey                                 | Passkey is the preferred sign-in method                                                             |
| User signs in with passkey                         | Signed in; Organization MFA is automatically satisfied                                              |
| User has no passkey / cannot use it                | Email OTP remains available                                                                         |
| User signs in with email OTP                       | Signed in; existing Organization TOTP policy still applies                                          |
| User signs in with password                        | Signed in; password remains optional; existing Organization TOTP policy still applies               |
| Organization does not require MFA                  | Any existing allowed sign-in method works normally                                                  |
| Organization requires MFA + passkey session        | No TOTP prompt                                                                                      |
| Organization requires MFA + email/password session | Existing TOTP/recovery-code flow remains unchanged                                                  |
| Passkey is lost                                    | Email OTP provides account recovery/fallback; Organization MFA may still require TOTP/recovery code |
| Platform Administrator                             | Existing Platform Administrator MFA behavior remains unchanged in this work                         |

A successful passkey must require **WebAuthn user verification**, not merely possession of an
authenticator. In `@better-auth/passkey@1.6.23`, configure registration with
`authenticatorSelection: { residentKey: "preferred", userVerification: "required" }`. Because Better
Auth hardcodes `userVerification: "preferred"` during authentication option generation and
`requireUserVerification: false` during verification, server-side assurance must explicitly enforce
`verification.authenticationInfo.userVerified === true` in `authentication.afterVerification` (or
before inserting the session assurance record). If a passkey authentication does not carry user
verification (e.g. a simple presence touch on a key without biometric or PIN verification), it must
not satisfy Organization MFA. ([Better Auth][1])

The current Better Auth 2FA plugin does **not** automatically challenge passkey sign-ins with TOTP,
which works in our favor. Passkey is a passwordless flow outside the credential-based 2FA gate.
([Better Auth][2])

---

## 1. Preflight and architecture record

Before editing:

1. Read root `AGENTS.md`, `apps/worker/AGENTS.md`, `apps/web/AGENTS.md`, `docs/goal/GOAL.md`,
   applicable auth ADRs, and the relevant parity entries.
2. Inspect Git status and preserve unrelated user work.
3. Treat this as a **material authentication/schema change** and follow the repository's
   material-change verification requirements. The repo explicitly requires forward-only migrations
   and comprehensive verification for authentication changes.
4. Add ADR 0042 (`docs/adr/0042-passkey-first-authentication.md`) documenting the new decision:

   - Passkeys are the preferred everyday authentication method.
   - Email OTP is the universal account fallback/recovery path.
   - Passwords remain optional.
   - A successfully user-verified passkey sign-in counts as satisfying Organization MFA.
   - Existing TOTP/recovery-code Organization MFA remains unchanged for non-passkey sessions.
   - Platform Administrator MFA is explicitly out of scope.

5. Update `apps/worker/AGENTS.md`. It currently states that email OTP is the primary sign-in method,
   so the repository policy would otherwise contradict the newly authorized design.
6. Search `CONTEXT.md`, parity YAML, runbooks, tests, and UI copy for other statements saying email
   OTP is the primary method and update only those that are now incorrect.

Do not modify `docs/goal/GOAL.md` unless inspection shows the authentication decision is directly
represented there.

---

## 2. Add Better Auth passkey support

Current authentication is centralized in `apps/worker/src/auth/config.ts`; it already configures
email OTP, organizations, passwords, and Better Auth TOTP.

Add the official Better Auth passkey plugin.

### Dependencies

Add the passkey package at the version compatible with the repo's pinned `better-auth` version,
currently `1.6.23`.

Update:

- `apps/worker/package.json`: add `@better-auth/passkey: "1.6.23"`
- `apps/web/package.json`: add `better-auth: "1.6.23"` and `@better-auth/passkey: "1.6.23"`
- root `package-lock.json` via `npm install`

Do not rely on workspace hoisting instead of correctly declaring package dependencies.

### Server configuration

In `apps/worker/src/auth/config.ts`:

- import `passkey` from `@better-auth/passkey`;
- add it to the Better Auth plugins;
- derive the RP ID with Public Suffix List (PSL) and localhost awareness:
  - if `productBaseDomain === "localhost"`: `rpID = "localhost"`;
  - if `productBaseDomain.endsWith(".workers.dev")`: `rpID = requestUrl.hostname` (because
    `workers.dev` is an eTLD on the Public Suffix List, and WebAuthn spec strictly forbids eTLD RP
    IDs);
  - otherwise: `rpID = productBaseDomain` (allows credentials to work across all Organization
    subdomains);
- use `requestUrl.origin` as the WebAuthn `origin`;
- use `"Choir Management"` as the `rpName`;
- configure registration
  `authenticatorSelection: { residentKey: "preferred", userVerification: "required" }`;
- configure `authentication.afterVerification` to verify
  `verification.authenticationInfo.userVerified === true`;
- leave authenticator attachment unrestricted so Apple/Google/Windows platform passkeys and security
  keys can work.

The app already constructs Better Auth dynamically from the request URL and supports canonical
product subdomains, so preserve that model rather than introducing a second host-resolution
mechanism.

Add focused tests for RP ID/origin resolution covering:

- localhost (expects `"localhost"`);
- product base hostname;
- canonical Organization subdomain;
- staging hostname;
- `workers.dev` hosts (must resolve to the specific host, never `"workers.dev"`);
- rejection of custom public domains for authenticated account use.

Better Auth supports a parent-domain RP ID for descendant origins, which is compatible with the
current canonical-subdomain model. ([Better Auth][1])

---

## 3. Add the passkey schema with a forward-only migration

Do **not** alter `0002_better_auth.sql`; applied migrations are immutable under repository policy.
The existing Better Auth migration contains no passkey table.

Create the forward migration:

`apps/worker/src/control/migrations/0018_passkey_authentication.sql`

Reconcile the schema against the pinned Better Auth 1.6 configuration and review for D1 conventions
(using `INTEGER` timestamps per migration 0008 and `STRICT` tables):

```sql
CREATE TABLE passkey (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL,
  counter INTEGER NOT NULL,
  deviceType TEXT NOT NULL,
  backedUp INTEGER NOT NULL,
  transports TEXT,
  createdAt INTEGER NOT NULL,
  aaguid TEXT
);

CREATE INDEX passkey_userId_idx ON passkey(userId);
CREATE UNIQUE INDEX passkey_credentialID_idx ON passkey(credentialID);

CREATE TABLE session_auth_assurance (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('passkey')),
  verified_at INTEGER NOT NULL
) STRICT;

CREATE INDEX session_auth_assurance_user_id_idx ON session_auth_assurance(user_id);
```

Better Auth documents this as a separate passkey table rather than an extension of the
credential/password account. ([Better Auth][1])

---

## 4. Add a server-owned authentication-assurance record

Do **not** try to infer "this session used a passkey" from browser state, user-agent information,
whether the user owns a passkey, or whether the passkey table contains credentials.

The server needs durable evidence that **this specific session** was established by successful
passkey authentication with verified user verification.

The `session_auth_assurance` table defined in migration 0018 resides in D1 because it is global
identity/authentication metadata, consistent with the Worker architecture.

Do not store biometric information, authenticator secrets, challenges, or raw WebAuthn payloads
here.

### Record assurance on successful passkey sign-in

Use a Better Auth **after hook** on `/passkey/verify-authentication`.

**Critical Implementation Note:** In `@better-auth/passkey@1.6.23`, the passkey sign-in endpoint is
`/passkey/verify-authentication` (NOT `/sign-in/passkey`). In Better Auth, `ctx.context.newSession`
is only set by core credential sign-ins; the passkey plugin returns `{ session, user }` directly in
the response. In an `after` hook, this is available on
`ctx.context.returned as { session?: { id: string; userId: string }; user?: { id: string } }`.

On a successful passkey login:

```text
if ctx.path == "/passkey/verify-authentication"
and ctx.context.returned?.session exists:
    insert into session_auth_assurance (session_id, user_id, method, verified_at)
    values (returned.session.id, returned.session.userId, 'passkey', now)
```

Important requirements:

- Write the assurance synchronously before authentication is considered complete.
- Do not send this work to a background task.
- Fail closed if the assurance write unexpectedly fails.
- Never permit a client request to set or upgrade its own authentication-assurance value.
- Foreign-key cascade (`ON DELETE CASCADE`) removes the assurance automatically when the Better Auth
  session is revoked.

No assurance record is created for email OTP or password sign-ins.

---

## 5. Centralize effective Organization MFA assurance

This is the most important backend change.

The current Organization authorization gate only recognizes `organization_mfa_assertions`, so even a
passkey-authenticated user would currently be rejected by an MFA-required Organization.

Create a small auth-domain helper, for example:

`apps/worker/src/auth/sessionAssurance.ts`

Its responsibility should be determining whether the current session provides acceptable
Organization MFA assurance.

Conceptually:

```text
effectiveOrganizationMfa =
    valid passkey session assurance
    OR
    valid existing organization_mfa_assertion
```

Do not scatter this decision across React components or multiple unrelated routes.

### Passkey semantics

For this implementation, define a passkey-created session as satisfying Organization MFA **for the
lifetime of that authenticated session**.

That gives the intended UX:

> Sign in with passkey → no additional authenticator-code prompt.

The existing TOTP assertion's 12-hour behavior remains unchanged for users who authenticated through
email OTP/password. `organizationMfa.ts` currently gives those assertions a 12-hour lifetime.

This deliberately means the two assurance mechanisms have different lifetimes:

```text
Passkey assurance -> tied to authenticated Better Auth session lifetime
TOTP/recovery assertion -> existing 12-hour Organization assertion
```

Do not silently convert TOTP to a seven-day assertion.

---

## 6. Change Organization authorization

Update `apps/worker/src/tenancy/authorizeOrganization.ts`.

Currently an MFA-required Organization rejects access unless an unexpired
`organization_mfa_assertions` row exists.

Update `authorizeOrganizationMember` to evaluate both assertions in a single D1 query by joining
`session_auth_assurance`:

```sql
SELECT m.organizationId, m.role, m.userId,
  o.mfa_required AS mfaRequired,
  oma.expires_at AS assertionExpiresAt,
  saa.method AS sessionAssuranceMethod
 FROM member m
 JOIN organizations o ON o.id = m.organizationId
 LEFT JOIN organization_mfa_assertions oma
   ON oma.organization_id = m.organizationId
   AND oma.user_id = m.userId
   AND oma.session_id = ?
 LEFT JOIN session_auth_assurance saa
   ON saa.session_id = ?
   AND saa.user_id = m.userId
 WHERE m.organizationId = ? AND m.userId = ?
 LIMIT 1
```

Change the authorization rule to:

```text
IF Organization does not require MFA
    authorize normally

IF Organization requires MFA
    authorize if:
        session has valid server-recorded passkey assurance (sessionAssuranceMethod == 'passkey')
        OR
        existing Organization TOTP/recovery assertion is valid (assertionExpiresAt > now)

otherwise
    return the existing "recent Organization MFA verification is required" failure
```

Verify the assurance row belongs to both the current `sessionId` and current `userId`.

Do not allow:

- assurance from another session;
- assurance from another user;
- possession of a registered passkey without a passkey-authenticated session;
- a client-supplied flag;
- Organization ID manipulation.

---

## 7. Update Organization MFA status and contracts

Update `apps/worker/src/auth/organizationMfa.ts` and `@choir/contracts`.

The existing implementation models only `totp | recovery_code`, checks Better Auth TOTP enrollment,
and uses Organization-specific MFA assertions.

Keep `recordOrganizationMfaAssertion()` restricted to TOTP/recovery codes.

Do **not** fake a passkey result by inserting `"totp"`.

Instead, extend the status result to distinguish effective assurance, for example:

```ts
type OrganizationMfaSatisfiedBy = "passkey" | "totp" | "recovery_code" | null;
```

Update `packages/contracts/src/auth.ts`:

- Update `organizationAuthStatusResponseSchema` to add
  `mfaSatisfiedBy: z.enum(["passkey", "totp", "recovery_code"]).nullable()`.
- Export updated contract types and run `npm run check:contracts:exports`.

Return enough information for the client to know:

```text
mfaRequired
mfaSatisfied
mfaSatisfiedBy
mfaVerifiedUntil
twoFactorEnabled
twoFactorVerified
```

For a passkey session, `mfaVerifiedUntil` should correspond to the session's expiration.

For a TOTP/recovery assertion, preserve the current assertion expiration.

---

## 8. Preserve the existing TOTP path exactly

Do not remove or weaken the current TOTP/recovery implementation.

`OrganizationMfaPrompt.tsx` currently provides authenticator-code and recovery-code verification.

For a non-passkey session at an Organization requiring MFA:

- continue requiring TOTP enrollment;
- continue accepting the 6-digit TOTP;
- continue accepting recovery codes;
- continue recording `organization_mfa_assertions`;
- keep the 12-hour assertion lifetime;
- preserve existing lockout behavior;
- preserve current recovery-code semantics.

A passkey-authenticated user should simply never reach this prompt while the passkey-authenticated
session remains valid.

---

## 9. Add a dedicated browser Better Auth passkey client

The web app currently uses a thin typed fetch layer rather than Better Auth's browser client. That
is fine for the existing auth endpoints.

Do not rewrite the whole browser auth layer.

Create a narrowly scoped client, for example:

`apps/web/src/auth/passkeyClient.ts`

Use `createAuthClient` plus `passkeyClient()` only for the WebAuthn operations that genuinely
benefit from Better Auth's browser implementation.

It should provide app-owned wrappers such as:

```text
signInWithPasskey()
addPasskey()
listPasskeys()
renamePasskey()
deletePasskey()
```

React components should consume these wrappers rather than importing Better Auth throughout the UI.

---

## 10. Make passkey the preferred sign-in UX

Refactor `apps/web/src/auth/SignInView.tsx`.

The current screen treats Email Code and Password as the sign-in methods and says email code is
primary.

Change the visual hierarchy to approximately:

```text
Sign in to Choir Management

[ Sign in with a passkey ]   <- primary

or

[ Send me an email code ]    <- fallback

Other sign-in options
Password
```

Requirements:

- The user should not have to type an email address before using a discoverable passkey.
- User cancellation of Face ID/Touch ID/Windows Hello is not an application error.
- A missing passkey should result in a friendly fallback message.
- Email OTP should remain obvious and easy to access.
- Password remains available but visually tertiary.
- Do not remove forgot-password behavior.
- Do not automatically create accounts; invitation-only behavior remains unchanged.

After the explicit button works reliably, enable Better Auth conditional UI where browser support
exists. Better Auth explicitly supports `autoFill: true` and conditional mediation. ([Better
Auth][1])

Do not allow multiple concurrent WebAuthn ceremonies from the explicit button and conditional UI.

---

## 11. Add passkey management to Account Security

Extend `apps/web/src/account/AccountSecurity.tsx`, which currently manages the optional account
password.

Add a **Passkeys** section above the optional password section.

Support:

- Add a passkey.
- List existing passkeys.
- Show a friendly name or authenticator-derived fallback label.
- Show creation date where available.
- Rename a passkey.
- Delete a passkey.
- Support multiple passkeys.
- Use an accessible destructive confirmation before deletion.
- If deleting the final passkey, explain that email-code sign-in remains available.

Do not require the user to have a password in order to add a passkey.

After a user signs in using email OTP and has zero passkeys, provide a non-blocking prompt such as:

> Make sign-in faster next time by adding a passkey.

Do not force enrollment.

---

## 12. Recovery behavior

Explicitly preserve this sequence:

```text
Lost passkey
    ↓
Sign in using email OTP
    ↓
Account access restored
    ↓
Add/re-register passkey
```

If the user's Organization requires MFA, email OTP **does not bypass Organization MFA**. They must
still satisfy the existing TOTP/recovery policy before accessing that Organization.

That distinction should appear in recovery copy so users are not told that an email code alone
bypasses an Organization's security policy.

---

## 13. Do not change Platform Administrator MFA in this PR

The app has a separate Platform Administrator MFA assertion model with a one-hour lifetime, TOTP
enrollment requirements, recovery-code confirmation, and privileged elevation.

Do not modify:

- `platform_mfa_assertions`
- Platform Administrator MFA enrollment
- one-hour verification freshness
- privileged elevation rules
- recovery-code requirements

A Platform Administrator who logs in with a passkey will still complete the existing Platform
Administrator MFA step when entering that privileged workflow.

That should be a separate security decision and PR if desired.

---

## 14. Tests

This change is not complete with unit tests alone.

### Migration/integration tests

Add coverage proving:

```text
MFA-required Organization + email OTP session + no assertion -> denied
MFA-required Organization + password session + no assertion -> denied
MFA-required Organization + valid TOTP assertion -> allowed
MFA-required Organization + valid recovery assertion -> allowed
MFA-required Organization + valid passkey session assurance -> allowed
MFA-required Organization + assurance for another session -> denied
MFA-required Organization + assurance for another user -> denied
MFA-required Organization + revoked/expired session -> denied
Organization without MFA + all existing auth methods -> unchanged
```

Test FK cleanup when a session is revoked.

Test that owning a passkey without having authenticated with it does **not** satisfy MFA.

### Better Auth integration tests

Verify:

- passkey plugin routes exist;
- registration requires an authenticated user;
- public signup remains disabled;
- successful passkey authentication creates the server assurance record;
- email OTP authentication does not create one;
- password authentication does not create one;
- passkey assurance cannot be created from request input.

### Browser E2E

Use Chromium's virtual WebAuthn authenticator support for real browser-flow coverage:

1. Sign in through existing fallback.
2. Register passkey.
3. Sign out.
4. Sign in through passkey.
5. Confirm authenticated state.
6. Enter an MFA-required Organization.
7. Confirm no Organization TOTP prompt appears.
8. Sign out.
9. Sign in through email OTP.
10. Enter same Organization.
11. Confirm existing Organization MFA prompt appears.
12. Complete TOTP/recovery flow and confirm access.
13. Delete passkey.
14. Confirm email OTP still works.

Include registration cancellation, login cancellation, unsupported browser state, duplicate passkey
registration, multiple credentials, and passkey removal.

For WebKit, do not pretend a mocked WebAuthn result proves passkey support. Test the fallback UI and
graceful capability handling there.

---

## 15. Accessibility and responsive requirements

Passkey support must preserve the repo's accessibility requirements. The scoped web instructions
require keyboard/focus/accessibility verification for changed browser flows.

Verify:

- keyboard operation;
- visible focus;
- useful button names;
- screen-reader status for WebAuthn success/error;
- cancelled native authenticator prompt does not produce an alarming `role="alert"` message;
- destructive passkey deletion uses the repository-owned confirmation primitive;
- mobile layout;
- dark/light themes;
- 200% zoom;
- Axe checks with zero new violations.

---

## 16. Documentation and parity

Update the auth documentation/parity evidence to reflect:

```text
Preferred: passkey
Fallback/recovery: email OTP
Optional: password

Organization MFA:
Passkey-authenticated session -> satisfied
Email OTP/password session -> TOTP/recovery policy
```

Do not describe passkeys as "biometric login." A passkey may use a device PIN or hardware security
key as well.

Do not state or imply that biometric data is sent to Choir Management.

---

## 17. Verification sequence

During development, run focused auth/config/migration/UI tests.

Before considering the material change complete, run:

```text
npm run format:check
npm run lint
npm run check:contracts:exports
npm run typecheck
npm test
npm run build
npm run test:integration
npm run check:parity
npm run check:parity:implementation
npm run test:e2e
```

Then run the repository's canonical browser-free gate:

```text
npm run check:ci
```

Before anything is pushed to `main` or promoted to staging, run:

```text
npm run check:release
```

Do not modify production. The current repository instructions explicitly limit the active target to
permanent staging.

---

## Definition of done

I would give the coding agent these final acceptance tests:

> A user with an existing account can register one or more passkeys without creating a password. The
> sign-in page presents passkey as the primary method, email OTP as the clear fallback/recovery
> method, and password as an optional alternative. A successful passkey login creates
> server-controlled evidence tied to that exact Better Auth session. When that session accesses an
> Organization requiring MFA, the passkey authentication satisfies the Organization MFA requirement
> without a TOTP prompt. Email OTP and password sessions continue to encounter the existing
> Organization TOTP/recovery requirement. No client-controlled value can claim passkey assurance.
> Removing or revoking a session removes its passkey assurance. Existing Platform Administrator MFA
> behavior remains unchanged. All migrations are forward-only, accessibility tests pass, tenant
> isolation is preserved, and the full repository release gate succeeds.

The **server-side session assurance record** is the part I would insist on. I would not implement
this by saying "the user has a passkey, therefore MFA is satisfied." It must be **this session was
actually authenticated with a user-verified passkey**, which gives you a much cleaner and safer
security model.

[1]:
  https://better-auth.com/docs/1.6/plugins/passkey?utm_source=chatgpt.com
  "v1.6 - Passkey | Better Auth"
[2]:
  https://better-auth.com/docs/plugins/2fa?utm_source=chatgpt.com
  "Two-Factor Authentication (2FA) | Better Auth"
[3]: https://better-auth.com/docs/concepts/hooks?utm_source=chatgpt.com "Hooks | Better Auth"
