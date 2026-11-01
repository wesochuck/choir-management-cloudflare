# Organization notification inbox implementation plan

Date: November 1, 2026

Status: Product decisions recorded; implementation plan awaiting final shared-understanding review.
Technical defaults below are proposed for final review, not additional confirmed product decisions.
No application code has been changed for this feature, and no commit, push, or deployment is
authorized by this plan.

## Intended outcome

Give Organization members a dependable personal collection of notices generated for them, with
direct navigation to the relevant operational record.

## Confirmed decisions

- The admin header bell opens the compact notification popout selected from mockup 1.
- “View all notifications” opens the full inbox selected from mockup 3.
- Both surfaces represent the same personal collection and read status.
- Existing recipient preferences determine which notices belong to a person. This is not a feed of
  all activity they can access.
- A notice remains available even if its email fails to deliver. Inbox availability must not depend
  on successful email delivery.
- First-release scope is recipient alerts for new audition inquiries, ticket sales, and donations.
  Applicant/buyer/donor confirmations are not inbox notices in this feature.
- Reuse the existing notification-generation flows and their resolved recipients. Whatever makes the
  system generate an email for a person also makes it generate their inbox notice; do not add an
  independent activity collector, eligibility resolver, preference system, or delivery pipeline. The
  explicitly approved audition-recipient replacement below is the sole exception to preserving the
  existing preference model; both channels must use its single authoritative recipient rule.
- Preserve existing eligibility timing, suppression rules, deduplication, and retry behavior for
  ticket-sale and donation alerts. For auditions, replace the recipient source as approved below.
  Distinguish a person excluded before generation from an intended recipient whose email later
  fails: the latter still receives the inbox notice.
- Opening the bell popout or full inbox does not mark notices as read. Clicking an individual notice
  marks that notice as read for the current person and opens its related record.
- “Mark all as read” explicitly clears the current person's unread state. Reading never marks the
  underlying audition, order, or donation as reviewed, completed, or otherwise handled.
- Start fresh at launch: do not backfill inbox notices from historical email or operational records.
  Existing Communications history remains unchanged. Implementation must establish a durable launch
  boundary so replay of an older notification does not introduce historical notices.
- Retain notices for 90 days from their original creation, whether read or unread. Retries and read
  actions do not extend retention. Expiration removes only inbox records, preserving the existing
  lifecycles of source records and Communications history. Use indexed, bounded expiration cleanup.
- Turning off an alert preference stops future notices under the existing email rules; it does not
  remove notices already received. Historical notices remain until expiration, subject to current
  authorization for the inbox and related records.
- Represent each existing alert as one individual notice per intended person, preserving the
  existing alert's event identity and recipient deduplication. No ticket-sale grouping, digest, or
  aggregate notice in the first release. This supersedes the mockup's “12 new orders” example.
- Refresh notices and unread state on page focus, when opening the bell popout or inbox, and
  approximately every 60 seconds while the app is visible. Do not add a live push delivery system.
- Replace audition settings' manual email recipients and administrator recipient selection with a
  dedicated “Receive audition notices” setting on roster Profiles. The setting can apply to any
  Profile, including people who are not Organization administrators. Remove the old audition
  notification configuration from the supported UI and active recipient-resolution path.
- This supersedes the earlier proposal to retain email-only manual audition recipients. Keep the
  existing audition notification persistence and delivery mechanism; change its recipient source
  once, and attach inbox persistence to that same flow.
- Non-administrator recipients also receive the notification bell and personal inbox. Each person
  sees only their own intended notices. Receiving an audition notice does not grant Audition Manager
  access: show “View audition” only when current permissions authorize that destination. This
  supersedes the mockups' admin-only placement and the original admin-only inbox terminology.
- Introduce the audition-recipient Profile setting with a default of off. At cutover, when the old
  audition notification switch is enabled, carry over each existing destination only when it maps
  unambiguously to a roster Profile in the same Organization. Do not auto-create Profiles. Flag
  unmatched or ambiguous destinations for authorized review and retire them from active delivery.
- On small screens, tapping the bell opens the full inbox directly. Desktop uses the compact popout.
  Both share the same notices and read state.

## Verified existing behavior

- ADR 0044 defines ticket-sale email alerts for financial-alert opt-ins, including complimentary
  orders, and specifies recipient resolution at send time.
- `apps/worker/src/organization/ticketSaleAlerts.ts` owns financial-alert recipient resolution.
- `apps/worker/src/organization/donationAlerts.ts` reuses that recipient resolver and queues
  Organization communications with a per-donation deduplication key.
- The financial-alert resolver currently requires an Active linked Profile, financial alerts
  enabled, and neither `doNotEmail` nor `providerEmailSuppressed`. The inbox must not bypass these
  checks with a second audience definition.
- `apps/worker/src/organization/auditionStore/notifications.ts` persists audition notification
  records, including `admin_alert`; applicant confirmations and reminders are separate kinds.
- Audition admin-alert settings store email destinations (`adminNotifyUsers`), including manually
  added addresses. These do not necessarily identify a signed-in administrator. Mapping an intended
  email recipient to an existing Organization account is distinct from choosing who receives the
  email; no parallel recipient policy should be introduced.
- The glossary now distinguishes Notification Inbox from an Organization activity feed and an email
  delivery log.

## Technical defaults for final review

- Membership revocation blocks access immediately. Losing an admin role alone does not remove a
  member's personal inbox. Related-record links require current destination permissions; a missing
  or inaccessible destination must fail safely without changing its authorization rules.
- A notice with no authorized destination remains readable and can be marked read. Use an explicit
  read action rather than a dead link. Do not grant non-admins audition-record access.
- “Mark all as read” covers all categories through a server-issued inbox snapshot boundary, rather
  than only the loaded page or selected filter. Notices arriving after that boundary remain unread.
- The badge counts unexpired unread notices in the personal inbox, with visual display capped at
  `99+`. Do not clear it optimistically when a write fails.
- Add the audition setting to the existing admin-managed roster Profile editor; this does not
  introduce member self-service editing of operational alert subscriptions.
- Keep existing status and email-suppression policies authoritative for each channel's generation.
  The new audition resolver uses the dedicated Profile flag and shared applicable email eligibility
  checks; neither an admin role nor `receiveAdminNotifications` selects audition recipients.
- Desktop popout shows the five newest unexpired notices. The full inbox uses a 25-row cursor page
  and All, Unread, Auditions, Ticket sales, and Donations filters. These are implementation
  defaults, not new limits on retained history.

## Engineering constraints for the completed plan

- Hostname-resolved Organization scope; current authorization on every read and mutation.
- Tenant operational persistence in the Organization Durable Object; RPC methods for new store
  operations; provider work outside the Durable Object runtime.
- Forward-only, rollback-compatible migrations and indexed, bounded list/count/cleanup operations.
- Repository-owned accessible UI primitives and existing design tokens; route-level code splitting.
- Preserve email delivery behavior and provider isolation; local verification uses fake effects.
- Include a File Responsibility Map, phased tasks, acceptance scenarios, migration/rollback details,
  focused verification commands, and the canonical release qualification sequence.

## Architecture and reliable generation

The inbox is a persisted receipt of an existing alert, not another notification pipeline. Do not
collect general audit events, poll provider history, parse rendered email subjects, or introduce a
second recipient resolver, queue, provider call, or live push service.

### Ticket-sale and donation attachment

Extend the existing automated-communication input with optional typed inbox metadata: notice kind,
stable source identity, original alert occurrence time, short structured summary, and a validated
internal destination reference. Pass it from `queueTicketSaleAlert` and `queueDonationAlert` through
`queueAutomatedOrganizationCommunication` to the existing send operation.

Within `communicationStore/messages.ts`, persist personal notice receipts in the same transaction
that persists the canonical email deliveries and existing scheduler outbox. Derive notice recipients
from those actual persisted deliveries, not from a second scan of preferences. A replay returning an
existing message must not create duplicate notices or resolve a new audience. Retain the existing
post-payment queue behavior: an alert failure must never reverse a purchase or donation. Verify the
current durable retry/handoff path for each originating call before implementation; where a gap
exists, close it using the existing notification job/outbox ownership, not a new inbox delivery job.

### Audition attachment and recipient replacement

Add `receiveAuditionNotifications` to the roster Profile contract and persistence, distinct from
`receiveAdminNotifications`. Update every create/update/import/default/reconciliation/fixture path
that carries Profile preferences. Do not reset the setting on an unrelated update from an older
client that omits the field. Correct existing UI copy that claims the general administrator setting
controls audition emails.

Replace the destination loop in `auditionStore/notifications.ts` with the authoritative opted-in
roster-recipient resolution. Reuse Organization-local Profile/Contact data and existing shared
eligibility rules; any identity or membership lookup in D1 belongs in Worker orchestration, never in
the Organization Durable Object runtime. Persist the intended recipient Profile ID with an
`admin_alert` email record and its inbox receipt atomically, then use the current audition delivery
job and scheduler outbox. Applicant confirmations, scheduling confirmations, reminders, signed
links, and templates retain their existing behavior. The inbox records only new-inquiry recipient
alerts.

Profiles without login access may still receive eligible email. Receipt ownership remains tied to
the intended Profile; only an authenticated, currently authorized membership linked to that Profile
can access its inbox. Never claim historical receipts by matching a new login's email address.

## Storage and API design

- Organization Durable Object owns receipts, read state, retention, migration review state, and a
  persistent inbox-start marker. D1 remains identity/control plane. No R2 or KV inbox storage.
- Proposed receipt fields: stable ID/sequence, recipient Profile ID, kind, canonical alert/source
  key, original occurrence timestamp, expiry timestamp, minimal structured summary, destination
  reference, and nullable `readAt`. Never store full email HTML, signed tokens, provider payloads,
  or unnecessary donor/buyer contact details.
- Enforce uniqueness on recipient plus canonical alert identity. Creation timestamp and identity
  come from first generation, not a provider retry. Reject pre-launch and already-expired events;
  replays must not resurrect expired notices or reset read status.
- Support bounded, deterministic newest-first cursor reads with a stable tie-breaker; validate
  cursor ownership/category and never accept a client-selected recipient or Organization.
- Justify indexes by actual queries: recipient/time/sequence list; recipient/unread query if needed;
  expiry/time cleanup; canonical identity uniqueness. Verify query plans before choosing the final
  set, especially filtered lists and unread counts. Avoid broad counts or scans on every poll.
- Use a capped indexed unread query for the `99+` badge. Bound expiration deletes and mark-all
  updates; if mark-all can exceed one safe batch, persist its snapshot watermark and perform any
  continuation through the existing scheduler, preserving immediate consistent read semantics.
- Expired rows are excluded from reads and unread state immediately, even if physical cleanup has
  not completed. Extend existing scheduler alarm helpers for indexed expiration batches, with no
  independent DO alarm owner, timers, external fetches, or `waitUntil()`.
- Proposed authenticated API: `GET /api/notifications` (filters/cursor plus snapshot and capped
  unread state), `POST /api/notifications/:id/read`, and `POST /api/notifications/read-all` with a
  validated server-issued boundary. Recheck route-name collisions and project route conventions
  during implementation. Set private `no-store` responses.
- Worker resolves hostname, Organization, actual actor, and linked Profile before typed store RPC.
  Reuse membership authorization without requiring admin status; do not reuse an admin-only guard.
  ID-based writes must include authoritative recipient scope and fail closed for another person.
- A platform support session must not gain a recipient's personal inbox by selecting their Profile.
  Define fail-closed behavior for elevation and impersonation using the existing accepted access
  contracts, with no new inbox access grant in this feature.

## File Responsibility Map

Paths below are existing owners unless explicitly marked new. New filenames are proposed and may be
adjusted to repository conventions without changing responsibilities.

| Responsibility                                      | Files or modules                                                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisions and domain language                       | This plan; `CONTEXT.md`; `docs/adr/0073-notification-inbox-from-existing-alerts.md`                                                                                                    |
| Profile flag, defaults, compatibility               | `packages/contracts/src/profiles.ts`; `apps/worker/src/organization/organizationStore/profiles.ts`; `organizationStore/storeShared.ts`; `apps/web/src/account/RosterConfiguration.tsx` |
| Profile switches and dirty tracking                 | `apps/web/src/account/components/ProfileEditor/panels/ProfileEmailPanel.tsx`; `ProfileEditorDialog.tsx`                                                                                |
| Existing audition configuration removal             | `packages/contracts/src/auditions.ts`; `apps/web/src/account/components/AuditionManager/settings/SettingsForm.tsx`; `AdminNotificationsSection.tsx`; related defaults/types/tests      |
| Audition generation and existing email jobs         | `apps/worker/src/organization/auditionStore/notifications.ts`, `contracts.ts`, `records.ts`; `apps/worker/src/jobs/deliveries/auditions.ts` and its shared schemas                     |
| Financial metadata and common send transaction      | `apps/worker/src/organization/ticketSaleAlerts.ts`; `donationAlerts.ts`; `organizationCommunications.ts`; `communicationStore/contracts.ts`, `messages.ts`                             |
| Inbox schemas and exports                           | New `packages/contracts/src/notifications.ts`; `packages/contracts/src/index.ts`                                                                                                       |
| Schema, cutover, recipient review                   | `apps/worker/src/organization/schema/migrations.ts`; new migration helper under `organization/`; existing migration tests                                                              |
| Tenant inbox reads, receipts, read writes           | New `apps/worker/src/organization/notificationInboxStore.ts`; `OrganizationStore.ts`; typed RPC client boundary as needed                                                              |
| Expiration scheduling                               | `apps/worker/src/organization/scheduler.ts`; existing scheduler alarm helpers and tests                                                                                                |
| HTTP authorization and route registration           | New `apps/worker/src/routes/memberNotifications.ts`; applicable registration in `routes/groups/`; route probes and qualification evidence                                              |
| Browser client and shared query state               | New `apps/web/src/api/notifications.ts`; existing `api/queryKeys.ts`; new shared notification hook                                                                                     |
| Bell, popout, full page                             | New `apps/web/src/account/components/NotificationInbox/` and inbox page; `AuthenticatedShell/shell.tsx`, `lazyComponents.ts`, `workspacesUtils.tsx`, and workspace route helpers       |
| Theme and layout                                    | New scoped notification stylesheet only if needed; `apps/web/src/styles/theme.css`; existing shell header/mobile styles                                                                |
| Export, profile lifecycle and retention consistency | `apps/worker/src/organization/exportStore.ts`; Profile deletion/reconciliation owners; `docs/architecture/data-model.md`                                                               |
| Regression evidence                                 | Focused contracts/unit/UI tests; Worker integration tests; desktop/mobile `apps/web/e2e/` scenario; staging route-evidence definitions                                                 |

## Implementation phases

### 1. Contracts and additive persistence

- Add the dedicated audition flag and inbox DTOs with strict schemas and typed exports.
- Allocate new forward-only migration numbers from the current head at implementation time; do not
  reserve or rewrite numbers used by concurrent work.
- Add receipt persistence, cutover marker, necessary indexes, and migration-review records.
- Preserve old audition configuration fields as deprecated, inert compatibility data until safe
  contract cleanup. Removing the supported controls does not require dropping applied columns.

### 2. Audition recipient cutover

- Normalize addresses consistently with existing Contact rules. Where the old notification switch is
  on, enable the new flag only for exactly one matching Organization Profile. A disabled old switch
  carries over no enabled preferences. Deduplicate destinations and make reruns idempotent.
- Store unresolved/ambiguous migration items for authorized roster/settings review; never expose
  them to ordinary members, logs, or public endpoints. Do not keep sending to the retired list.
- Show a concise review notice linking to affected Profile configuration; no manual-address editor.
- Make cutover atomic with its completion marker. Do not redo matching after later email changes or
  overwrite post-cutover edits. Use bounded processing if tenant data exceeds the migration budget.
- Preserve old raw configuration privately for rollback diagnostics, with active reads disabled in
  the new runtime. Confirm the new recipient preference is the single selection source.

### 3. Attach receipts to existing alerts

- Implement common receipt insertion, original-event eligibility, and deduplication helpers.
- Add financial typed metadata and atomically persist receipts with actual email delivery rows.
- Add audition Profile attribution and receipts alongside the existing admin-alert records.
- Preserve emails, provider handling, job identities, and retry ownership. Include manual donations,
  complimentary orders, and bundle behavior only as the existing canonical alerts generate them.

### 4. Personal inbox and read API

- Add typed RPC reads/writes and authorized routes for linked Organization members.
- Implement snapshot-safe mark-all, idempotent read, capped unread badge, and expiration exclusion.
- Use current record permissions for destination links; ordinary audition recipients can read the
  received summary without receiving access to applicant management or extra applicant details.
- Ensure Profile deletion removes receipts, and reconciliation does not disclose one person's
  personal history to another. Keep exports Organization-scoped and consistent with retention.

### 5. Desktop and mobile UI

- Add the bell to the Organization member/admin shell, excluding the product/platform workspace.
- Desktop opens the compact popout; mobile navigates directly to the full member-accessible inbox.
  Use one canonical member-accessible route, proposed `/account/notifications`, with shell routing
  updated consistently. Do not require visiting `/admin` to read personal notices.
- Reuse the same query/cache for popout, page, count, and mutations. Scope keys to Organization and
  authenticated recipient, clear them on sign-out/account/Organization switch, and prevent stale
  responses from the prior identity being rendered.
- Poll about every 60 seconds only while visible; refresh on focus/open, deduplicate concurrent
  requests, cancel on unmount, and back off on errors. Never erase existing data on a refresh error.
- Provide loading, empty, error, offline/stale, and expired-source states. Failed read writes show a
  retryable error and preserve unread state; do not let a failed update silently lose the notice.
- Use repository-owned Radix primitives, labelled bell/buttons, keyboard dismissal/focus return,
  visible focus, readable time labels, and read indicators beyond color. Do not add eyebrows.
- Lazy-load the full page with `lazyWithRetry`; keep the header bell lightweight and preserve both
  themes, mobile navigation, unsaved-form navigation guards, and current SaveBar integration.

### 6. Focused qualification and handoff

- Complete acceptance scenarios below, document actual results, and inspect generated bundle output.
- Run canonical comprehensive gates only when appropriate; do not duplicate full checks during
  iteration. No commit, push, or deployment is part of this documentation task.

## Acceptance and regression scenarios

1. An opted-in person receives one notice and the existing email for each supported canonical alert;
   someone excluded by the authoritative recipient rules gets neither. No extra recipient scan.
2. Provider failure, retry, duplicate webhook, and existing job replay leave exactly one notice,
   preserve read status, and do not recreate an expired or pre-launch notice.
3. A non-admin with the audition Profile flag gets the email and personal notice, with no Audition
   Manager access. Unlinked Profiles can receive email but cannot authenticate to claim an inbox.
4. The obsolete manual audition list no longer selects recipients. The generic administrator flag
   alone does not select audition recipients. Applicant confirmation/reminder flows remain intact.
5. Migration handles enabled/disabled old settings, case-normalized matches, duplicates, missing and
   ambiguous matches, Profiles without login accounts, retry, and edits after cutover.
6. Opening either list does not mark read. Clicking a notice or its explicit read action does.
   Mark-all affects the snapshot across filters/pages; a concurrent new notice stays unread.
7. Preference-off preserves received history; membership revocation blocks it. Record-role changes
   remove unauthorized links. Missing source records fail safely with no information disclosure.
8. At the 90-day boundary, read and unread notices disappear from list/count before cleanup runs.
   Cleanup is bounded and indexed; polling does not scan the Organization's growing history.
9. Another recipient ID, forged cursor/boundary, wrong Organization host, stale identity response,
   platform elevation, and impersonation cannot disclose or mutate another person's inbox.
10. Desktop popout and full page stay consistent; mobile bell opens the page. Focus/open/60-second
    refresh works, stops while hidden, handles failures, and does not discard unsaved Profile edits.
11. Keyboard, screen-reader labels, focus return, mobile targets, light/dark contrast, and existing
    header/navigation layouts pass focused UI/browser coverage.
12. New flag survives create/edit/import/reconciliation/export round trips as applicable, and
    omitted fields from compatible clients do not reset it. Existing roster CSV columns remain
    unchanged unless a separately reviewed CSV-contract change is required.

## Verification commands and release boundary

For implementation iteration, use focused Vitest suites for contracts, migrations, receipt store,
audition generation, financial send integration, route authorization, and UI behavior. Run
`npm run typecheck`, `npm run lint`, `npm run check:contracts:exports`, `npm run check:do-runtime`,
and `npm run check:routes` for affected boundaries. Format touched documents/code with Prettier.

Build the deployable artifact before `npm run test:integration:prepared`. Add focused Chromium and
mobile-Chromium inbox scenarios and update route coverage and `npm run qualify:staging:evidence`
definitions for new endpoints. Use fake providers locally; no real messages or charges.

If later authorized to release: focused checks → cohesive local commit → `npm run check:release` on
the clean committed candidate → push → authorized `npm run deploy:staging -- --yes`. Follow ADR 0051
evidence reuse and the staging runbook; do not run a redundant full gate immediately before release
qualification, use direct Wrangler promotion, add GitHub workflows, or modify production.

## Migration, rollback, and risks

- Retain additive schema and old raw audition configuration; never reverse migrations. New Profile
  preferences and inbox data must survive rollback, with no replay backfill when the feature
  returns.
- A pre-cutover runtime would resume reading retired manual recipients and ignore new Profile
  choices. It is therefore not a safe behavioral rollback after cutover. Qualify a compatibility
  baseline that understands the new recipient source before enabling the inbox, or use a forward fix
  retaining that boundary. Keep one guarded promotion at a time; verify rollback artifacts.
- Operational notice data stays Organization-local; route access is personal, not a new admin data
  grant. Receipt summaries must contain no more detail than the recipient's existing alert.
- The deliberate consequence of shared eligibility is that an email opt-out/suppression can prevent
  notice generation too; delivery failure after generation does not erase a notice.
- Email generation remains an external-effect boundary with the existing outbox/retries. Atomic
  receipt insertion must not add a second retry layer or cause purchase fulfillment to replay.
- Migration review items may contain personal email addresses and need existing admin authorization,
  redaction, and bounded retention consistent with the application's data handling.
- Receipt volume grows per intended recipient. Use indexed pagination, bounded counts/cleanup,
  request deduplication, and no new real-time infrastructure or recurring all-tenant scans.

## Visual references and generated artifacts

The selected desktop references are the compact dropdown from mockup 1 and full inbox from mockup 3.
The interview supersedes grouped sales and admin-only access shown in those images. Generated
mockups are design references, not production assets or executable specifications. No generated
application artifact or database migration exists yet. At implementation handoff, list generated
contracts/build artifacts and their standard regeneration commands, and preserve unrelated
website-CMS work.

## Verification of this planning work

Repository inspection, focused Prettier formatting/checks, and `git diff --check` passed.
Application tests and release gates have not run because this is documentation-only planning, with
no feature implementation or release candidate. Unrelated working-tree changes were preserved.
