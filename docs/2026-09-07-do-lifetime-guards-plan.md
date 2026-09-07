# DO Lifetime Guards Implementation Plan

- **Status:** Proposed — not implemented. Do not build until explicitly authorized.
- **Date:** 2026-09-07
- **Scope:** Prevent Durable Object lifetime regressions (DO held active longer than necessary via
  RPC-adjacent patterns).
- **Decisions locked:** Fail CI immediately on violation. Structural bans only — no
  per-request/per-job RPC count budgets.

## 1. Background and findings

`organizationStoreStub()` (`apps/worker/src/organization/rpc/client.ts:16-25`) uses
`ORGANIZATION_STORE.getByName(id)` and returns a lightweight handle. The DO activates only for the
duration of one RPC method (`calendarRpc`, `commerceRpc`, etc.) and is then evictable after idle.
The `WeakMap` trust cache does not retain stubs.

Directory structure context: `apps/worker/src/organization/` is a hybrid folder containing two
distinct execution contexts:

1. **Durable Object internals:** `OrganizationStore.ts`, `scheduler.ts`, `migrations.ts`,
   `commerceContacts.ts`, and all store modules (`*Store.ts`, `*Store/**`). These execute inside the
   Durable Object with direct access to `DurableObjectStorage`.
2. **Worker route orchestrators / RPC callers:** `organizationTicketing.ts`,
   `organizationDonations.ts`, `organizationSeasons.ts`, `organizationCommunications.ts`,
   `profiles.ts`, etc. These execute in the Cloudflare Worker request handler (outside the DO),
   legitimately call external providers (e.g. `../payments/stripeConnect`,
   `../communications/emailFeedback`), and call into the DO via `organizationStoreStub()` or
   `invokeOrganizationRpc()`.

Observed lifetime extenders are intentional or legacy but should not spread:

- Scattered `storage.setAlarm(Date.now() + 1)` in
  `apps/worker/src/organization/ticketingStore.ts:65,70,95` and
  `apps/worker/src/organization/communicationStore/messages.ts:174,471`, plus the canonical
  `wakeOrganizationAlarm` in `apps/worker/src/organization/scheduler.ts:94-106` and wake paths in
  `apps/worker/src/organization/OrganizationStore.ts:455-457`.
- `await queue.sendBatch()` inside the alarm activation in
  `apps/worker/src/organization/scheduler.ts:604-615` (outside `transactionSync`, but still extends
  that activation over network I/O).
- Active external `fetch()` inside DO:
  `apps/worker/src/organization/organizationEmailSettingsStore.ts:224` performs a DNS-over-HTTPS
  query (`https://cloudflare-dns.com/dns-query`) with an `AbortSignal.timeout(5_000)` inside
  `checkSingleDnsRecord()` during domain verification dispatched from
  `organizationStore/read.ts:349`.
- Extra per-call cost in `OrganizationStore.dispatchRpcCall`
  (`apps/worker/src/organization/OrganizationStore.ts:351-417`): identity SQL + `Request`/`Response`
  JSON round-trip per RPC.
- Queue jobs legitimately do several sequential RPCs (claim → delivery reads → per-delivery result
  writes → complete), e.g. `apps/worker/src/jobs/consumer.ts:95-138` and
  `apps/worker/src/jobs/deliveries/communication.ts:22-95`. These are repeated activations, not one
  held activation, but they dominate DO active time.

Verified clean (must stay clean):

- No `fetch()` to Stripe/Brevo inside DO store modules (Stripe:
  `apps/worker/src/payments/stripeConnect.ts:91`; delivery provider calls run in the Worker/queue
  consumer).
- No `ctx.waitUntil()` / WebSockets in `OrganizationStore`. Only `blockConcurrencyWhile` is the
  constructor migration in `apps/worker/src/organization/OrganizationStore.ts:154`.
- No cross-tenant stub reuse; per-call identity re-check in `OrganizationStore.ts:419-438`.

Existing net: `scripts/check-durable-object-boundaries.mjs` centralizes namespace access and bans
internal `.fetch()` (wired into `scripts/check-ci.mjs:22-26`). It does not cover alarms, queue
sends, `waitUntil`, WebSockets, `blockConcurrencyWhile`, or provider imports inside the DO.

## 2. Outcome

Add a second, additive static gate plus structural regression tests so the following can never be
reintroduced without a CI failure:

1. External I/O that holds a DO activation (`fetch`, queue send) anywhere in DO store code except
   allowlisted legacy sites.
2. Runtime handles that extend DO life (`waitUntil`, WebSocket accept/auto-response,
   `blockConcurrencyWhile` outside the constructor).
3. Alarm sprawl (new direct `setAlarm`/`deleteAlarm` call sites outside the scheduler helper).
4. Provider coupling inside the DO (imports of delivery/Stripe/email provider modules into DO
   files).

Explicitly out of scope: RPC count budgets per HTTP route or per queue job.

## 3. Work items

### 3.1 New static gate: `scripts/check-do-lifetime.mjs`

Create a Node script modeled on `scripts/check-durable-object-boundaries.mjs:16-21` (`matches()`
helper, `path:line: reason` output, non-zero exit on failure).

**Target file scope:** Scan Durable Object implementation files only:

- `apps/worker/src/organization/OrganizationStore.ts`
- `apps/worker/src/organization/scheduler.ts`
- `apps/worker/src/organization/migrations.ts`
- `apps/worker/src/organization/commerceContacts.ts`
- `apps/worker/src/organization/*Store.ts` and `apps/worker/src/organization/*Store/**`
- `apps/worker/src/organization/organizationStore/**`

Do _not_ scan Worker route orchestrator files (`organizationTicketing.ts`,
`organizationDonations.ts`, `organizationSeasons.ts`, `organizationCommunications.ts`,
`profiles.ts`, etc.) which run in the Worker and legitimately import external providers and DO RPC
clients.

**Preprocessing:** Strip comments (`// ...` and `/* ... */`) before regex scanning to prevent false
positives from docstrings and explanations.

**Rules and Allowlists:**

| #   | Ban                              | Pattern / Semantic                                                   | Allowlist                                                                                                    |
| --- | -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| L1  | External `fetch(` calls          | `\bfetch\s*\(` (excluding `override\s+async\s+fetch\s*\(` signature) | `organizationEmailSettingsStore.ts` line with comment `// TODO-centralize: move DoH lookup to Worker router` |
| L2  | `waitUntil`                      | `\bwaitUntil\s*\(`                                                   | None under DO scope                                                                                          |
| L3  | WebSockets                       | `\b(?:acceptWebSocket                                                | setWebSocketAutoResponse)\s*\(`                                                                              | None under DO scope                                                                                                                                                             |
| L4  | `blockConcurrencyWhile`          | `\bblockConcurrencyWhile\s*\(`                                       | Only `OrganizationStore.ts` constructor migration                                                            |
| L5  | Direct `setAlarm`, `deleteAlarm` | `\b(?:storage\.)?(?:setAlarm                                         | deleteAlarm)\s*\(`                                                                                           | `organization/scheduler.ts` + call sites annotated with inline comment `// TODO-centralize on wakeOrganizationAlarm` (`ticketingStore.ts` and `communicationStore/messages.ts`) |
| L6  | Queue sends                      | `\b(?:queue                                                          | JOBS_QUEUE)\.(?:send                                                                                         | sendBatch)\s*\(`                                                                                                                                                                | Only `organization/scheduler.ts:runOrganizationAlarm` |
| L7  | Provider module imports          | Imports matching `/(?:communications\/provider                       | payments\/stripeConnect                                                                                      | auth\/platformEmail                                                                                                                                                             | PLATFORM_EMAIL                                        | BREVO_)/` | None under DO scope |

Notes:

- L1 allowlist accounts for the pre-existing DoH query in `organizationEmailSettingsStore.ts:224`.
  Annotate that site with `// TODO-centralize: move DoH lookup to Worker router` in the guard commit
  so CI passes immediately without blocking on a network refactor.
- L5 allowlist matches on the inline comment annotation `TODO-centralize on wakeOrganizationAlarm`
  rather than static line numbers, avoiding false failures when lines shift.
- L6 uses a targeted queue-method pattern (`queue.send` / `queue.sendBatch`) to avoid false-matching
  generic `.send(` calls.
- Keep the script dependency-free (Node stdlib only, like the existing boundary check) so it runs in
  the `static` CI job without a build.

### 3.2 Wire into gates (2 lines)

- `package.json` scripts: add `"check:do-lifetime": "node scripts/check-do-lifetime.mjs"`.
- `scripts/check-ci.mjs` static job: add
  `{ job: "static", label: "Check DO lifetime boundaries", command: "node", args: ["scripts/check-do-lifetime.mjs"] }`
  immediately after the existing `Check Durable Object RPC boundaries` step.

### 3.3 Structural regression tests (no budgets)

- Alarm hygiene (extend existing `apps/worker/test/scheduler.integration.test.ts` patterns using
  `runInDurableObject` + `state.storage.getAlarm()`):
  - Pure reads never touch or advance the alarm.
  - Covered writes arm exactly one wake alarm (assert `getAlarm()` advances once, not N times).
  - `runOrganizationAlarm` always reschedules via the scheduler state path.
- Provider-isolation unit test: assert the module dependency graph rooted at `OrganizationStore.ts`
  (the DO entry point) contains no provider module specifiers (mirrors L7; catches dynamic imports
  or renames). Keep it to module-specifier assertions, not timer waits (per `apps/worker/AGENTS.md`
  deterministic-clock rule).

### 3.4 `AGENTS.md` wording (apply verbatim when authorized)

Root `AGENTS.md` §4, append one bullet:

> - Do not extend Durable Object activation: no `fetch()`, `waitUntil()`, WebSockets, or queue sends
>   inside Durable Object store code (`OrganizationStore.ts` and associated `*Store` modules under
>   `apps/worker/src/organization/`) except the allowlisted `runOrganizationAlarm` queue drain and
>   legacy DoH DNS check. No direct `storage.setAlarm()` outside `scheduler.ts` — call
>   `wakeOrganizationAlarm`/`ensureOrganizationAlarm`. `npm run check:do-lifetime` enforces this.

`apps/worker/AGENTS.md` Data section, append one bullet:

> - Reads must not arm alarms. Writes that enqueue outbox work wake the scheduler exactly once via
>   the shared helper; `runOrganizationAlarm` owns rescheduling. Provider I/O stays in the
>   Worker/queue consumer, never in the DO.

## 4. Verification (when authorized to build)

1. `node scripts/check-do-lifetime.mjs` — passes on current tree via the L1/L5/L6 allowlists; fails
   when a probe violation (e.g. `fetch` or provider import in a DO store file) is temporarily
   inserted.
2. `npm run check:ci` — new `Check DO lifetime boundaries` step appears in the summary and passes.
3. Focused tests: scheduler/alarm integration tests + `npm run typecheck`.
4. Negative check: confirm the existing `scripts/check-durable-object-boundaries.mjs` still passes
   untouched (no overlap regression).

## 5. Risks and rollback

- **Red-main risk:** mitigated by shipping the L1/L5/L6 allowlist annotations in the same commit as
  the gate. Do not combine with behavior centralization.
- **False positives on Worker orchestrators:** mitigated by strictly scoping the scan to DO
  implementation files (`OrganizationStore.ts`, `*Store.ts`, `scheduler.ts`, etc.) and excluding
  Worker-side route orchestrator modules.
- **Regex false positives:** mitigated by stripping comments before scanning, excluding method
  signatures (`override async fetch`), and targeting queue-specific method invocations.
- **Scope creep:** RPC budgets, moving the DNS DoH lookup to Worker router space, and queue-send
  extraction from `runOrganizationAlarm` are explicitly deferred. This plan freezes the current
  shape and prevents sprawl.
- **Rollback:** additive gate only. Revert the `package.json` script line + the `check-ci.mjs`
  entry + the new script file; no migration or data impact.
