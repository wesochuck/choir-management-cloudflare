# ADR 0064: Attendance warnings in seating workflows

- Status: Accepted
- Date: 2026-10-25

## Decision

The configured rehearsal warning threshold is an allowed count. A singer receives an attendance
warning only when their linked-rehearsal count is **strictly greater than** that threshold. This
comparison applies consistently to seating, member event warnings, and scheduled attendance report
warnings. It does not change Profile Status, RSVP, or seating eligibility.

Seating uses the selected Performance's linked, non-archived, non-canceled Rehearsals and the
existing member warning definition: explicit Absent attendance, or Pending attendance with an
explicit No RSVP. Missing records and Pending attendance without No are not counted as misses.
Scheduled reports retain their existing event-finalization and reporting-window rules.

The manager-only attendance response adds optional, nullable warning metadata for every returned
Profile, including non-attending Profiles used by roster lookup. Counts are aggregated once per
selected Performance inside its hostname-resolved Organization store using the existing parent-event
and event-roster indexes. There is no additional endpoint, provider call, or schema migration.

A compact warning triangle and count accompanies a flagged singer in chart tiles, assignment
candidates, unassigned chips, Profile lookup, drag previews, list view, and the last-name index.
Tile badges share the voice-part line without increasing tile height. Accessible labels and hover
text explain the count and threshold. Seat dialogs and magnified seats include row and seat numbers.

The unchecked-by-default “Hide attendance warnings” checkbox filters only the unassigned tray and
combines with name search. Checking it hides counts over the threshold; counts at the threshold
remain visible. It never mutates RSVP or removes assigned seats. Roster lookup and assignment
dialogs continue to show warnings rather than silently making singers ineligible.

## Compatibility and rollback

Older responses may omit warning metadata, which renders without a badge. New fields are additive
and ignored by older clients. Reverting this change requires no data rollback. No hosted resource or
external-effect configuration changes are involved.
