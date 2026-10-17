# ADR 0057: Ticket-enabled Performances are public

Status: Accepted

Enabling ticket sales on a Performance also enables its public website visibility. This replaces the
former option to keep a ticket-enabled Performance off the Organization's public schedule while
sharing its purchase URL. The event editor selects and locks public visibility while ticketing is
on, and the Organization store normalizes both create and update requests so older clients cannot
save a ticket-enabled Performance with public visibility off. Only public description and graphic
fields enter the website projection; private details remain private.

Disabling ticket sales leaves the requested public visibility unchanged. Administrators can then
explicitly hide the Performance. Non-ticketed events keep their existing visibility behavior.
Migration 118 marks existing ticket-enabled Performances public. Canceled and archived events remain
excluded by the publication query. No new endpoints, providers, or indexes are introduced.

The explicit website publication boundary remains in place: saving an event or applying this
migration does not publish website drafts or mutate existing immutable projections. The event editor
explains that administrators must publish the website draft to update the public schedule.

Rollback leaves the visibility flags enabled by migration 118; it does not restore former hidden
states. Older binaries can independently change the flags again. Published versions remain intact.
