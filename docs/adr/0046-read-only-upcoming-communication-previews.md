# Read-only upcoming communication previews

Communications shows upcoming automated sends before the scheduler creates delivery jobs. A
read-only, Organization-local projection derives event reminders, RSVP follow-ups, ticket reminders
(including bundle allocations), and attendance reports from current events, purchases, and settings.
Predictions cover the next 90 days, have stable namespaced identifiers, and are labeled as
automation previews. Actual recipients and eligibility are resolved at delivery time. Existing
persisted notifications remain visible beyond the preview window.

Timing constants and RSVP deadline/override calculations are shared with the scheduler. Reads never
write the outbox or change alarms. Edits and cancellations are reflected on the next read. Existing
outbox/ledger keys and ticket notification dedupe keys suppress duplicate predictions.

Persisted future queued notifications display Scheduled until their queue handoff. Processing and
terminal states take precedence. Both paginated history and the compatibility list apply these
rules. Scheduled history uses ascending send time with stable keyset tie breakers; other history
retains descending order. The UI shows the Organization timezone and refreshes on window focus.

The scheduler only hands off jobs with due_at at or before its clock. Alarm ownership remains in
scheduler.ts, which wakes at the earlier of its cadence and the next pending job. Full batches of
future jobs do not cause continuation loops. Provider delivery, tenant boundaries, stable job
idempotency, and manual immediate-send behavior are unchanged.

Organization migration 101 adds a partial index for active Performance RSVP deadlines. This supports
deadline-bounded previews even when the event is months away. The index is additive and compatible
with the previous Worker; no data is rewritten. Contract fields are additive; projected IDs are
read-only and are never passed to delivery or mutation methods. Older clients can reject unfamiliar
IDs and should be rolled back with the Worker version. Rolling back scheduler.ts also restores its
prior early-job handoff behavior, so retaining the timing guard is preferable during a UI rollback.
