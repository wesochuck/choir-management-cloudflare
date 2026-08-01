# Deliver Scheduled Event Communications Through System Templates

Scheduled event communications use the Organization Communication Center's protected system
templates and tenant-local delivery history rather than a separate provider path. A Pending RSVP
Follow-up is a distinct one-time email to unresolved Performance RSVPs, while Automated Reminders
serve confirmed attendees; Attendance Reports are generated after event finalization and use the
same template and delivery machinery. Fake, Disabled, Sandbox, and Production modes remain explicit
so local and preview environments never contact real providers.

**Why:** The legacy scheduler already identifies these jobs, but a no-op consumer makes the feature
look complete while delivering nothing. Sharing the existing template, provider, suppression, retry,
and history path makes delivery observable and editable, while the separate RSVP follow-up prevents
confirmed-attendee reminders from being misused to chase unanswered RSVPs.

## Consequences

- Performance RSVP follow-ups default to 48 hours before the RSVP deadline and support Organization
  defaults plus per-event inherit, override, or disable behavior.
- Attendance Reports run once 12 hours after Performances and Rehearsals, finalize unmarked
  attendance, and use an independent warning threshold whose default is one missed Rehearsal.
- Reports normally go to opted-in Owners and Administrators and fall back to a reachable Owner when
  necessary; hard email suppression still wins.
- Fake and Disabled delivery outcomes are recorded distinctly and shown with the active delivery
  mode so an environment cannot be mistaken for live delivery.
