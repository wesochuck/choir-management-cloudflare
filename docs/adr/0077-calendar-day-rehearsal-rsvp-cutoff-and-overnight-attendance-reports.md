# ADR 0077: Calendar-Day Rehearsal RSVP Cutoff and Overnight Attendance Reports

- Status: Accepted
- Date: 2026-11-05

## Context

Previously, member self-service RSVP for Rehearsals closed at event start time (`startsAt`), while
post-event attendance report generation was scheduled for a hardcoded 12 hours after `startsAt` (ADR
0029, ADR 0035). Members who fell ill or experienced last-minute evening emergencies during or
immediately after rehearsal could not submit a decline note via the dashboard or schedule.
Additionally, the 12-hour offset produced morning or afternoon delivery times depending on the
rehearsal start hour rather than a predictable, quiet overnight schedule.

## Decision

1. **Rehearsal self-service cutoff**: Member self-service RSVP for Rehearsals remains open through
   the end of the rehearsal's local calendar day (11:59:59 PM in the Organization's configured
   timezone). Once local midnight has passed, self-service RSVP closes
   (`rsvpSelfServiceOpen: false`), and subsequent member submissions are rejected with HTTP 409
   `rsvp_closed`. Rehearsals continue to have no administrative RSVP deadline (`rsvpDeadlineAt` and
   `rsvpDeadlineDate` remain null).
2. **Overnight attendance report scheduling**: Attendance report generation and delivery for both
   Rehearsals and Performances is scheduled for 1:00 AM in the Organization's timezone on the
   calendar day following the event, replacing the hardcoded 12-hour post-start delay.
3. **Alignment**: Running attendance report generation at 1:00 AM guarantees that members have until
   the end of the rehearsal day (11:59:59 PM) to enter their decline notes and reasons before the
   automated attendance report is compiled and sent to leadership.
4. **Timezone awareness**: Report due dates and calendar day boundaries are evaluated using the
   Organization's authoritative timezone from `organization_metadata`, correctly handling Daylight
   Saving Time transitions.

## Compatibility and rollback

No database schema migration, backfill, or external infrastructure modification is required.
Existing hostname-resolved Organization boundaries and role authorizations remain intact. Reverting
the application code restores the 12-hour delay and start-time rehearsal cutoff without data loss or
rollback complications.
