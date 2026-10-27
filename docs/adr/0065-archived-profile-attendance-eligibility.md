# ADR 0065: Archived Profile attendance eligibility

- Status: Accepted
- Date: 2026-10-26

## Decision

Routine attendance lists and updates exclude Profiles with both `hidden = 1` (Off roster) and
`global_status = 'Inactive'`. This is the existing Archive/Restore lifecycle combination; there is
no dedicated archive flag. Manual status management is not an eligibility criterion. Directory
opt-out alone, visibility-only Off roster Active/On Break Profiles, and ordinary on-roster
Inactive/On Break Profiles retain their existing attendance eligibility. Attendance can therefore
still record returning singers and apply existing RSVP/status recovery rules.

Apply the same predicate in the Organization store before the attendance list limit and before any
single or bulk attendance write. Reject the entire stale batch with HTTP 409 and
`attendance_profile_ineligible` if any selected Profile has been archived. The client preserves the
typed explanation and refreshes attendance after settlement; polling, search, counters, progress,
and bulk targets all consume the same server-filtered rows. Keep identity keyed by Profile ID so
equal names never merge.

Historical attendance reports, event rosters, RSVP history, Profile Status History, and audit
records remain intact. Restore makes the existing Profile eligible again and reuses its existing
event roster rows. This does not change membership authorization, directory publication, status
automation, or other RSVP entry points.

## Compatibility and rollback

No migration, new index, data cleanup, provider call, or hosted configuration change is required.
Batch validation uses primary-key lookups over the bounded request IDs. The existing attendance read
keeps its bounded result and ordering. Reverting the code restores the previous inclusion behavior
without a data rollback. Existing clients receive a rejected save and can refresh safely.
