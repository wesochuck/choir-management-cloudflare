# Next Permanent-Staging Qualification Batch

**Prepared for:** Codex Luna  
**Prepared:** August 12, 2026  
**Target:** permanent staging only  
**Production:** explicitly out of scope

## Objective

Complete the next provider-independent Milestone 6 qualification batch in this order:

1. controlled queue and scheduler fixtures;
2. RSVP, audition, unsubscribe, and email-change signed links;
3. Profile-photo upload, authorization, replacement, and cleanup.

Use real staging behavior and existing application routes. Do not add a qualification-only Worker
route, directly edit remote Durable Object storage, copy a session cookie into chat or source, or
promote a parity entry from local tests alone.

The authoritative starting point is the current checkout, not the counts in older dated evidence. At
preparation time the parity matrix has 205 entries: 175 `verified` and 30 `implemented`.
`api.maintenance` is already verified. The current deployed runtime is source commit
`bffdd196be2a5bcf39b2ff780a19224acaf4e071`; confirm this before relying on it.

## Required constraints

- Follow root, Worker, and Web `AGENTS.md` instructions.
- Resolve the Organization from the canonical hostname before authorization. Use
  `lcc.staging.musicsite.org` for LCC operational actions.
- Prefix every temporary title or display name with `QUAL-<UTC date>-<short random suffix>`.
- Record fixture IDs locally during the run, but never record signed tokens, OTPs, session cookies,
  recovery codes, provider payloads, or message contents containing signed URLs.
- Use only a dedicated, user-approved, staging-allowlisted recipient. Do not send qualification
  messages to the roster at large.
- Do not use the user's primary Profile for unsubscribe or email-change qualification. Those flows
  need dedicated disposable identities because they change durable identity or suppression state.
- Do not retry or dismiss an existing dead letter unless its source record is proven to be owned by
  this qualification batch. Retrying an unrelated record can duplicate an external email.
- Keep provider calls outside Durable Object transactions and preserve stable idempotency keys.
- Use bounded waits and polling. Never wait indefinitely for an alarm, queue, or email.
- Clean up through application APIs and UI, preserving append-only audit evidence.

## Phase 0 — Preflight and fixture contract

### 0.1 Confirm source and runtime

1. Inspect `git status`; preserve unrelated work.
2. Run:

   ```bash
   npm run check:parity
   npm run check:parity:implementation
   STAGING_EXPECTED_VERSION=bffdd196be2a5bcf39b2ff780a19224acaf4e071 npm run qualify:staging
   ```

3. Confirm product health and readiness return HTTP 200.
4. Confirm the LCC canonical host resolves to the expected Organization.
5. Obtain a fresh Platform Administrator factor through the visible staging Security page. Never
   read or persist the factor programmatically.

### 0.2 Obtain explicit fixture inputs

Before creating state, obtain:

- one dedicated allowlisted email inbox for queue/reminder/audition fixtures;
- a second dedicated allowlisted inbox for the reversible email-change cycle;
- approval to send the small, enumerated set of sandbox messages;
- a temporary Profile linked only to the qualification inbox;
- confirmation that no SMS will be sent in this batch.

If two disposable inboxes are unavailable, defer `signed.email-change` and
`route.auth.confirm-email-change`. If a disposable inbox is unavailable, defer unsubscribe rather
than suppressing the user's real Profile.

### 0.3 Capture the baseline

Capture counts and identifiers, without message bodies or tokens, for:

- open and all queue dead letters;
- communication drafts, upcoming sends, and recent history;
- active Profiles and the temporary qualification Profile;
- events, attendance, RSVPs, auditions, ticket orders, and suppressions relevant to the fixture;
- product health/readiness and exact `BUILD_VERSION`.

This baseline is needed to distinguish new qualification evidence from pre-existing staging data.

## Phase 1 — Controlled queue and scheduler fixtures

The target entries are:

- `task.message-queue`;
- `task.event-reminder`;
- `task.post-event-report`;
- `task.ticket-reminder`;
- `task.cleanup` only if a stale pending checkout can be created through an existing supported
  application flow without Stripe credentials or direct storage edits.

### 1.1 Add a repeatable qualification harness only if needed

Prefer existing UI and API flows. If repeatable polling or evidence collection is otherwise too
fragile, add a local script under `scripts/` that:

- authenticates interactively like the existing staging login scripts;
- keeps the session in memory;
- accepts fixture IDs through environment variables or prompts;
- calls only existing public/Organization/Platform routes;
- redacts tokens and response bodies that may contain signed URLs;
- prints statuses, counts, safe IDs, and idempotency outcomes only;
- supports a `--plan-only` mode;
- has focused tests for planning, redaction, and cleanup selection.

Do not add a deployed test endpoint or a route that can set scheduler time, enqueue arbitrary jobs,
or access another Organization.

### 1.2 Message-queue success and idempotency

1. Create a one-recipient Organization communication for the temporary Profile and qualification
   inbox.
2. Include a unique fixture marker in the subject, but no real member data.
3. Queue the message once.
4. Poll Communications history and the queue/dead-letter view with a bounded timeout.
5. Prove one source send creates one completed delivery and one external receipt.
6. Re-read or safely repeat the queue acknowledgement path and prove the stable job/idempotency key
   does not create a second delivery.
7. Verify another Organization cannot read or act on the source record.

Do not promote `task.message-queue` unless success, replay/idempotency, failure visibility, and
Organization isolation are all evidenced.

### 1.3 Qualification-owned dead-letter behavior

Create a deterministic failure only if it can be scoped to the temporary fixture and cannot reach a
real recipient. Allow the normal retry policy to exhaust, then:

1. confirm the dead-letter row contains operational metadata but no message body, token, or secret;
2. confirm the source Organization, job kind, job ID, attempts, and idempotency key match the
   qualification fixture;
3. exercise **Retry job** once only after correcting the fixture's cause, and prove the retry is
   queued once;
4. if the cause cannot safely be corrected, use a separate qualification-owned record to verify
   **Dismiss record** and leave the original un-retried;
5. prove a second click cannot create a duplicate retry;
6. verify Platform-factor expiry and role checks reject unauthorized actions.

If no deterministic qualification-owned failure can be produced, record dead-letter replay as an
explicit remaining prerequisite. Do not substitute an unrelated existing row.

### 1.4 Event reminder fixture

1. Create a temporary Performance beginning within the scheduler's 48-hour reminder horizon.
2. Add only the temporary eligible Profile, with the approved email and the required RSVP/voice-part
   state.
3. Confirm the applicable system template and Organization settings are enabled.
4. Wait for `scheduler_state.next_due_at`, or invoke the already verified LCC maintenance route once
   the scheduler is due. The maintenance route must be called on the canonical LCC host.
5. Prove exactly one `event_reminder` job is created, queued, consumed, and recorded in the
   communication ledger.
6. Run the scheduler again and prove no duplicate reminder is created.
7. Confirm rehearsal-parent policy: a rehearsal must not produce an independent automated reminder
   when the accepted domain rule says the parent Performance owns it.

### 1.5 Post-event report fixture

1. Create a temporary Performance more than 12 hours in the past.
2. Add the temporary Profile and controlled attendance/RSVP rows.
3. Configure only the qualification recipient to receive the report.
4. Run the due scheduler pass.
5. Prove exactly one `attendance_report` job is created and delivered through the communication
   ledger with the expected aggregate counts.
6. Re-run and prove idempotency.
7. Confirm the corresponding LMC host cannot see the report or its job state.

### 1.6 Ticket reminder fixture

1. Create a temporary ticket-enabled Performance starting within 24 hours.
2. Use zero-dollar simulation mode so no Stripe charge is created.
3. Create one order for the qualification inbox and record its purchase/event IDs.
4. Run the due scheduler pass.
5. Prove one `ticket_notification` reminder is sent, the receipt remains accessible, and a repeated
   scheduler pass does not duplicate the reminder.
6. Refund the free simulated order through the supported application route and archive the event.

### 1.7 Cleanup task decision

`stale_checkout_cleanup` needs a genuinely stale pending ticket, donation, or dues payment. Do not
fabricate one by editing Organization storage. If current staging simulation completes immediately,
defer `task.cleanup` to the Stripe test-credential batch. Retain the existing focused Workerd tests
as implementation evidence, not staging proof.

### 1.8 Queue/scheduler exit criteria

For each promoted task, evidence must show:

- fixture creation through a supported route;
- stable Organization-bound job and idempotency key;
- queue acceptance and consumer completion;
- expected external or ledger effect exactly once;
- bounded retry or terminal failure behavior;
- no cross-Organization access;
- cleanup or an explicit retained audit-only artifact;
- health/readiness still passing afterward.

## Phase 2 — Signed-link qualification

The target entries are `signed.rsvp`, `signed.audition`, `signed.unsubscribe`,
`signed.email-change`, and the browser route `route.auth.confirm-email-change`.

Use the contract in `docs/parity/signed-link-behavior.md`. Never paste a full token into evidence,
logs, a commit message, or chat. Keep tokens only in browser navigation or process memory.

### 2.1 RSVP link

1. Create a temporary eligible Profile and future Performance.
2. Generate the token through `POST /api/organization/rsvp-tokens` as an authorized LCC admin.
3. Open the valid LCC link and verify details, venue, current response, and self-service state.
4. Submit Yes, No with the required note, and restore the original state.
5. Reuse the valid link to prove allowed replay while active.
6. Open the same token on LMC and prove a controlled not-found response.
7. Revoke access through supported event/Profile state and prove the token can no longer mutate.
8. Use local focused tests for cryptographic expiry and malformed/oversized cases; do not add a
   short-TTL staging backdoor merely to make expiry observable.

### 2.2 Audition link

1. Create a temporary audition inquiry using the qualification inbox.
2. Schedule or trigger the normal audition notification so the existing delivery code issues the
   link.
3. Obtain the link from the controlled inbox without recording the token.
4. Verify the valid LCC page and an allowed update.
5. Replay it on LMC and prove rejection.
6. Delete or terminally close the inquiry through the supported admin flow, then prove the old link
   cannot update it.

### 2.3 Unsubscribe link

This must use a disposable qualification Profile and inbox.

1. Send one campaign to that Profile through the normal queue.
2. Open its unsubscribe link and verify the email preference/suppression transition.
3. Open it again and prove idempotent success with no duplicate audit effect.
4. Replay it on LMC and prove Organization-bound rejection.
5. Verify future campaign reach excludes the Profile.
6. Restore or release the qualification suppression only through the supported Platform action and
   only if cleanup was explicitly approved. Never suppress the user's primary Profile.

### 2.4 Email-change link and browser route

This requires two controlled, staging-allowlisted inboxes.

1. Use a disposable account/Profile, not the user's primary identity.
2. Request an email change from inbox A to inbox B.
3. Prove inbox A receives the old-address notice and inbox B receives the confirmation.
4. Open the B confirmation link and verify the browser route removes the token from visible history,
   confirms once, updates identity and Membership linkage, and signs in correctly as B.
5. Replay the consumed link and prove rejection.
6. Attempt wrong-host/cross-Organization use and prove rejection.
7. Perform a second controlled cycle from B back to A and verify both notices again.
8. Confirm neither full token nor new address appears in unsafe logs or unrelated Organization audit
   data.

### 2.5 Signed-link exit criteria

For each signed flow, capture valid success plus applicable replay, revocation, wrong-host,
cross-Organization, and authorization behavior. Combine staging behavior with focused cryptographic
tests for expiration, malformed input, fixed-length constant-time comparison, and size limits.

## Phase 3 — Profile-photo qualification

The target entry is `file.profile-photo`.

### 3.1 Fixture and supported upload path

Use a generated, non-personal 1x1 or small PNG/JPEG fixture under 10 KB. Prefer a temporary file
outside the repository. If the browser file chooser is unavailable, add a local interactive
qualification script that signs in through the existing email-code flow, holds its session only in
memory, uploads through the existing file API, and never prints the cookie or image bytes.

Do not add a deployed upload bypass.

### 3.2 Required behavior

1. As the linked member, upload and attach the image to that member's own Profile.
2. Verify the thumbnail renders after a full reload and in the member directory where authorized.
3. Fetch the private file while authorized and verify content type, byte checksum, no-store policy,
   and filename behavior.
4. Attempt to attach the file to another Profile as an ordinary member and prove HTTP 403.
5. Attempt to fetch or substitute the file ID on LMC and prove no cross-Organization disclosure.
6. As an authorized Organization admin, attach a second fixture to the temporary Profile and verify
   replacement.
7. Verify the old object is no longer retrievable after replacement.
8. Remove the photo through the custom confirmation, verify the thumbnail disappears after reload,
   and prove the replacement object is no longer retrievable.
9. Verify `profile.photo_attached` and `profile.photo_removed` audit events contain safe metadata
   but no bytes or signed URLs.
10. Exercise JPEG/PNG/WebP acceptance, oversize rejection, and invalid content-type rejection using
    focused local/Workerd tests; one valid deployed format is sufficient for the staging mutation.

## Phase 4 — Cleanup and evidence promotion

### 4.1 Cleanup inventory

Before promoting anything, account for every fixture:

- archive temporary events;
- restore RSVP and attendance state;
- refund the free ticket order;
- delete the temporary audition;
- remove the Profile photo and confirm its private object is inaccessible;
- restore the disposable email identity;
- restore or explicitly retain the disposable unsubscribe suppression;
- hide/inactivate or otherwise retire temporary Profiles through supported controls;
- dismiss only qualification-owned dead-letter rows, with a reason that identifies the batch.

Do not delete audit evidence or directly edit control-plane/Organization storage.

### 4.2 Postflight

Run:

```bash
STAGING_EXPECTED_VERSION=bffdd196be2a5bcf39b2ff780a19224acaf4e071 npm run qualify:staging
npm run check:parity
npm run check:parity:implementation
```

Also recheck product and both canonical Organization hosts, Platform queue views, suppressions, and
the exact build version.

### 4.3 Evidence updates

Update:

- `docs/goal/READINESS.md` current snapshot and completion backlog;
- `docs/goal/qualification-evidence-2026-08-11.md` append-only current-release section;
- `docs/parity/feature-matrix.yaml` only for entries whose complete gate is proven.

Do not automatically promote broad workflows because one component passed. Promote only the exact
task, signed-flow, browser-route, or file entry supported by the captured evidence. Recalculate the
matrix counts from the file rather than editing counts from memory.

## Verification requirements for any code changes

If Luna changes only evidence documents:

```bash
npm run format:check
npm run check:parity
npm run check:parity:implementation
git diff --check
```

If Luna adds or changes local qualification scripts, also run focused script tests, lint, and
typecheck. If Luna changes application runtime, contracts, routes, persistence, queue behavior, or
browser-visible behavior, classify it as material/release-bound and run:

```bash
npm run check:ci
npm run test:e2e
```

Then deploy the exact immutable `main` artifact to permanent staging with the repository's local
staging deployment command and repeat the entire relevant staging batch. Do not deploy merely to
record evidence, and do not launch production.

## Stop conditions

Pause and ask the user when:

- a disposable allowlisted inbox or second email identity is unavailable;
- a sandbox message could reach anyone outside the enumerated qualification recipients;
- queue retry ownership cannot be proven;
- a task requires Stripe/Brevo credentials not yet entered through a secure provider flow;
- cleanup would alter a real member, payment, suppression, domain, or unrelated dead letter;
- a production resource or domain would be required.

## Expected handoff report

Luna's final report for this batch must list:

- each entry promoted and the exact success/failure/isolation evidence;
- each entry left `implemented` and the precise missing prerequisite;
- all fixtures created and their cleanup disposition, without tokens or secrets;
- messages sent, their approved recipients, and whether delivery was exactly once;
- checks run and results;
- runtime/source version tested;
- migration, rollback, tenant-isolation, external-effect, accessibility, and performance impact;
- commits created, without pushing or deploying beyond the user's authorization.
