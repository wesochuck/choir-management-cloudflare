# ADR 0074: Declined rehearsals display as absent

- Status: Accepted
- Date: 2026-11-02

## Decision

An explicit No RSVP to a Rehearsal is displayed as Absent when recorded attendance is Pending. The
attendance manager includes these declined absences in its All and Absent lists and counts without
requiring a search, retaining the Declined label and the existing non-attending group. The default
Unmarked filter continues to show only those awaiting attendance. Expected and Present counts and
bulk check-in targets continue to use Yes RSVPs.

Apply the same absence definition in the manager's linked rehearsal attendance report, consistent
with the existing warning definition in ADR 0064. Inherited No from a parent Performance alone does
not create a rehearsal absence. Performance and Other event attendance behavior is unchanged.

Derive the automatic absence on read, preserving stored attendance. This immediately covers existing
declines and allows a later Yes RSVP to remove the automatic absence. Manually recorded Present or
Absent attendance always takes precedence. Scheduled post-event finalization remains unchanged;
finalized absences are recorded attendance and survive later RSVP changes.

Clicking a declined absence offers the existing confirmed check-in flow, which reconciles the
Rehearsal and linked Performance RSVPs to Yes under ADR 0017. Bulk check-in excludes declines.
Member rehearsal declines still require a note; Yes RSVPs never require one.

## Compatibility and rollback

No schema migration, backfill, new index, route, provider effect, or hosted configuration change is
required. Existing hostname-resolved Organization boundaries and attendance eligibility remain in
force. Reads use existing bounded, indexed event/profile joins. Reverting the application change
restores the previous display and report behavior without a data rollback.
