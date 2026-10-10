# Organization compliance catalog with responsible administrator

## Status

Accepted.

## Context

Issue #120 extends the nonprofit compliance reminder tracker (#101) into an administrator-managed
catalog of recurring Organization compliance tasks. Organizations can add, edit, archive, and
restore their own reminders; built-in requirements remain available as seeded templates. A fourth
built-in, Ohio Annual Unclaimed Funds Report, is added. Each task may designate one responsible
Owner or Administrator, but every reminder is still delivered to all currently eligible Owners and
Administrators.

Current implementation (main at time of writing):

- `apps/web/src/account/OrganizationNonprofitCompliancePanel.tsx`: nonprofit toggle plus fixed-task
  editing and completion.
- `apps/worker/src/organization/complianceStore.ts`: hardcoded `DEFAULT_COMPLIANCE_TASKS` (three
  kinds), kind-keyed scheduler lookup.
- `packages/contracts/src/nonprofitCompliance.ts`: fixed kind enum, `tasks.max(10)`, no
  creation/deletion or assignee.
- `apps/worker/src/organization/schema/migrations.ts` v98–v99: compliance tables, reminder index,
  completions index.
- `apps/worker/src/routes/organizationCompliance.ts`: toggle, update, complete.
- `apps/worker/src/jobs/deliveries/compliance.ts`: all owner/admin fanout, kind-keyed idempotency
  `nonprofit-compliance:{org}:{kind}:{due}:{occurrence}`.

## Decision

### 1. Generic catalog versus nonprofit toggle

Rename the tracker toward **Compliance & deadlines** in the UI while preserving the existing
nonprofit toggle behavior for built-in tasks.

- `nonprofit_enabled` continues to gate **built-in** (`source: 'builtin'`) reminders only. Disabling
  preserves built-in dates, completions, and audit history, and stops built-in reminders.
- **Custom** reminders (`source: 'custom'`) remain readable, editable, and scheduled independently
  of the nonprofit flag. The catalog is therefore usable for an Organization whose nonprofit toggle
  is off.
- Built-in rows remain identifiable by stable `templateKey` (equal to the historic `kind` for the
  four defaults). Task IDs remain stable UUIDs and are the sole scheduler/delivery key going
  forward. Legacy kind-keyed queued jobs are dual-read until they drain.
- Built-in tasks cannot be hard-deleted and cannot be archived; they can only be marked Not
  Applicable (paused). Custom tasks support reversible archive (soft-delete, halts scheduling,
  retains history). No hard deletion of records with completion history.

### 2. Data model

Additive forward-only Organization DO migration v106 rebuilds `organization_compliance_tasks` to
support the catalog without resetting IDs, dates, completions, or reminder state:

- `source TEXT NOT NULL DEFAULT 'builtin' CHECK (source IN ('builtin','custom'))`
- `template_key TEXT UNIQUE` (builtin: stable kind string; custom: NULL)
- `kind TEXT UNIQUE` retained for backward compatibility (builtin: kind string; custom: NULL; SQLite
  UNIQUE permits multiple NULLs)
- `description TEXT NOT NULL DEFAULT ''` (max 2000, organization notes)
- `reference_url TEXT` (optional, http/https only, max 2048)
- `archived INTEGER NOT NULL DEFAULT 0`
- `responsible_membership_id TEXT`, `responsible_user_id TEXT` (nullable; authoritative key is the
  D1 `member.id` scoped to the Organization, with the `user.id` retained for attribution when the
  membership is removed)
- Existing columns (`title`, `applicable`, `recurrence_months`, `next_due_date`,
  `last_completed_date`, `next_reminder_at`, `reminder_interval_days`) unchanged.

Existing three rows backfill `source='builtin'`, `template_key=kind`, `archived=0`. Completions
table is untouched.

Task cap: **50 total tasks per Organization (active plus archived)**. Enforced identically in
contracts (Zod `max(50)`), store (count check in transaction), API (409 when exceeded), and UI (Add
disabled with explanation). Scheduler work remains bounded because enumeration is capped and the
reminder query uses the existing selective partial index extended with `archived = 0`.

### 3. Ohio unclaimed-funds built-in

Stable kind/templateKey `ohio_unclaimed_funds_annual_report`, 12-month recurrence, yearly suggested
target **October 31** (conservative suggested date for the Ohio Rev. Code §169.03(D) "before
November 1 as of June 30" boundary, labeled as a suggestion, not legal advice, editable for
extensions).

- Seeded once per Organization with nonprofit tracking enabled (existing orgs via idempotent
  backfill in the enable path and migration-time seeding helper; later-enabled orgs via the enable
  path). `INSERT OR IGNORE` on `kind` and on `template_key` guarantees exactly-once semantics under
  concurrent enablement.
- New row is seeded with the next future October 31 and `next_reminder_at` NULL, so no backdated
  burst occurs. If deployment occurs after October 31, the next year's October 31 is suggested.
  Admins may correct for an outstanding filing via the normal editor. Previously Not Applicable
  built-ins are never reactivated by seeding.
- Description avoids categorical filing claims, notes negative-report certification (OAC
  1301:10-3-03(B)), exemptions, and owner due-diligence timing as help text, with official links
  stored as the reference URL base. The app never auto-submits filings and never asserts legal
  applicability.

### 4. Responsible administrator

- Optional single assignee per task, restricted to current active Owners and Administrators from
  authoritative D1 Better Auth `member` records. The picker shows name plus email, never
  voice-part/status. Ordinary members cannot be assigned. Stored key is `member.id` (plus `user.id`
  for history), never free-text email.
- Eligibility is validated Worker-side at assignment time **and again at delivery time** to handle
  removal/demotion races. If the assignee loses eligibility, the task retains the stale IDs for
  audit but the UI and email show **Needs reassignment**; delivery continues to all currently
  eligible admins. Reassignment is audited.
- Email content addresses the responsible person informationally (`Responsible: Name (email)` or
  `Unassigned` / `Needs reassignment` warning) but the recipient set is unchanged: one deduplicated
  email to every eligible Owner/Admin each occurrence. Assignment never adds an ordinary-member
  recipient and never creates a duplicate send to the assignee.

### 5. Scheduler and delivery compatibility

- New idempotency key:
  `nonprofit-compliance:{organizationId}:{taskId}:{cycleDueDate}:{occurrenceDate}`.
- Delivery dual-reads: if segment 3 parses as a UUID and matches a task ID, resolve by ID; otherwise
  treat it as a legacy kind and resolve by kind for old queued jobs. Both paths revalidate: task
  exists, not archived, applicable (builtin additionally requires nonprofit enabled; custom tasks do
  not), `nextDueDate` matches `cycleDueDate`, and recipient selection is current.
  Stale/deleted/completed/archived jobs are dropped without send.
- `findDueComplianceReminders` returns builtin due reminders only when nonprofit is enabled, plus
  custom due reminders regardless of the flag, all filtered by `archived = 0`. Recurrence still
  anchors to the previous due date, weekly cadence and organization-local timezone are unchanged.

## Consequences

- Route additions (`POST /tasks`, `PATCH /tasks/:id` extended, `POST /tasks/:id/archive`,
  `POST /tasks/:id/restore`, `GET /compliance/assignees`) are additive; old toggle/update/complete
  routes remain compatible.
- Every mutation is audited with actor, Organization, task ID/kind, and change summary.
- Tenant isolation is preserved: no client-supplied Organization ID selects storage; hostname
  registry plus membership authorization gate every route; the DO never calls D1 or providers inside
  transactions.
- Tests cover migration idempotency, history preservation, cap enforcement, assignee races,
  all-admin fanout invariance, legacy-job compatibility, and no-blast seeding.
