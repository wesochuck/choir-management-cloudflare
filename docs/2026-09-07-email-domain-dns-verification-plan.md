# Email Domain DNS Verification Extraction Plan

- **Status:** Proposed — not implemented. This document is implementation guidance only; do not
  build the changes until explicitly authorized.
- **Date:** 2026-09-07
- **Scope:** Close `DO-IO-001` by moving DNS-over-HTTPS verification out of `OrganizationStore`,
  make email-domain verification exact and stale-safe, and keep the D1 domain registry consistent
  with the Organization Durable Object without changing the public verification response contract.
- **Related plan:** `docs/2026-09-07-do-lifetime-guards-plan.md`.
- **Decisions locked:** Worker-side code owns DNS network I/O. The Organization Durable Object owns
  durable email-domain configuration and verification state. New DO operations use strongly typed
  Cloudflare Workers RPC. Resolver/transport failures do not downgrade a domain. Stale DNS results
  can never overwrite newer domain configuration. The existing public verify endpoint remains
  synchronous/manual; do not introduce a queue or Workflow for this work.

## 1. Background and findings

The current email-domain verification path performs DNS-over-HTTPS inside the Organization Durable
Object:

1. `POST /api/organization/email-settings/verify` authorizes the request in
   `apps/worker/src/routes/organizationEmailSettings.ts`.
2. The route invokes `/internal/email-settings/verify` through the Organization RPC adapter.
3. `verifyOrganizationEmailDomainInStore()` in
   `apps/worker/src/organization/organizationEmailSettingsStore.ts` reads the configured domain and
   DNS records from DO SQLite.
4. `checkSingleDnsRecord()` calls `https://cloudflare-dns.com/dns-query` with a five-second timeout.
5. The DO stores per-record status plus aggregate `custom_domain_status`.
6. The Worker route separately updates `CONTROL_DB.organization_email_domains` only when all records
   are valid.

This creates both an architectural issue and correctness gaps.

### 1.1 Architectural issue: external DNS I/O runs inside the DO

The DoH `fetch()` is the named `DO-IO-001` exception in the DO runtime-boundary plan. It keeps the
DO activation busy while the DNS request is outstanding and makes a network provider concern
reachable from the OrganizationStore runtime graph.

The desired ownership is:

- **Durable Object:** authoritative Organization email-domain configuration and verification state.
- **Worker route/orchestrator:** external DNS resolution and control-plane D1 synchronization.
- **D1:** derived control-plane index of Organization/domain/status; never the source of operational
  email settings.

### 1.2 Current DNS validation is too weak

`checkSingleDnsRecord()` currently marks a record `valid` whenever the DoH response contains any
`Answer` entry. It does not prove that the returned answer matches the expected:

- owner/name;
- record type;
- TXT value;
- MX priority;
- MX exchange/target.

The replacement must validate the exact required DNS record rather than merely proving that some DNS
answer exists.

### 1.3 Current verification can commit a stale result

The DO currently:

1. reads the configured domain;
2. waits for external DNS requests;
3. updates the row by `organization_id`.

If the domain configuration changes while the DNS requests are in flight, the older result can write
verification state back onto the newer configuration. Moving network I/O to the Worker makes the
boundary clearer, but the replacement must still defend against this race explicitly.

### 1.4 Current D1 mirror can become stale

The public route currently updates `organization_email_domains` to `active` only when verification
succeeds. A later conclusive failed verification can change the DO state while the D1 row remains
`active`.

The settings PUT path also treats the D1 table as a best-effort mirror and swallows write failures.
When a custom domain is inserted, `ON CONFLICT(domain)` changes only `organization_id`; it does not
reset status/verification state. The implementation must centralize and make the mirror semantics
explicit instead of adding another one-off D1 write.

The current D1 schema stores `status` as unconstrained text, so `pending`, `active`, and `degraded`
can be represented without a schema migration. Do not add a migration solely to introduce the
`degraded` value.

### 1.5 Existing safe sender behavior should be preserved

The public contract already supports:

- record states: `pending | valid | invalid`;
- domain states: `none | pending | active | degraded`.

Delivery code uses the custom sending domain only when `customDomainStatus === "active"`. A
`degraded` domain therefore naturally falls back to the platform sender. Preserve that behavior.

## 2. Target architecture

The public verification request should become a three-stage orchestration:

```text
POST /api/organization/email-settings/verify
        |
        v
1. DO RPC: prepareEmailDomainVerification()
        |
        | current domain + expected DNS records + configurationId
        v
2. Worker: resolveEmailDomainDnsRecords()
        |
        | exact, bounded DoH checks
        v
3. DO RPC: commitEmailDomainVerification()
        |
        | compare configurationId, commit only if still current
        v
4. Worker: synchronize organization_email_domains in D1
        |
        v
public response (existing contract)
```

### 2.1 Required invariants

After implementation:

1. No DNS/network `fetch()` is reachable from the `OrganizationStore` runtime dependency graph.
2. DNS verification is performed only after the route has authorized the Organization-scoped
   request.
3. The Worker verifies the exact required DNS data, not merely the presence of an answer.
4. A DNS result prepared for configuration A cannot mutate configuration B.
5. Resolver/transport uncertainty does not change durable record/domain status.
6. A conclusive failed re-check of a previously active domain changes it to `degraded`, preserving
   the timestamp of the last successful verification.
7. The custom sending domain is usable only while DO status is `active`.
8. D1 is synchronized after a successful DO commit and reflects non-active status as well as active
   status.
9. Public response shape remains `organizationEmailDomainVerifyResponseSchema`.
10. No queue, alarm, Workflow, or periodic DNS monitor is added by this plan.

## 3. Verification-state semantics

### 3.1 Record result

For each expected record:

- **`valid`:** an answer for the expected owner/type exactly matches the expected value; MX also
  matches expected priority.
- **`pending`:** the DNS response is conclusive but the expected RRset is absent, including normal
  not-yet-propagated/NODATA/NXDOMAIN outcomes.
- **`invalid`:** the expected owner/type has a conclusive answer set, but the required value is not
  present.

Do not invent an `unknown`/`error` record state in the public contract. Resolver failures are
handled at the attempt level and are not committed.

### 3.2 Attempt-level resolver failure

Treat the verification attempt as **inconclusive** when the resolver itself cannot provide a
trustworthy answer, for example:

- timeout/abort;
- network exception;
- non-success HTTP response;
- malformed or oversized DoH JSON;
- unsupported/unexpected resolver response code indicating server failure rather than record
  absence.

For an inconclusive attempt:

- do not call the DO commit RPC;
- do not update `lastCheckedAt`;
- do not change record statuses;
- do not change `customDomainStatus`;
- do not update D1 status;
- return a typed/service-unavailable response from the public route.

A resolver outage must never turn an active domain into degraded.

### 3.3 Aggregate domain result on a conclusive attempt

When the DO commits a conclusive result:

- all records valid -> `active`;
- not all valid and current status has never been `active`/`degraded` -> `pending`;
- not all valid and current status is `active` or `degraded` -> `degraded`.

Timestamp behavior:

- `lastCheckedAt` = this conclusive attempt time;
- `verifiedAt` = this attempt time when all records are valid;
- on `pending`/`degraded`, preserve the previous `verifiedAt` so it remains the time of the last
  successful verification;
- changing/removing the configured domain continues to reset `verifiedAt` through the normal
  settings update path.

## 4. Implementation work

### 4.1 Introduce a verification configuration identity

The prepare/commit split needs an optimistic-concurrency token that represents only the settings
that affect DNS verification.

Create a deterministic `configurationId` from the canonical verification configuration:

- normalized custom domain;
- expected DNS record owner/name;
- record type;
- record value;
- MX priority when applicable;
- record purpose.

Do **not** include:

- current per-record status;
- `fromName`;
- `replyToEmail`;
- `lastCheckedAt`;
- `verifiedAt`;
- general row `updated_at`.

This allows an unrelated sender-name/reply-to edit during a DNS lookup without unnecessarily
invalidating the result.

Recommended implementation:

1. Build a stable canonical JSON representation sorted by a deterministic record key.
2. Hash it with SHA-256 to produce a compact `configurationId`.
3. Treat the ID as a concurrency/version token, not a secret or authentication credential.
4. The DO must recompute the ID from its current authoritative configuration during commit; never
   trust the Worker merely because it returns an ID previously issued by the DO.

Today `generateRequiredDnsRecords(domain)` is the source of the expected records. The configuration
identity must ignore each record's mutable `status`. If provider-issued/domain-specific DNS values
are introduced later, include those authoritative values in the identity.

### 4.2 Add strongly typed DO prepare/commit RPC methods

Add new strongly typed public methods on `OrganizationStore`; do not add another internal HTTP
`fetch()` route for this feature.

Suggested shape:

```ts
prepareEmailDomainVerification(input: {
  readonly organizationId: string;
}): PreparedEmailDomainVerification

commitEmailDomainVerification(input: {
  readonly checkedAt: string;
  readonly configurationId: string;
  readonly dnsRecords: readonly OrganizationEmailDomainDnsRecord[];
  readonly organizationId: string;
}): EmailDomainVerificationCommitResult
```

Use shared pure schemas/types for the RPC payloads. Keep that module free of Worker providers and
network calls so it is safe in the DO runtime graph.

#### Prepare behavior

The DO prepare method must:

1. verify the requested Organization matches the stored Organization identity;
2. read current email-domain settings;
3. fail with a typed `no_custom_domain_configured` result if none is configured;
4. derive the authoritative expected records for the current domain;
5. compute `configurationId` from verification-relevant fields only;
6. return the normalized domain, expected records, and `configurationId`.

Do not mutate verification state during prepare.

#### Commit behavior

The DO commit method must:

1. verify Organization identity again;
2. read the current custom-domain configuration;
3. recompute the current `configurationId`;
4. return `409 stale_email_domain_verification` with **no mutation** when the IDs differ;
5. validate the submitted result set against the current expected record set:
   - no missing required record;
   - no extra record;
   - owner/type/value/priority/purpose still match the authoritative expected record;
   - only `status` may differ;
6. apply the aggregate-status rules in §3.3 in one short transaction;
7. return the committed public verification state plus the current custom domain and `verifiedAt`
   needed for D1 synchronization.

Two concurrent verification attempts for the **same** configuration may both commit; the operation
must be idempotent with respect to configuration and should not create duplicate side effects.

### 4.3 Move DNS resolution to a Worker-side adapter

Create a Worker-side module, suggested location:

`apps/worker/src/communications/emailDomainDns.ts`

It must not be imported by `OrganizationStore` or any module in its runtime dependency closure.

Suggested interface:

```ts
resolveEmailDomainDnsRecords(
  records: readonly OrganizationEmailDomainDnsRecord[],
  options?: { readonly fetcher?: typeof fetch },
): Promise<EmailDomainDnsResolutionResult>
```

Use dependency injection or the Cloudflare test fetch mock so tests never depend on public DNS.
Production code may default to `globalThis.fetch`.

#### DoH request requirements

Continue using the existing Cloudflare JSON DoH endpoint for this plan unless implementation-time
provider documentation requires a compatible adjustment. Do not switch resolver technology as part
of this extraction.

For each distinct `(normalizedName, type)` query:

- URL-encode query parameters;
- send the resolver's required JSON accept header;
- use a bounded timeout (current behavior is five seconds; retain that unless authoritative current
  documentation gives a reason to change it);
- deduplicate identical `(name,type)` queries;
- execute the small bounded set concurrently;
- bound response size before JSON parsing;
- validate the resolver response with Zod/explicit narrowing before reading answers;
- bound answer-array length before iterating.

The authoritative expected record list is server-generated and currently small, but keep explicit
bounds so future configuration cannot accidentally create unbounded external work.

#### DNS normalization/comparison

Implement comparison helpers and test them independently.

**Owner names / targets**

- compare DNS names case-insensitively;
- normalize/removing a trailing root dot before comparison;
- do not accept an answer for an unrelated owner simply because it appears in the response.

**TXT**

- compare the reconstructed TXT payload to the expected value;
- account for JSON DoH representations that include quotes and/or split TXT character strings;
- preserve meaningful spaces inside the TXT value;
- do not make SPF/DMARC comparisons substring-based.

**MX**

- parse the answer into numeric priority + exchange target;
- compare both priority and normalized target;
- do not mark valid merely because the exchange name matches at the wrong priority.

**CNAME**

- support exact normalized target comparison because the public record contract already allows
  `CNAME`, even though the current generated set may not use it.

Do not make TTL part of verification.

### 4.4 Orchestrate verification in the public Worker route

Refactor `POST /api/organization/email-settings/verify` in
`apps/worker/src/routes/organizationEmailSettings.ts` to:

1. authorize the existing write-capable Organization route;
2. obtain a fresh OrganizationStore stub;
3. call `prepareEmailDomainVerification`;
4. resolve the returned expected records through the Worker-side DNS adapter;
5. if resolution is inconclusive, return 503 without a commit;
6. call `commitEmailDomainVerification` with the original `configurationId` and conclusive results;
7. if commit returns stale-configuration 409, return a conflict/retry response; do **not** silently
   start a second DNS lookup in the same request;
8. synchronize D1 from the committed DO result;
9. return the existing `organizationEmailDomainVerifyResponseSchema` shape with the route request
   ID.

Do not automatically retry the entire prepare -> DNS -> commit sequence. A stale result means the
configuration changed and the user should initiate a verification of the new configuration. Resolver
transport retries, if any, must be bounded in exactly one layer and should not multiply the existing
five-second bound unexpectedly.

### 4.5 Centralize the D1 email-domain registry mirror

Create one Worker-side helper for the `organization_email_domains` control-plane mirror and use it
from both settings update and verification paths.

Suggested responsibility:

```text
syncOrganizationEmailDomainRegistry(...)
```

The helper must make the desired D1 state explicit:

- no custom domain -> no row for that Organization;
- configured but not verified -> `pending`;
- verified -> `active`;
- previously verified but a conclusive re-check no longer matches -> `degraded`;
- `verified_at` reflects the DO's last successful `verifiedAt`, not the latest failed check.

Because D1 and DO storage cannot participate in one transaction:

- the DO remains authoritative;
- synchronize D1 after the authoritative DO mutation/verification commit;
- make the D1 operation idempotent so retrying the HTTP operation can reconcile it;
- do not swallow D1 errors with `.catch(() => undefined)` in these paths;
- on D1 synchronization failure, return/log a specific service-unavailable failure rather than
  pretending the mirror succeeded;
- do not roll the DO state backward solely because the D1 mirror failed.

The helper should upsert the exact Organization/domain pair and remove stale rows for the same
Organization when the configured domain changes or is removed.

#### Domain ownership / unique-domain preflight

`organization_email_domains.domain` is globally unique. Before changing an Organization to a new
custom domain, inspect whether D1 already assigns that normalized domain to a different
Organization. If so, fail closed with a 409-style domain-in-use error rather than silently
reassigning that row.

The implementation must also handle the race where two Organizations attempt to claim the same
previously-unclaimed domain concurrently. Treat a unique-constraint conflict as domain-in-use and do
not overwrite another Organization's row.

Because DO and D1 cannot atomically claim the domain together, the coding agent must preserve a
recoverable state on this conflict. Preferred implementation sequence for a **new domain claim**:

1. preflight D1 ownership;
2. perform the Organization settings mutation;
3. reconcile D1 with an insert/upsert that never changes ownership from another Organization;
4. if the D1 claim loses a race, return a typed conflict and immediately restore the Organization's
   prior domain settings using the captured pre-mutation settings, then verify the restoration;
5. if restoration fails, surface/log a high-severity consistency error instead of hiding it.

If implementation inspection shows `organization_email_domains` is not used as an ownership registry
anywhere and is purely disposable derived cache, document that finding in the change and simplify
this sequence accordingly. Do not assume that without enumerating current consumers first.

### 4.6 Keep required-DNS generation separate from resolver extraction

This plan changes **where/how DNS is checked**, not what DNS configuration the product requires.

Before enabling exact record comparison in staging, inspect `generateRequiredDnsRecords()` and
verify that its SPF/DKIM/MX/DMARC values are the intended current values for the actual
email-sending architecture. Exact checking will correctly reject a placeholder or obsolete value if
the app's required-record generator is wrong.

If those values need correction:

- treat that as a separate, explicitly documented provider-configuration change;
- verify current authoritative provider documentation;
- update tests/UI copy as needed;
- do not silently change provider DNS requirements merely to make this refactor's tests pass.

### 4.7 Remove the legacy DO verifier and close `DO-IO-001`

After the Worker-side path is staged and qualified:

- delete `checkSingleDnsRecord()` from `organizationEmailSettingsStore.ts`;
- delete/replace `verifyOrganizationEmailDomainInStore()` so no network resolver remains DO-side;
- remove the legacy `/internal/email-settings/verify` dispatch path;
- remove any imports made unnecessary by that path;
- remove the `DO-IO-001` external-fetch exception from `scripts/check-do-runtime-boundaries.mjs`;
- change the runtime-boundary guard's final expectation to **zero global external `fetch()` calls**
  in the OrganizationStore runtime graph.

The runtime-boundary checker must fail if an external DNS/provider fetch is later reintroduced into
DO-side code.

## 5. Test plan

### 5.1 DNS adapter unit tests

Use deterministic mocked DoH responses. Cover at minimum:

- exact SPF TXT answer -> `valid`;
- exact DKIM TXT answer -> `valid`;
- TXT owner/value mismatch -> `invalid`;
- unrelated TXT records plus the exact required TXT -> `valid`;
- no answer / NODATA -> `pending`;
- NXDOMAIN -> `pending`;
- DNS owner case and trailing-dot normalization;
- quoted/split TXT normalization;
- exact MX priority + exchange -> `valid`;
- correct MX exchange but wrong priority -> `invalid`;
- CNAME normalization/comparison;
- duplicate `(name,type)` expectations cause one resolver query;
- timeout -> inconclusive attempt;
- network error -> inconclusive attempt;
- non-success HTTP -> inconclusive attempt;
- malformed/oversized JSON -> inconclusive attempt;
- resolver server-failure response -> inconclusive attempt;
- excessive answer count is rejected/bounded.

### 5.2 Durable Object integration tests

Use real migrated DO SQLite via `runInDurableObject`/the existing Worker test infrastructure.

Cover at minimum:

- prepare returns the normalized configured domain, expected records, and stable configuration ID;
- no custom domain -> typed prepare failure;
- all-valid commit -> `active`, updates `lastCheckedAt` and `verifiedAt`;
- first conclusive non-valid commit -> `pending`;
- active domain followed by conclusive non-valid commit -> `degraded`;
- degraded commit preserves the prior successful `verifiedAt`;
- successful re-verification of degraded domain -> `active` with new `verifiedAt`;
- changing the custom domain between prepare and commit -> 409 with no verification mutation;
- changing only `fromName`/`replyToEmail` between prepare and commit does not invalidate the
  configuration ID;
- submitted results with missing/extra/altered authoritative DNS fields are rejected;
- Organization identity mismatch is rejected;
- same-configuration repeated commit is safe/idempotent.

### 5.3 Route/integration tests

Cover at minimum:

- authorization behavior remains unchanged;
- public success response still satisfies `organizationEmailDomainVerifyResponseSchema`;
- resolver I/O occurs Worker-side, not through DO code;
- inconclusive resolver result returns 503 and leaves DO/D1 unchanged;
- stale commit returns 409 and does not automatically retry DNS;
- active/pending/degraded DO results synchronize the matching D1 status;
- `verified_at` in D1 tracks the last successful DO `verifiedAt`;
- D1 sync failure is surfaced, not swallowed;
- retry after a D1 sync failure can reconcile the mirror idempotently;
- settings domain change/removal cleans stale rows for that Organization;
- a domain already owned by another Organization cannot be silently reassigned;
- concurrent domain-claim conflict follows the explicit recovery path;
- existing delivery behavior still uses a custom domain only at DO status `active`.

### 5.4 Runtime-boundary regression

After legacy cleanup, run the DO runtime-boundary gate with no `DO-IO-001` exception and prove:

- Worker-side `emailDomainDns.ts` is outside the OrganizationStore dependency closure;
- OrganizationStore graph has zero external `fetch()` calls;
- the existing Durable Object RPC boundary checker still passes.

## 6. Rollout sequence

The repository requires backward compatibility with the previously deployed Worker Version. Use an
expand/cutover/contract sequence rather than removing the old path in the same release that
introduces the new RPC methods.

### Phase A — expand

Add without changing the public route yet:

- pure verification configuration/hash helpers;
- typed DO `prepareEmailDomainVerification` and `commitEmailDomainVerification` methods;
- Worker-side `emailDomainDns.ts` adapter;
- D1 synchronization helper;
- focused unit/integration tests.

Keep the existing DO verifier and `DO-IO-001` temporarily so the previous request path still works.

### Phase B — cut over

Switch `POST /api/organization/email-settings/verify` to:

`prepare RPC -> Worker DoH -> commit RPC -> D1 sync`.

Keep the old DO verifier/internal route temporarily for rollback compatibility, but no current code
should call it.

Qualify on permanent staging with:

- a valid configured domain;
- a missing/wrong record;
- a resolver-failure fixture/test path;
- a deliberate stale-configuration race test;
- sender fallback when status becomes degraded.

### Phase C — contract/cleanup

After the cutover version is qualified and rollback compatibility permits removal:

- remove the old internal verifier path and DO DoH implementation;
- remove `DO-IO-001` from the runtime-boundary guard;
- verify zero DO external fetches;
- remove obsolete tests/helpers/imports.

Do not deploy or modify production as part of this plan unless separately authorized.

## 7. Suggested file responsibilities

Expected changes; adjust names only when repository inspection shows a better existing owner:

- **NEW** `apps/worker/src/communications/emailDomainDns.ts`
  - Worker-side DoH request, normalization, exact comparison, bounded resolver behavior.
- **NEW** `apps/worker/src/communications/emailDomainDns.test.ts`
  - deterministic resolver/parser tests.
- **NEW or existing pure module** under `apps/worker/src/organization/`
  - prepare/commit RPC payload schemas and configuration-ID canonicalization; no network/provider
    imports.
- `apps/worker/src/organization/OrganizationStore.ts`
  - strongly typed prepare/commit RPC methods.
- `apps/worker/src/organization/organizationEmailSettingsStore.ts`
  - storage-only prepare/commit logic; eventual removal of DoH fetch code.
- `apps/worker/src/organization/organizationStore/read.ts`
  - retain old verify adapter only during expand/cutover compatibility; remove in contract phase.
- `apps/worker/src/routes/organizationEmailSettings.ts`
  - Worker orchestration and D1 synchronization.
- `apps/worker/src/routes/organizationEmailSettings.test.ts`
  - route-level success/failure/mirror coverage.
- `apps/worker/test/*email-domain*.integration.test.ts` or the most appropriate existing integration
  suite
  - real DO stale-commit and state-transition coverage.
- `scripts/check-do-runtime-boundaries.mjs`
  - remove `DO-IO-001` during cleanup and require zero DO external fetches.
- `packages/contracts/src/communications.ts`
  - public schema should remain compatible; change only if a concrete internal typing need cannot be
    kept Worker-internal.
- `apps/worker/src/control/migrations/**`
  - no migration expected for status values; add only if implementation inspection finds a genuine
    control-plane schema requirement.

## 8. Verification commands

Use focused checks while iterating, then the repository's material/release gates as required.

At minimum for implementation:

1. DNS adapter unit tests.
2. Organization email-domain DO integration tests.
3. Organization email-settings route tests.
4. `npm run typecheck`.
5. `npm run lint`.
6. `npm run check:do-runtime` once that gate exists from the related runtime-boundary plan.
7. `node scripts/check-durable-object-boundaries.mjs`.
8. `npm run test:integration` or the prepared integration target required by the current repository
   instructions.
9. `npm run check:ci` before any release-bound push/promotion.

During the final cleanup phase, specifically verify that the runtime-boundary report has no
external-fetch exception for email-domain DNS verification.

## 9. Risks and mitigations

- **Stale-result race:** prepare/commit configuration ID causes fail-closed 409 with no mutation.
- **False DNS success:** exact owner/type/value/priority comparison replaces answer-presence checks.
- **Resolver outage causing false degradation:** inconclusive attempts are never committed.
- **TXT/MX parser differences:** isolate normalization helpers and cover realistic DoH fixtures.
- **D1/DO split-brain:** DO is authoritative; D1 sync is centralized, idempotent, and failures are
  surfaced instead of swallowed.
- **Cross-Organization domain collision:** D1 unique-domain ownership is checked and never silently
  reassigned; concurrent claim conflicts use an explicit recovery path.
- **Rollback incompatibility:** expand/cutover/contract phases retain the old verifier until the new
  RPC methods are safely deployed and qualified.
- **Provider DNS requirement drift:** verify the required-record generator separately before relying
  on exact comparison; do not alter provider requirements as an incidental refactor.
- **Scope creep:** no automatic periodic DNS monitoring, no queue/workflow redesign, no sender
  provider migration, and no UI redesign.

## 10. Rollback

Before contract cleanup, rollback is straightforward because the legacy DO verifier remains present.
A previous Worker Version can continue using the old path.

After contract cleanup, rollback must target a Worker Version that includes the new typed DO methods
or otherwise remains compatible with the deployed class interface. No database migration is expected
for the core extraction, so rollback should not require data reversal.

If D1 mirror improvements ship with behavioral changes, keep them forward/backward compatible with
both the previous and new Worker Versions for the normal deployment overlap window.

## 11. Explicitly out of scope

- Changing the product's required SPF/DKIM/MX/DMARC values without separate provider verification.
- Automated periodic DNS re-verification or drift monitoring.
- Moving verification to Queues or Workflows.
- Replacing Cloudflare JSON DoH with DNS wire-format parsing or another resolver without a separate
  reason.
- Email-provider provisioning/domain-registration automation.
- UI redesign for email-domain settings.
- RPC-count budgets.
- Production deployment.
