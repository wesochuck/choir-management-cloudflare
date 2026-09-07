# DO Runtime Boundary Guards Implementation Plan

- **Status:** Implemented 2026-09-07. Guard (`scripts/check-do-runtime-boundaries.mjs`,
  `npm run check:do-runtime`) scans the transitive runtime import graph rooted at
  `OrganizationStore.ts`; `wakeOrganizationAlarm()` is monotonic-earlier; ticketing and
  communication store wakes use the shared helper; `DO-IO-001` remains the sole external-fetch
  exception. See Commit C notes in §4.
- **Date:** 2026-09-07
- **Revised:** 2026-09-07
- **Scope:** Prevent Durable Object runtime-boundary regressions, keep the Organization Durable
  Object hibernation-friendly, centralize scheduler ownership, and prevent provider/external-effect
  code from drifting into the Durable Object runtime graph.
- **Decisions locked:** Fail `npm run check:ci` immediately on structural violations. Do not add
  per-request/per-job RPC-count budgets. Determine DO-side code from the runtime dependency graph,
  not filename conventions. Keep the scheduler's single queue handoff. Treat the existing DoH DNS
  lookup as one named, temporary exception.

## 1. Background and runtime semantics

`organizationStoreStub()` (`apps/worker/src/organization/rpc/client.ts`) uses
`ORGANIZATION_STORE.getByName(id)` and returns a lightweight Durable Object stub. Callers obtain a
stub at the RPC boundary rather than caching a long-lived stub. The `WeakMap` trust cache does not
retain stubs.

The repository currently mixes two execution contexts under `apps/worker/src/organization/`:

1. **Durable Object runtime code:** `OrganizationStore.ts`, `scheduler.ts`, migrations, store
   modules, and any local runtime dependency reachable from `OrganizationStore.ts`.
2. **Worker-side orchestrators / RPC callers:** files such as `organizationTicketing.ts`,
   `organizationDonations.ts`, `organizationSeasons.ts`, `organizationCommunications.ts`, and
   `profiles.ts`. These run outside the DO and may legitimately call providers and the DO RPC
   client.

Do not infer those contexts from filenames. A future helper such as
`organization/domainVerification.ts` is DO-side if a value import from the OrganizationStore runtime
graph reaches it, even though its filename does not contain `Store`.

### 1.1 Cloudflare semantics this plan relies on

Keep the reasons for each guard accurate:

- Awaited external I/O such as `fetch()` keeps the current DO event/activation busy until the I/O
  completes.
- `setTimeout()` and `setInterval()` prevent a Durable Object from becoming hibernatable while the
  timers remain active.
- Outbound TCP/WebSocket connections can keep the object active. Treat `cloudflare:sockets` and
  outbound `new WebSocket(...)` as prohibited in the OrganizationStore runtime graph.
- `ctx.waitUntil()` does **not** extend Durable Object lifetime. It is still prohibited here because
  using it in a DO is misleading and provides no lifetime benefit.
- `storage.setAlarm()` schedules a future activation; it does not keep the current instance alive.
  Alarm calls are guarded for **scheduler ownership**, not because alarms themselves are lifetime
  extenders.
- `ctx.acceptWebSocket()` is Cloudflare's hibernation-friendly WebSocket API. OrganizationStore
  WebSockets are prohibited because they are outside this architecture, not because that API is a
  lifetime extender.
- `blockConcurrencyWhile()` remains limited to constructor initialization/migration. Do not add new
  long-running concurrency barriers elsewhere.

Before implementing or changing these guards, verify that current Cloudflare behavior still matches:

- https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/

### 1.2 Current runtime-boundary debt

Known current exceptions / cleanup targets:

- **DO-IO-001:** `organizationEmailSettingsStore.ts` performs a DNS-over-HTTPS `fetch()` to
  `https://cloudflare-dns.com/dns-query` with a bounded timeout. Keep exactly this one
  external-fetch exception until DNS verification is moved Worker-side.
- `runOrganizationAlarm()` owns the intentional `queue.sendBatch()` handoff from durable outbox rows
  to the jobs queue. This is an approved architectural exception, not temporary debt.
- `ticketingStore.ts` and `communicationStore/messages.ts` contain direct `storage.setAlarm(...)`
  wake calls. These should be centralized through scheduler helpers during this implementation; they
  should not remain as permanent exceptions.
- `OrganizationStore.dispatchHttpRequest()` also has broad post-request wake paths. When
  centralizing store-specific wake calls, inspect these paths and remove any redundant wake so the
  same logical operation is not deliberately waking the scheduler twice.

Existing protection:

- `scripts/check-durable-object-boundaries.mjs` already centralizes namespace access and prevents
  legacy internal `.fetch()` transport from spreading. Keep that checker unchanged unless a concrete
  conflict with this plan is discovered.
- `OrganizationStore` re-checks Organization identity inside the DO. This plan must not weaken that
  tenant-isolation invariant.

## 2. Target state

After this plan is implemented:

1. DO-side scope is the transitive local **runtime import graph rooted at
   `apps/worker/src/organization/OrganizationStore.ts`**.
2. No module in that graph performs unapproved external HTTP I/O, creates long-lived timers, opens
   outbound sockets/WebSockets, uses `waitUntil`, or introduces OrganizationStore WebSockets.
3. Provider modules and provider credentials/bindings do not enter the DO runtime graph.
4. `scheduler.ts` owns `setAlarm()` / `deleteAlarm()` calls. Store modules request a wake through
   shared scheduler helpers rather than manipulating the alarm directly.
5. A wake request may move an existing alarm **earlier, never later**.
6. `runOrganizationAlarm()` remains the single approved queue handoff from the DO to `JOBS_QUEUE`.
7. Reads do not arm or advance alarms. Writes only request a wake when they create or expose work
   that the scheduler must process.
8. No RPC-count budgets are introduced. Repeated RPCs may be optimized separately using measured
   evidence, but they are not a lifetime-boundary violation by themselves.

A future directory split such as `organization/do/**` and `organization/worker/**` may make the
boundary more obvious, but that reorganization is **not required** for this plan. The dependency
closure must work with the current hybrid directory.

## 3. Implementation work

### 3.1 Add graph-aware static gate: `scripts/check-do-runtime-boundaries.mjs`

Create a dependency-free Node script, modeled on the output style of
`scripts/check-durable-object-boundaries.mjs`:

- print `path:line: reason` for source violations;
- print clear graph/allowlist errors without a fake line number when no source line applies;
- exit non-zero on any violation;
- remain Node-stdlib-only so it can run in the static release gate without a build.

#### Build the DO runtime dependency closure

Start at:

`apps/worker/src/organization/OrganizationStore.ts`

Recursively follow local runtime dependencies under `apps/worker/src`:

- normal `import ... from "./..."` value imports;
- side-effect `import "./..."` imports;
- `export ... from "./..."` / `export * from "./..."` when they create runtime reachability;
- string-literal dynamic imports such as `import("./helper")`.

Rules for graph construction:

- Ignore `import type ...` because it is erased at runtime.
- It is acceptable to conservatively follow a mixed import such as
  `import { type A, valueB } from "./x"`; it contains a runtime import.
- Resolve the repository's normal TypeScript forms (`foo.ts`, `foo/index.ts`, etc.).
- Only recurse into resolved local files under `apps/worker/src`.
- If a relative runtime import cannot be resolved, fail closed and report it instead of silently
  dropping that branch from the graph.
- Inspect non-relative import specifiers for specifically prohibited runtime modules (for example
  `cloudflare:sockets`), but do not recursively inspect package contents.

This graph is the source of truth for scan scope. Do **not** maintain a parallel list of
`*Store.ts`, `scheduler.ts`, `organizationStore/**`, etc.

#### Source preprocessing

Keep both forms of each source file:

- **raw source** for line reporting and import extraction where needed;
- **comment-stripped source** for token/pattern checks that would otherwise match documentation.

Do not use source comments as allowlist switches. A developer must not be able to copy a magic TODO
comment to bypass the gate.

#### Explicit allowlist model

Keep exceptions in one explicit data structure inside the checker, for example:

```js
const exceptions = [
  {
    rule: "external-fetch",
    path: "organization/organizationEmailSettingsStore.ts",
    expectedCount: 1,
    debtId: "DO-IO-001",
    reason: "Legacy DoH email-domain verification; move Worker-side separately.",
  },
];
```

Requirements:

- no line-number allowlists;
- no inline-comment/magic-token allowlists;
- every exception has a rule, path, expected count, reason, and debt/architecture identifier;
- fail if an exception matches **more or fewer** occurrences than expected;
- fail if an exception becomes stale because the underlying violation disappeared;
- adding a new exception requires an intentional checker edit and should be treated as an
  architecture change.

During the first guard-only commit, temporary alarm exceptions may be used for the currently known
legacy direct `setAlarm()` sites so that commit passes on the existing tree. Determine their exact
counts from the tree at implementation time. Remove all of those alarm exceptions in the alarm
centralization commit; they are not part of the final target state.

#### Runtime-boundary rules

| Rule | Prohibit / constrain                                                                                                                                        | Final allowlist                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| R1   | Global external `fetch(...)` calls in the DO graph. Do not treat the `OrganizationStore.fetch` method declaration as a call.                                | Exactly `DO-IO-001`, expected count 1.                                                                                               |
| R2   | `setTimeout(...)` and `setInterval(...)` in the DO graph.                                                                                                   | None.                                                                                                                                |
| R3   | Outbound socket/WebSocket capability: imports from `cloudflare:sockets` and outbound `new WebSocket(...)`.                                                  | None.                                                                                                                                |
| R4   | OrganizationStore WebSocket APIs such as `acceptWebSocket(...)` and `setWebSocketAutoResponse(...)`.                                                        | None; unsupported architecture.                                                                                                      |
| R5   | `waitUntil(...)` in the DO graph.                                                                                                                           | None; misleading/no lifetime benefit in a DO.                                                                                        |
| R6   | `blockConcurrencyWhile(...)`.                                                                                                                               | Exactly the existing constructor migration/initialization use in `OrganizationStore.ts`.                                             |
| R7   | Direct `setAlarm(...)` / `deleteAlarm(...)` outside `scheduler.ts`.                                                                                         | None after alarm centralization.                                                                                                     |
| R8   | Queue `send(...)` / `sendBatch(...)` from the DO graph.                                                                                                     | The existing scheduler queue handoff only; require the approved scheduler file and expected occurrence count so a second send fails. |
| R9   | Provider runtime dependencies in the DO graph.                                                                                                              | None.                                                                                                                                |
| R10  | Direct use of provider credentials/bindings from DO-side code (for example `PLATFORM_EMAIL`, `BREVO_API_KEY`, `STRIPE_SECRET_KEY`, `CLOUDFLARE_API_TOKEN`). | None.                                                                                                                                |

For R9, fail if the runtime graph reaches known provider modules or imports known provider SDKs.
Start with the repository's actual provider boundaries, including Stripe/payment provider code,
Brevo/communication provider code, platform-email sending code, and any equivalent provider adapter
identified while implementing the checker. Prefer path/specifier checks over vague string checks so
normal stored data fields such as `stripe_*` are not false positives.

R8 should permit the scheduler's existing queue drain but make the exception narrow. At minimum,
allow only `scheduler.ts` with the current expected queue-send occurrence count. A second queue send
in that file must fail until deliberately reviewed.

#### Checker self-tests

The gate itself is architecture-critical. Add a small dependency-free assertion table to the checker
(or a small Node-stdlib helper test invoked by the same npm script) so `npm run check:do-runtime`
proves the scanner can detect its key cases without temporarily editing repository source.

Include fixtures for at least:

- a nested local helper containing `fetch()` is caught by graph traversal;
- `setTimeout()` / `setInterval()` are caught;
- `import type` does not incorrectly pull Worker-only code into the runtime graph;
- a string-literal dynamic import into a prohibited provider path is caught;
- `waitUntil()` is caught;
- direct `setAlarm()` outside scheduler code is caught;
- a second queue send beyond the approved count is caught;
- the `OrganizationStore.fetch` method declaration is not mistaken for global external `fetch()`;
- stale/wrong allowlist counts fail;
- a clean fixture passes.

Use in-memory fixture strings or temporary fixture directories. Do not implement negative tests by
modifying tracked application files and reverting them.

### 3.2 Centralize alarm wake behavior

After the guard exists with temporary current-tree alarm exceptions, remove the direct alarm debt.

#### Make wake behavior monotonic-earlier

Update `wakeOrganizationAlarm()` so a wake request can move the currently scheduled alarm earlier
but can never postpone an alarm that is already sooner.

Behavioral invariant:

```text
requestedWake = now + ALARM_WAKE_DELAY_MS
existingAlarm = storage.getAlarm()

if no existing alarm OR requestedWake < existingAlarm:
    set requestedWake
else:
    leave existing alarm unchanged
```

Keep scheduler-state initialization semantics intact. It is fine to introduce a small private helper
inside `scheduler.ts` if both `ensureOrganizationAlarm()` and `wakeOrganizationAlarm()` benefit from
the same "no later than" behavior.

Do not apply that invariant mechanically to every scheduler reschedule. `runOrganizationAlarm()` is
the scheduler owner and may intentionally set the next cadence/retry/continuation alarm after an
alarm invocation.

#### Remove direct store alarm calls

Audit each current direct `storage.setAlarm(...)` in `ticketingStore.ts` and
`communicationStore/messages.ts`:

- replace a true scheduler wake with `wakeOrganizationAlarm()` at the narrowest logical operation
  that exposes/enqueues scheduler work;
- do not wake for operations that do not create scheduler work;
- check `OrganizationStore.dispatchHttpRequest()` broad `isAlarmWakePath(...)` behavior and remove
  or narrow any path that would cause the same operation to request a second redundant wake;
- preserve idempotency and outbox ordering; do not move provider calls into the DO;
- after the cleanup, remove every temporary alarm exception from the static checker.

Do not assert implementation-level "setAlarm called exactly once" behavior in tests. What matters is
the resulting alarm invariant, not the internal number of helper invocations.

### 3.3 Keep the scheduler queue handoff

Do **not** move `queue.sendBatch()` out of `runOrganizationAlarm()` as part of this plan.

The existing architecture is intentionally:

1. create stable/idempotent outbox jobs in DO SQLite;
2. read a bounded pending batch;
3. enqueue that batch to `JOBS_QUEUE`;
4. mark rows enqueued;
5. reschedule the alarm.

The queue send is awaited network/external I/O and therefore extends that alarm event, but
extracting it requires a materially different dispatcher architecture. The bounded scheduler queue
handoff is an explicit approved exception. The guard exists to prevent **additional** queue/provider
effects from spreading through DO store code.

### 3.4 Wire the static/release gate

Use the runtime-boundary terminology rather than "CI lifetime" terminology:

- `package.json`:
  - add `"check:do-runtime": "node scripts/check-do-runtime-boundaries.mjs"`;
- `scripts/check-ci.mjs`:
  - add a static step immediately after `Check Durable Object RPC boundaries`:

```js
{
  job: "static",
  label: "Check DO runtime boundaries",
  command: "npm",
  args: ["run", "check:do-runtime"],
}
```

`npm run check:ci` is the repository's local release gate; GitHub Actions remains disabled under the
current repository contract.

### 3.5 Structural regression tests

Extend real Durable Object integration coverage, using deterministic/injected times rather than real
waits.

Required behavior tests:

1. **Pure read does not change alarm:** capture `storage.getAlarm()`, perform a representative DO
   read, then verify the alarm value is unchanged.
2. **Wake moves a later alarm earlier:** seed a distant alarm, invoke the wake path, and verify the
   resulting alarm is near the requested wake time.
3. **Wake never postpones:** seed an alarm earlier than the requested wake, invoke the wake path,
   and verify the earlier timestamp remains unchanged.
4. **Repeated wake is stable:** repeated wake requests must not keep sliding the alarm into the
   future.
5. **Alarm reschedules after no work:** `runOrganizationAlarm()` returns to the scheduler-state
   cadence when there is no pending queue batch.
6. **Full batch continuation:** a full outbox batch schedules the prompt continuation behavior
   already intended by the scheduler.
7. **Replay/idempotency remains intact:** preserve the existing scheduler integration behavior that
   re-enqueues the same stable job after an uncertain delivery instead of creating a duplicate.

Where practical, exercise the public RPC/store operation that causes the wake rather than testing
only the helper in isolation. Continue using real migrated SQLite via `runInDurableObject`; do not
mock SQL by string matching.

### 3.6 Update coding-agent policy

After the implementation is complete, update policy wording to describe the actual reasons for the
rules.

Root `AGENTS.md` §4, append:

> - Keep the Organization Durable Object runtime boundary hibernation-friendly. Runtime code
>   reachable from `OrganizationStore.ts` must not perform external `fetch()`, create long-lived
>   timers, open outbound sockets/WebSockets, call providers, or send queue work except for the
>   scheduler's approved bounded queue handoff and the named temporary `DO-IO-001` DoH exception. Do
>   not use `waitUntil()` in a Durable Object; it does not extend DO lifetime. OrganizationStore
>   WebSockets are outside the current architecture. Alarm ownership stays in `scheduler.ts`; store
>   code requests scheduler work through the shared alarm helpers. `npm run check:do-runtime`
>   enforces these boundaries.

`apps/worker/AGENTS.md` Data section, append:

> - Reads must not arm or advance Organization alarms. Writes that expose scheduler/outbox work use
>   the shared wake helper; a wake may move an alarm earlier but never postpone an earlier alarm.
>   `runOrganizationAlarm()` owns cadence/retry/continuation rescheduling and the single bounded
>   DO-to-`JOBS_QUEUE` handoff. Provider I/O stays Worker/queue-side.

Do not say that `waitUntil()`, `setAlarm()`, or hibernation-WebSocket APIs inherently extend DO
lifetime when that is not the Cloudflare behavior being enforced.

### 3.7 Track DoH extraction separately

`DO-IO-001` is allowed to remain after this plan. Do not combine its extraction with the guard/alarm
work unless separately authorized.

Desired follow-up direction:

- perform DNS/provider lookup in Worker-side orchestration;
- pass only validated verification input/result into a typed OrganizationStore mutation;
- keep the store responsible for tenant validation and durable verification state;
- delete the `DO-IO-001` checker exception when no external fetch remains reachable from
  `OrganizationStore.ts`.

The runtime-boundary gate must make that debt visible and count-stable until it is removed.

## 4. Recommended implementation sequence

Keep the work reviewable and keep each intermediate commit green.

### Commit A — runtime guard

- add `scripts/check-do-runtime-boundaries.mjs`;
- build graph-aware scope and all rules;
- add checker self-tests;
- add explicit `DO-IO-001` and temporary current-tree alarm exceptions with exact counts;
- wire `check:do-runtime` into `package.json` and `scripts/check-ci.mjs`;
- do not change runtime behavior in this commit.

### Commit B — alarm centralization

- make `wakeOrganizationAlarm()` monotonic-earlier;
- replace/remove direct store `setAlarm()` calls;
- remove or narrow redundant broad wake paths where needed;
- add/extend scheduler integration tests;
- delete all temporary alarm exceptions from the checker.

### Commit C — policy/documentation alignment

- update root and Worker `AGENTS.md` wording;
- update this plan's status to implemented and record the actual files/checks changed;
- do not mark `DO-IO-001` complete unless the DoH extraction was separately implemented.

If repository conventions favor two commits instead of three, Commit C may be folded into Commit B.
Do not fold the deferred DoH provider refactor into this work merely to remove the last exception.

## 5. Verification

During implementation run focused checks while iterating. Before considering the material change
complete:

1. `npm run check:do-runtime` passes, including the checker's self-tests.
2. The final checker reports:
   - exactly one external-fetch exception (`DO-IO-001`);
   - no direct-alarm exceptions outside `scheduler.ts`;
   - only the approved scheduler queue handoff;
   - no timers, outbound socket/WebSocket capability, `waitUntil`, unsupported WebSockets, or
     provider runtime dependencies in the DO graph.
3. Existing `node scripts/check-durable-object-boundaries.mjs` still passes unchanged.
4. Focused scheduler/OrganizationStore integration tests pass.
5. `npm run typecheck` passes.
6. Run the affected Worker integration gate required by repository policy.
7. Before pushing `main`, run `npm run check:ci` as required by `AGENTS.md`.
8. Browser E2E is not required solely for this non-UI change unless another in-scope change affects
   browser-visible behavior.

Also inspect the final diff to confirm no unrelated user changes were modified and no provider call
was moved into a DO transaction.

## 6. Acceptance criteria

The implementation is complete only when all of the following are true:

- A runtime dependency introduced several local imports below `OrganizationStore.ts` is still in
  scope of the checker automatically.
- A new DO-side external `fetch`, timer, outbound socket/WebSocket, `waitUntil`, provider
  dependency, direct non-scheduler alarm call, or extra queue send fails the static/release gate.
- The checker cannot be bypassed by adding a magic comment.
- Allowlist entries are count-checked and fail when stale.
- `ticketingStore.ts` and `communicationStore/messages.ts` no longer call `setAlarm()` directly.
- `wakeOrganizationAlarm()` cannot postpone an already earlier alarm.
- Existing scheduler replay/idempotency behavior still passes integration tests.
- Tenant identity checks and existing RPC-boundary protections are unchanged or stronger.
- `DO-IO-001` is the only approved external-fetch debt left in the DO runtime graph.
- No RPC-count budget has been introduced.

## 7. Risks and rollback

- **Graph false positives:** mitigate by following runtime imports only and ignoring `import type`.
  Fail unresolved relative runtime imports explicitly instead of silently changing scope.
- **Regex/token false positives:** use comment-stripped source for call checks, path/specifier
  checks for provider boundaries, and built-in scanner fixtures for every important rule.
- **Allowlist drift:** explicit expected counts make stale or expanded exceptions fail closed.
- **Alarm behavior regression:** changing wake ownership is material Worker behavior. Protect the
  "move earlier, never later" invariant and replay behavior with real-DO integration tests.
- **Double wake:** inspect broad `OrganizationStore.dispatchHttpRequest()` wake paths when replacing
  store-local alarms so a logical operation is not intentionally woken twice.
- **Scope creep:** do not add RPC budgets, reorganize the whole `organization/` directory, extract
  scheduler queue sending, or move DoH verification Worker-side unless separately authorized.
- **Rollback:** the static gate/policy changes can be reverted without migration/data impact. The
  alarm centralization is also schema-free; if behavior regresses, revert the alarm code/tests as a
  unit while preserving the existing durable outbox/idempotency model.
