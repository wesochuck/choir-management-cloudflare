# Coding-agent implementation plan: reusable Organization roster invite links

Repository: `wesochuck/choir-management-cloudflare` Prepared: September 10, 2026 Scope:
implementation plan only; no repository changes or deployments have been performed.

## 1. Goal and product contract

Allow an Organization Owner or Administrator to create a reusable invite link, share it outside the
application, and let a recipient verify their identity, enter their name, select their configured
part, and join that Organization's roster without administrator approval.

A successful first-time enrollment must produce all of the following:

- A verified global identity and a normal authenticated session, using the existing authentication
  system.
- Exactly one Organization Membership in Better Auth's `member` table, with role `member` for a new
  Membership.
- Exactly one appropriate Organization Profile in the target Organization's Durable Object.
- A correct `member.profileId` association.
- The selected, valid `voicePart`, an initial `Active` status, and safe member-level defaults.
- Durable audit attribution and an exactly-once invite admission record.
- A usable destination in the Organization, subject to existing MFA and module policies.

"Immediately" means the ordinary successful flow completes without a review queue, audition,
administrator email invitation, or manual profile-linking step. It does not mean anonymous
enrollment on a page GET, bypassing email verification, or pretending a partial backend operation
succeeded.

The shared link grants permission to request a member-level enrollment. It is not a login credential
and must never create a session as the person who created the link.

### Recommended version-one decisions

| Question                                          | Decision                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Who creates, views share URLs, and revokes links? | Organization Owners and Administrators, using existing authorization and MFA rules.                                |
| Who may redeem?                                   | A verified identity holding a valid link for that Organization.                                                    |
| Default expiration                                | Seven days; offer one, seven, and thirty days initially.                                                           |
| Use limits                                        | Optional positive integer; no link-specific limit by default, while preserving actual application capacity limits. |
| Assigned authorization role                       | Always `member` for a new Membership. Never a client-supplied role.                                                |
| Initial roster status                             | `Active`, using the normal status-history machinery.                                                               |
| Part                                              | Required selection from this Organization's eligible configured voice parts.                                       |
| Unknown part                                      | Do not turn an empty string into a performer. Defer a special "unassigned performer" model.                        |
| Phone                                             | Optional.                                                                                                          |
| Directory visibility                              | Explicit visible choice; use a privacy-preserving unchecked default for newly created profiles.                    |
| Marketing enrollment                              | None. Joining is not consent to marketing or permission to clear suppressions.                                     |
| Existing linked member                            | No new profile, no role/status overwrite, no additional use consumed.                                              |
| Existing unlinked member                          | Complete profile creation/linking when safe; preserve their existing authorization role.                           |
| Existing inactive or restricted person            | Do not silently reactivate or bypass restrictions.                                                                 |
| Revoke                                            | Stops admissions that have not crossed the documented admission commit point; does not remove admitted members.    |
| Existing invitation and audition flows            | Preserve them.                                                                                                     |
| Deployment                                        | Implement and test only. Any staging promotion needs its own authorization; production is excluded.                |

These are implementation defaults, not claims that every control already exists.

## 2. Repository evidence and implications

### 2.1 Existing invitations are recipient-specific

`apps/worker/src/routes/organizationInvitations.ts` requires an email and role, creates a Better
Auth invitation, seeds an unverified identity through `ensurePendingInvitationIdentity`, and uses
Better Auth acceptance for the recipient. The acceptance handler does not itself create a roster
profile or collect a part.

Relevant sources:

- `apps/worker/src/routes/organizationInvitations.ts`
- `apps/worker/src/routes/helpers/invitationHelpers.ts`
- `apps/web/src/auth/AcceptInvitationView.tsx`
- `apps/web/e2e/auth.invitations.spec.ts`

Build a distinct reusable roster-invite feature. Do not weaken the ownership checks on existing
email-addressed invitations or attempt to share one person's pending invitation among arbitrary
recipients.

### 2.2 Public signup is disabled

`apps/worker/src/auth/config.ts` disables normal email/password signup and automatic email-OTP
signup. Email one-time codes are the primary sign-in path. The code already supports controlled
creation of an unverified identity for an invited email.

Keep those global signup settings disabled. Add invitation-mediated identity bootstrap only after
server validation of the reusable link. Reuse Better Auth for code verification, sessions, and any
account MFA. Do not introduce another OTP/session implementation.

### 2.3 Membership and roster are different records

`apps/worker/AGENTS.md` identifies Better Auth's `member` table as authoritative and explicitly
prohibits using the obsolete `organization_memberships` table. Membership email/identity data live
in D1. Operational roster profiles live in each Organization's Durable Object.

Relevant sources:

- `apps/worker/src/tenancy/authorizeOrganization.ts`
- `apps/worker/src/tenancy/linkOrganizationProfile.ts`
- `apps/worker/src/organization/profiles.ts`
- `apps/worker/src/routes/organizationAccess.ts`

Do not stop after creating a Membership. Also do not move roster profile fields into D1 to simplify
this feature.

### 2.4 Parts already have an Organization-specific model

`packages/contracts/src/events.ts` defines:

- `sections`: `code`, `name`, `color`, `trackOnly`.
- `voiceParts`: `label`, `fullName`, `sectionCode`.
- `performerLabel` and roster automation settings.

`packages/contracts/src/profiles.ts` stores `voicePart` as a string. The existing mutation service
rejects parts that are not configured. Web policy states that performer eligibility is a nonempty
`voicePart`, not an authorization role.

Use configured labels as the existing storage contract requires. Do not add a hardcoded SATB enum or
a second section/part table. Show friendly full names, group by section where useful, and reuse
existing eligibility rules so track-only categories are not presented as human roster assignments.

### 2.5 `/join` is already in use

`apps/web/src/App.tsx` maps both `/join` and `/auditions` to `PublicAuditionView`. Preserve those
routes. Introduce `/join-roster` for this feature.

`apps/web/src/auth/postSignIn.ts` restricts return destinations. Integrate the new continuation
explicitly rather than weakening its redirect checks.

### 2.6 Existing signing and engineering infrastructure should be reused

`apps/worker/src/security/signedLinks.ts` already provides purpose-scoped HMAC signing, Organization
binding, expiration, resource identifiers, revocation values, and fixed-length signature comparison.

Root and scoped agent instructions require typed RPC for new Durable Object operations, Zod
boundaries, forward-only migrations, real SQLite/workerd SQL tests, tenant isolation, bounded
retries, accessible repository-owned UI, and the current local release gates.

The root `AGENTS.md` says GitHub Actions is disabled and controls staging promotion. Follow it over
older conflicting deployment prose in `README.md`.

## 3. User experience

### 3.1 Administrator experience

Add an "Invite by link" action to the roster workflow, near existing add/import/invite actions. Keep
email invitations available, especially for privileged roles and targeted profile-claim cases.

Use a repository-owned `Dialog` for link creation. Fields:

- Internal label, such as "September new singers"; bounded length.
- Expiration preset.
- Optional maximum uses.

Display fixed explanatory text: "Anyone with this link can verify their email and join this
Organization's roster as a member."

After creation, show the share URL in a selectable, labeled read-only field with a Copy button,
expiration, remaining capacity where relevant, and a revoke action. Report clipboard failures and
keep manual selection available.

Provide a management panel listing label, creator, created time, expiry, completed joins, admissions
still finishing, link status, and actions. Separate completed joins from merely pending attempts.
Use the shared sortable `DataTable` and its mobile-card behavior.

Revocation requires an accessible confirmation. Keep revoked/expired records for audit rather than
deleting them. A replacement action creates a fresh link; it must not accidentally make an old token
valid again.

### 3.2 Recipient experience

Use this sequence:

1. Open `/join-roster#token=<signed-token>` on the canonical Organization hostname.
2. Validate the link and show the Organization name and the nature of the invitation. Do not reveal
   its roster, inviter email, or member count.
3. For a signed-out recipient, enter email and verify with the existing sign-in code flow. For an
   authenticated recipient, show the current account and an explicit switch-account action.
4. Once the identity is verified, fetch the invite-scoped onboarding options and collect display
   name, required configured part, optional phone, and directory visibility.
5. Display a clear "Join [Organization]" button and submit an explicit mutation.
6. Show success only after membership, profile, and linking are complete. Confirm the part and
   provide a button to the member dashboard.

A first-time recipient should not have to find a separate registration screen or ask an
administrator to create an account. An already authenticated nonmember should not be sent through a
redundant email challenge when their current account satisfies the established verification and MFA
policy.

Do not force an already linked member to submit a part again. Show "You are already on this
Organization's roster" and a destination link. Preserve their current part, preferences, status, and
permissions.

### 3.3 Continuity and failure states

Preserve link context and nonsensitive form drafts across code resend, verification errors, account
MFA, account switching, reload, mobile background restoration, and a retry after a network failure.
Scope all continuation state to the origin and enrollment, with a short expiry. Never store OTPs,
auth tokens, or raw invite capabilities in general persisted-draft storage or analytics.

Retain the invite fragment during the enrollment view so a reload can recover. Clear transient form
data after completion or explicit cancellation. Do not apply token-stripping changes to existing
signed-link views.

Handle these distinct UI states: checking, unavailable/expired/revoked/exhausted invitation,
sign-in/code sent, verification failure, details form, already enrolled, part configuration changed,
existing-profile claim conflict, finalization pending, success, and retryable service failure.

A failed or interrupted admission should offer retry of the same enrollment. It must not suggest
generating another account or starting another profile.

## 4. Link model, storage, and API contracts

### 4.1 Reuse the signed-link format

Add the purpose `roster_invite` to the existing signed-link union. Issue an envelope containing:

- `organizationId` resolved by the server.
- `resourceId` equal to the invite-link ID.
- Fixed `issuedAt` and `expiresAt` values.
- A per-link unpredictable nonce and revocation value.
- The existing envelope version and algorithm.

Do not put email, a profile ID, a user's name, administrator permissions, or a session credential in
a reusable invite.

Persist the envelope inputs as link metadata, not the complete bearer token. An authorized share-URL
endpoint can reconstruct and sign the same immutable envelope, allowing Copy to work again after an
administrator reloads the page. Existing signing-secret rotation behavior remains in force; use
per-link revocation for individual links rather than rotating the application-wide secret.

Generate canonical-host links only. A custom public website domain must not gain authenticated
administration or member onboarding authority. Never derive the target Organization from a request
body or untrusted token without also matching the authoritative hostname resolution.

The fragment keeps the token out of ordinary HTTP URL paths and query strings. It does not protect
against page JavaScript, so avoid third-party tracking on the enrollment flow and redact request
bodies and error contexts. Post tokens in bounded JSON bodies to the application API. Previewing a
link must never enroll a user.

### 4.2 D1 control-plane tables

Use the next forward migration in the actual D1 migration sequence; do not guess a number or rewrite
a previous migration.

Proposed `organization_roster_invite_links` fields:

| Field group      | Contents                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Identity         | `id`, `organization_id`, internal label                                                                     |
| Attribution      | `created_by_user_id`, `created_at`                                                                          |
| Signature inputs | issued/expiry timestamps, nonce, revocation version                                                         |
| Lifecycle        | `revoked_at`, `revoked_by_user_id`                                                                          |
| Capacity         | nullable `max_uses`, committed admission count, active reservation count or equivalent transactional ledger |

The role is fixed in server code; do not expose an editable authorization role. A link's intrinsic
validity must be checked against the persisted record even when its signature is valid.

Proposed `organization_roster_invite_enrollments` control record:

- Stable enrollment ID, Organization ID, link ID, authenticated user ID.
- Stable target profile ID and eventual Membership ID.
- Idempotency key and a digest/version binding the prepared profile request.
- State and safe timestamps: `reserved`, `prepared`, `admitted`, `completed`, `canceled`,
  `needs_repair`, with an explicit already-enrolled outcome where useful.
- Reservation lease and fencing version.
- Whether a Membership predated this enrollment, so recovery never removes or downgrades it.
- Bounded retry metadata and a safe last error code.

Keep actual display name, phone, part selection, and profile preferences in the Organization store,
including any prepared profile draft. D1 may store coordination IDs and a request digest, not a
duplicate operational profile.

Enforce uniqueness for the Organization/user enrollment identity, idempotency keys, and the actual
Organization/user Membership invariant. Audit existing indexes/data before adding a uniqueness
constraint. Report inconsistent historical data rather than silently merging or deleting it.

Handle two different valid links redeemed simultaneously by the same identity: at most one
profile/admission, and only the winning link consumes a use.

### 4.3 Durable Object storage

Add a narrow enrollment-preparation table and schema registry entry. It should reserve the stable
profile identity and retain the operational draft until admission is committed or safely canceled.

Expose typed methods on `OrganizationStore`, implemented in a focused module such as
`rosterInviteEnrollmentStore.ts`:

```ts
getRosterInviteOptions(input);
prepareRosterInviteEnrollment(input);
commitRosterInviteEnrollment(input);
getRosterInviteEnrollmentResult(input);
cancelPreparedRosterInviteEnrollment(input);
```

Use real typed request/result interfaces and Zod validation, not untyped maps. Inputs carry
validated Organization and actor context supplied by the Worker. Every method independently verifies
the stored Organization identity.

Use short `storage.transactionSync` operations for local SQL. No provider calls, D1 queries,
external fetches, queue sends, or `waitUntil` inside the Organization object for this feature. The
Worker coordinates cross-store work.

### 4.4 Proposed HTTP surface

Names below are proposed, not existing routes.

| Method and route                                        | Authorization and purpose                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /api/organization/roster-invite-links`            | Owner/Admin; create link metadata and initial share URL.                                         |
| `GET /api/organization/roster-invite-links`             | Owner/Admin; bounded, paginated metadata only.                                                   |
| `POST /api/organization/roster-invite-links/:id/share`  | Owner/Admin; reconstruct the share URL; `no-store`.                                              |
| `POST /api/organization/roster-invite-links/:id/revoke` | Owner/Admin; idempotent revocation.                                                              |
| `POST /api/roster-invites/preview`                      | Valid capability and host; minimal Organization preview; no roster write.                        |
| `POST /api/roster-invites/start`                        | Valid capability, rate limits, email; bootstrap invited identity and initiate existing OTP flow. |
| `POST /api/roster-invites/options`                      | Verified session plus live invite; only eligible parts and onboarding options.                   |
| `POST /api/roster-invites/redeem`                       | Verified session plus live invite; details and idempotency key; perform/resume admission.        |
| `GET /api/roster-invites/enrollments/:id`               | Enrollment owner on the correct host; redacted completion status.                                |

Reuse normal Better Auth verification/session endpoints or a tested thin wrapper. Do not invent
another email-code format or expose server-only organization mutation APIs to browsers.

Create strict public request schemas in a focused `packages/contracts/src/rosterInvites.ts`, export
them from the existing barrel, and update the contract export snapshot when required. Reject extra
privileged fields instead of accepting the broad administrator profile request schema.

Use established `ProblemDetails` and request IDs, plus stable specific error codes. Return 201 for
first completed enrollment, 200 for idempotent completed/already-enrolled results, and 202 with
owned enrollment status when durable finalization is pending. Validate final response behavior
against repository conventions during implementation.

## 5. Identity bootstrap and authorization

### 5.1 Invite-mediated signup, not general registration

Refactor the identity-creation portion of `ensurePendingInvitationIdentity` into a narrow reusable
helper, preserving the old email-invitation cancellation behavior in its existing wrapper.

After link validation and abuse controls, insert an unverified identity only when the normalized
email has no existing identity. Reuse an existing identity without replacing its name, password,
email verification, MFA configuration, session state, or Organization relationships.

Send and verify sign-in codes through Better Auth and the existing platform email lane. Confirm that
calling server-side auth helpers does not bypass the rate limits enforced by HTTP middleware.
Explicitly test the resulting route-level limits.

Do not set `emailVerified` merely because someone possesses the link. A failed, expired, or
unverified challenge creates no Membership and no roster profile. Abandoned bootstrap identities
need a bounded cleanup policy that never deletes an identity which acquired legitimate account state
or Memberships elsewhere.

Return equivalent responses for previously known and new email addresses. An account can belong to
multiple Organizations, but an invite cannot expose those other Memberships.

### 5.2 Narrow onboarding authorization

The existing operational rule expects Membership before normal roster calls. Document a narrow
additional capability for verified invite recipients: they may read onboarding options and prepare
only their own roster enrollment in the invited Organization.

Do not bypass `authorizeOrganizationMember` globally and do not let any nonmember call ordinary
profile CRUD, directory, administration, or member APIs. The invite route must validate session,
capability purpose, canonical host, Organization, lifecycle, and user ownership before its limited
RPC.

Preserve account MFA during sign-in and Organization MFA for protected access. Where Organization
MFA can only be established after Membership, complete the safe enrollment and then use the existing
MFA gate; do not fake an MFA assertion or label the invite as MFA proof.

### 5.3 Safe profile defaults

Build the profile server-side from an explicit allowlist:

```ts
{
  displayName: validatedName,
  voicePart: validatedConfiguredPartLabel,
  phone: validatedOptionalPhone,
  showInDirectory: explicitDirectoryChoice,
  globalStatus: "Active",
  isSectionLeader: false,
  notes: "",
  statusIsManual: false,
  receiveAdminNotifications: false,
  receiveAttendanceReports: false,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false
}
```

Do not blindly use administrator-profile defaults: the current broad schema defaults some
administrative notification preferences to true. Preserve existing provider suppressions and
opt-outs; do not subscribe the person to campaigns, SMS, financial messages, or administrative
alerts.

Use the existing status audit path with a reason such as "Joined through roster invite". Test the
next scheduled automation pass for a newly enrolled performer; do not invent past attendance/RSVP
records or change the Organization's automation settings to make enrollment work.

## 6. Cross-store admission algorithm

D1 transactions and Durable Object transactions are separate. Neither a DO transaction nor a D1
batch can atomically commit the other store. Implement a small persisted, idempotent enrollment
state machine, not an undocumented sequence of independent writes.

The normal path should run synchronously within the request. Durable retry is only for interruption
or transient failure, not the ordinary meaning of "join."

### Step A: validate and find prior state

Resolve the Organization from the canonical host. Validate token purpose/signature and its persisted
record. Require a verified authenticated identity; derive user ID and email from the session, never
the request body. Check Organization/module availability, known restrictions, actual capacity
policy, and input bounds.

Look up an existing enrollment for this Organization/user before creating anything. A completed
result is returned idempotently. If an existing linked Membership/Profile already satisfies the
request, return already-enrolled without changing it or consuming a use.

A Membership with an existing linked inactive/manual-status Profile is not permission to reactivate
it. A removed/restricted identity must not use replay to bypass established restrictions. Reuse
existing restriction records; document and implement a minimal durable exclusion marker only if the
current removal semantics require one and no such record exists.

### Step B: reserve admission capacity in D1

Atomically create/reuse one enrollment and reserve a capacity slot, conditional on the link being
valid and its committed plus reserved admissions remaining below the limit.

Do not reserve on page preview, anonymous form entry, or code send. Reserve only for the verified
identity's explicit join request. Use finite leases and fencing values for uncommitted work.

Do not assume a SQL statement affecting zero rows throws. Conditional statements in a batch must
share an explicit guard; inspect the final state and affected-row results. All counters, enrollment
transitions, and control-plane audits must agree on the same winning transition.

### Step C: prepare the Organization Profile

Call a typed DO method using the stable server-generated profile/enrollment IDs. Validate the part
against current configuration and validate any existing-profile association. Store a prepared
operational draft without making it visible as a completed performer.

Reserve profile capacity if the application imposes a real capacity limit. The current 500-row
response/test envelopes are not proof that 500 is the permitted Better Auth membership capacity.
Determine and honor the installed auth configuration's real limits as well as roster constraints.

Repeated preparation with the same enrollment and identical input returns the same result. Different
input with the same key must be explicitly versioned or rejected, not quietly produce a second
profile.

Protect part referential integrity between preparation and commit. Reuse the existing "part in use"
constraint mechanism for prepared assignments or implement equivalent bounded reservations. A
removed/renamed part must not silently become an arbitrary string after admission.

### Step D: commit the admission decision

Revalidate revocation, expiration, Organization state, restrictions, and reservation ownership in
D1. Atomically move the enrollment to `admitted`, account for one committed use, and persist
sufficient durable recovery state.

This is the documented admission commit point. Revocation before this point prevents enrollment.
Revocation after this point stops new admissions but does not undo this accepted one. An admitted
enrollment can resume with its verified owner's session even if the share link subsequently expires.

Use counts represent committed admissions, with completed and finishing states reported separately.
Failed pre-admission attempts and already-enrolled users consume no use. Do not refund an uncertain
admitted attempt merely because its HTTP response was lost.

### Step E: establish the Membership

Prefer the existing supported server-side Better Auth membership mechanism, including `addMember` if
supported by the installed version, behind a narrow enrollment service. Always supply the validated
user and Organization IDs and role `member`; do not expose that server API directly to browsers.

Treat this as another idempotent saga step, not as part of an imaginary transaction with the DO.
Before retrying, reread membership state. Enforce or verify the Organization/user uniqueness
invariant under competing admission and email-invitation requests. Preserve any legitimately
existing Owner/Admin role rather than downgrading or duplicating it.

Do not link to a merely prepared draft. The existing profile-linking helper first verifies that the
profile exists in the Organization store; perform final linkage after the local profile commit in
Step F. If introducing a direct D1 membership adapter is necessary to satisfy the transaction
design, document that decision and test it against the installed Better Auth schema, hooks,
membership limits, and APIs; do not write a parallel authorization model.

Newly created invite Memberships that are still finalizing must not expose partially initialized
operational access. Gate their readiness through the persisted enrollment state. Do not revoke or
gate an unrelated preexisting administrator Membership while repairing its roster link.

### Step F: commit the profile, link it, and complete enrollment

After admission and the Membership identity are confirmed, idempotently commit the prepared profile
in the Organization store. The local commit creates exactly one new profile with the validated part
and safe defaults and writes its local audit/status history. Never reactivate or overwrite a
preexisting profile as a side effect.

Now verify the committed profile exists and link the Membership conditionally: null to this profile,
or already this profile, is acceptable. A different linked profile is a conflict, not permission to
replace it. Preserve the existing linking checks and audit semantics; do not bypass the
profile-existence check.

Mark enrollment complete in D1 only after confirming the committed profile and correct linkage,
coupling the final conditional linkage, audit, and readiness transition transactionally where
possible. Release the new-Membership readiness gate and return success. Invalidate/refetch client
queries for roster, current profile, membership context, dashboard counts, and directory where
relevant.

If any post-admission step fails, retain the same enrollment and return a recoverable pending state,
not false success or a new enrollment form.

### Step G: durable reconciliation and safe compensation

Persist recoverable state before queue submission. Use a stable job key such as
`roster-enrollment:<organizationId>:<enrollmentId>`, bounded retries, and the existing
retry/dead-letter conventions. A bounded Worker-side sweep must recover pending records whose queue
submission was interrupted; a `waitUntil` promise alone is not a durable repair mechanism.

Run D1 and provider coordination Worker/queue-side. The DO only performs its local operations and
uses existing scheduler helpers when necessary; it does not start another alarm owner or invoke
providers.

A terminal rejection before admission may cancel a prepared draft and release its reservation with a
fenced compare-and-swap. After admission, prefer finishing accepted work. Any terminal compensation
must prove ownership of every record it changes and must never delete the global identity, an
existing Membership, an imported profile, or an unrelated admission. Keep irreconcilable states
visible for operator repair rather than swallowing them.

## 7. Existing roster records and duplicate handling

Do not claim an unlinked profile solely because someone entered the same name. The current
profile/email split means an imported profile may not have a verifiable email association.

Safe rules:

- Existing account, different Organization: reuse the identity but create only the target
  Organization's local Membership/Profile.
- Existing Membership and linked Profile: return existing result without overwriting anything.
- Existing Membership without Profile: create/link once, preserving role, unless a trusted
  association points to an existing local profile.
- Existing verified, unique local association: claim/link only under a tested ownership rule and
  only when not already linked to another identity.
- Ambiguous or name-only imported match: never auto-merge or expose roster candidates publicly. Use
  a targeted administrator-mediated claim/link workflow instead.
- Two different people with the same name: do not merge them.
- A profile linked to a different account: refuse reassignment through the shared link.

The ordinary genuine-new-person path remains immediate; an ownership conflict is an exception, not a
general approval requirement.

## 8. Security and privacy requirements

Enforce canonical-host resolution before storage selection and compare token Organization to that
host on every capability operation. Altered Organization IDs, tokens copied onto another
Organization's hostname, public custom-domain replays, or mismatched enrollment ownership must fail
closed.

Keep CSRF/origin protections for all mutations, including cookie-authenticated redemption. A shared
token is not a substitute for request-origin validation. Bound token length, JSON body size,
name/phone length, list sizes, numeric limits, and page sizes with strict contracts.

Rate-limit preview/start/code resend/redemption independently by an appropriate combination of IP,
Organization, link, identity/email, and endpoint. Do not rely on a single per-IP limit to protect a
link shared widely. Reuse the current abuse-control infrastructure; introduce an external challenge
only when needed and within configured capabilities.

Use `Cache-Control: no-store` on capability responses, share URLs, auth-related responses, and
enrollment states. Apply `Referrer-Policy: no-referrer` to the enrollment page and prevent indexing.
Do not log tokens, OTPs, full request bodies, or sensitive profile drafts. Log request ID,
Organization ID, invite ID, enrollment ID, actor ID, and safe outcome codes instead.

Keep anonymous preview inexpensive: D1 invitation/Organization metadata and existing safe published
branding are sufficient. Fetch authoritative operational part options only after verified identity
plus invite-scoped authorization. Do not add an anonymous per-page-load scan or heavy DO call.
Joining must still work when the public website is unpublished.

Never modify existing email suppression, campaign subscriptions, SMS permissions, administrative
notification subscriptions, session permissions, or privilege grants just because a link was
redeemed.

## 9. File responsibility map

Existing files below were observed during review. New paths are proposed and may be adjusted to the
repository's current module organization without changing responsibilities.

| Area                   | Existing touchpoints                                                                                 | Proposed addition / responsibility                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Contracts              | `packages/contracts/src/index.ts`, `profiles.ts`, `events.ts`                                        | New `rosterInvites.ts` and focused tests; strict request/result contracts.                     |
| Link security          | `apps/worker/src/security/signedLinks.ts` and tests                                                  | New purpose plus resource/revocation/Organization tests.                                       |
| Identity bootstrap     | `apps/worker/src/auth/config.ts`, `routes/helpers/invitationHelpers.ts`                              | Extract narrow invited-identity helper; preserve existing auth configuration.                  |
| Link management        | `apps/worker/src/routes/organizationInvitations.ts` as pattern                                       | New `routes/organizationRosterInviteLinks.ts`; do not overload recipient-specific invitations. |
| Recipient HTTP flow    | `apps/worker/src/router.ts`, existing route-group registration                                       | New `routes/rosterInviteEnrollment.ts`; register canonical-host endpoints.                     |
| D1 coordination        | Current control-plane and migration conventions                                                      | New focused module under `src/control/` for link/enrollment lifecycle and reconciliation.      |
| Membership linking     | `src/tenancy/linkOrganizationProfile.ts`, `authorizeOrganization.ts`, `routes/organizationAccess.ts` | Idempotent linking, enrollment readiness, preservation of existing roles.                      |
| Operational enrollment | `src/organization/OrganizationStore.ts`, `migrations.ts`, `profiles.ts`                              | New `rosterInviteEnrollmentStore.ts`, typed RPC methods, prepared/local commit helpers.        |
| Durable recovery       | `src/jobs/contracts.ts` and current consumer/scheduler registration                                  | Enrollment-repair job and bounded recovery of unsent/pending work.                             |
| Recipient UI           | `apps/web/src/App.tsx`, `auth/SignInView.tsx`, `auth/postSignIn.ts`                                  | New `auth/JoinRosterView.tsx`; explicit continuation and safe routing.                         |
| Admin UI               | Current roster and invitation administration views                                                   | New focused invite-link panel/dialog near the roster; shared UI primitives.                    |
| Browser client         | `apps/web/src/api/` and shared query-key registry                                                    | Typed invite client and invalidation rules.                                                    |
| Evidence/docs          | `docs/goal/GOAL.md`, relevant accepted ADRs, parity matrix                                           | Narrow onboarding decision, routes, tests, runbook, responsibility map where required.         |

Keep entrypoints thin. Do not add hundreds of lines to `OrganizationStore.ts`, `router.ts`,
`App.tsx`, or a large roster component. Preserve existing size and runtime-boundary gates.

## 10. Implementation sequence and agent assignments

### Phase 0: bounded discovery and design lock

Read root/scoped AGENTS files, the durable goal, accepted applicable ADRs, relevant parity entries,
current auth package version, migrations, roster eligibility helpers, member removal semantics, and
current test harnesses. Record `git status` and `git rev-parse HEAD` before edits; preserve
unrelated changes.

Confirm the proposed defaults and record the narrow invite-mediated enrollment authorization
decision. Verify the supported Better Auth server APIs against the locked dependency version,
including email verification, account MFA, member creation, hooks, uniqueness, and capacity limits.

Deliverable: a feature design note, route contract, data/state transition sketch, and failing
acceptance tests. Do not restart the broader Cloudflare rebuild or legacy discovery.

### Phase 1: contracts, signing, and migrations

Add strict contracts, the signed-link purpose, forward-only D1/DO schema changes, indexes, and
state-transition helpers. Test migration replay and rollback compatibility with the previously
deployed code/schema expectations.

Deliverable: validated models and real-SQL tests, with no public registration enabled.

### Phase 2: administrator link lifecycle

Implement create/list/share/revoke, authorization, safe token reconstruction, capacity metadata, and
audit. Add the admin panel/dialog with bounded lists, expiry controls, copy fallback, accessible
confirmation, and light/dark/mobile coverage.

Deliverable: admins can manage links, but the feature remains guarded until enrollment is end-to-end
safe.

### Phase 3: invite-aware authentication and options

Implement preview, gated identity bootstrap, existing OTP/session integration, invite-scoped
options, safe continuation, and session switching. Preserve account MFA and generic signup
prohibitions.

Deliverable: new and existing accounts reach the details form safely without Organization Membership
yet.

### Phase 4: enrollment and recovery engine

Implement reservations, DO preparation, the admission commit point, supported Membership creation,
conditional profile linking, local finalization, readiness, and durable repair. Fault-inject after
every persisted boundary.

Deliverable: real D1/DO tests prove exactly-one profile/Membership, correct use accounting, and
recovery without loss or unauthorized side effects.

### Phase 5: recipient experience and integration

Complete the name/part/phone/privacy form, success and error states, pending-state recovery, query
invalidation, and dashboard handoff. Keep `/join` auditions and `/accept-invitation` behavior
unchanged.

Deliverable: the normal new-person path is entirely self-service and reaches a usable roster-backed
member account.

### Phase 6: adversarial qualification and documentation

Run the test matrix below, update parity/route evidence and operational repair documentation, run
required gates, and report exact outcomes. Keep the rollout disabled until end-to-end qualification
passes.

A backend agent and a frontend agent can work in parallel only after Phase 1 contracts are settled.
Assign one integration owner to auth, migrations, enrollment state transitions, and shared
entrypoints. Give a separate reviewer the isolation and fault-injection matrix. Avoid concurrent
edits to the same large files.

## 11. Test matrix

### Contracts and eligibility

- Reject missing/blank name, overlong inputs, invalid use limits, unsupported expiry, malformed
  tokens, and unknown privileged fields.
- Accept configured non-SATB parts and display the Organization's terminology.
- Reject another Organization's label, missing parts, track-only assignments where excluded by
  current domain rules, and a stale removed part.
- Assert safe defaults explicitly, including false administrative notification preferences and no
  privilege flags.

### Authentication

- Brand-new email: valid invite -> unverified identity bootstrap -> real existing OTP path ->
  verified session -> join.
- Existing verified account, existing unverified account, and already signed-in account.
- OTP wrong, expired, exhausted attempts, resend, delivery failure, session expiry, and account MFA.
- No valid invite: signup remains disabled and no profile/Membership is created.
- Email verification never follows merely from presenting the invite token.
- Switching accounts preserves the invite but cannot reuse another identity's enrollment.
- Existing accounts retain global name, password, MFA, and other Organization relationships.

### Functional and duplicate cases

- New member appears in the roster with `Active`, correct part, correct `member.profileId`, and role
  `member`.
- Existing global account joins a second Organization without cross-tenant profile sharing.
- Existing linked member consumes no use and changes no role, status, part, or preference.
- Existing unlinked member creates/links one profile and preserves an Owner/Admin role.
- Trusted existing-profile claim succeeds once; ambiguous/name-only or already-claimed profile fails
  safely.
- Same name for two genuine people remains two separate identities/profiles.
- No audition, automatic event RSVP, past attendance, marketing contact, or SMS enrollment is
  created.
- Initial roster automation does not incorrectly treat pre-join history as the new performer's
  absences.

### Concurrency and fault injection

- Two different users race for the final allowed use: at most one admission.
- Same user double-clicks, refreshes, retries after timeout, or uses two tabs: one
  enrollment/profile/Membership/use.
- Same user races through two different invite links: only the winning admission consumes a use.
- Existing email invitation and shared-link redemption race: no duplicate or role downgrade.
- Revocation or expiry wins before admission commit: no admission; prepared work safely canceled.
- Revocation/expiry follows admission commit: accepted enrollment can finish without another use.
- Drop the response after every D1 write, DO preparation, Membership creation, profile link, DO
  commit, and final completion write.
- Restart the Worker or evict the DO between steps; recovery is driven by persisted state.
- Queue duplicate delivery, failed queue submission, exhausted retries, lease expiry, and stale
  fenced worker.
- A changed part configuration cannot leave a silently invalid profile assignment.
- A failed cancellation never deletes an existing identity/Profile/Membership.
- A request returns success only when both stores and the linkage are complete.

### Authorization and privacy

- Ordinary member cannot create, view, reconstruct, or revoke admin-managed share URLs.
- Administrator from Organization B cannot manage Organization A's links.
- Tampered purpose, Organization, link ID, signature, expiry, or revocation value is rejected.
- Replay on a different canonical host or a custom public domain is rejected.
- Submitted `organizationId`, `userId`, `profileId`, role, section-leader flag, status, notes, or
  admin-notification flags cannot override server choices.
- Enrollment status cannot be read by another user or another Organization.
- GET, HEAD, link previews, browser prefetch, and repeated preview requests do not consume uses or
  write roster profiles.
- CSRF/cross-origin mutation tests fail closed.
- Captured logs, response caches, and browser telemetry contain no invite tokens, OTPs, or sensitive
  drafts.
- Provider suppressions, opt-outs, and existing directory choices are never silently reset.

### Browser and accessibility

- Use both existing strict API mocks for UI states and at least one full-stack real D1/DO/OTP test
  using the repository's safe provider fixture, not an all-mocked enrollment.
- Test desktop and narrow mobile layouts, light/dark themes, keyboard-only flow, visible focus,
  screen-reader labels, announced errors/status, clipboard fallback, and dirty-form cancellation.
- Run axe with no violations on the new states and perform manual keyboard checks; automated scans
  are not the sole accessibility evidence.
- Reload, navigate back, background/restore a tab, complete MFA, and switch accounts without losing
  the intended Organization or selected draft values.
- Existing `/join` auditions, targeted invitations, sign-in redirects, roster edits, and member
  profile screens remain working.

SQL behavior must run against actual migrations with Node SQLite or workerd/`runInDurableObject`. Do
not mock SQL by matching query strings.

## 12. Gates, rollout, and completion report

Run focused tests while iterating. Use the actual root scripts and scoped policies at implementation
time. At minimum, relevant material-change verification includes:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run check:do-runtime
npm run check:parity
npm run check:parity:implementation
npm run build
npm audit --audit-level=high
```

Before a main-branch push or release-bound handoff, run the complete current local gate:

```bash
npm run check:ci
npm run test:e2e
```

Install the repository's required Chromium build when browser tests need it. Follow any current
build-before-prepared-integration ordering. Do not weaken gates or add GitHub Actions workflows.

Use an environment-level rollout control that blocks new link creation, identity bootstrap, and new
admissions when disabled while allowing safe completion/repair of previously committed admissions.
This feature should not require a new public cloud service. Keep local email captured/fake and
staging messages inside existing sandbox controls.

Rollback must preserve forward schema compatibility and enrolled members. Disabling the feature must
not delete profiles or Memberships. A version rollback must not strand admitted records that the
previous version cannot understand; the rollout plan must retain a compatible repair path or drain
pending enrollments before rollback.

Do not deploy as part of this implementation request. Staging promotion follows its separate
authorized guarded workflow, and production remains out of scope.

### Definition of done

An administrator creates and copies a reusable link. A genuinely new recipient opens it on a phone,
verifies email, enters their name, selects a configured part, and clicks Join. They immediately
appear as an Active performer in the correct Organization's roster, their normal member account is
linked to that profile, and they can proceed through existing MFA/access policy to the member
workspace without administrator intervention.

The same link supports additional authorized admissions within its limits. Repeated submissions do
not duplicate data or uses. Revocation, expiration, wrong-host replay, privilege injection,
ambiguous existing-profile claims, and interrupted cross-store operations behave as specified.

The coding agent's final report must include changed files, requirement/test mapping, checks run
with exact results and skip reasons, migration/rollback implications,
tenant/auth/accessibility/performance risks, recovery/runbook instructions, and any unresolved
issue. Do not describe a test as passing unless it was actually run.

## External references checked during planning

Repository evidence is identified by path above; the coding agent must recheck current HEAD before
implementation. Official platform documentation was checked on September 10, 2026. Validate
installed dependency behavior rather than assuming online docs exactly match the lockfile.

```text
https://github.com/wesochuck/choir-management-cloudflare
https://better-auth.com/docs/plugins/email-otp
https://better-auth.com/docs/plugins/organization
https://developers.cloudflare.com/d1/worker-api/d1-database/
https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
```

Cloudflare documents D1 `batch()` as transactional within D1 and DO `transactionSync()` as
synchronous local storage transactions. Better Auth documents email-OTP signup controls and
server-only member addition. These are separate boundaries; none is a cross-D1/DO distributed
transaction.
