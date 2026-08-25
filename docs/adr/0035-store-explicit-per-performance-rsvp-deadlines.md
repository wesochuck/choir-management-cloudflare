# Set Explicit Per-Performance RSVP Deadlines

Every Performance stores an administrator-set RSVP Deadline date; no deadline is calculated from a
lead-time rule. The Organization-wide RSVP Expiry setting loses its lead-days input and survives
only as the switch that converts remaining Pending responses to No after an event's stored deadline
passes. Deadlines are date-only and stay open through 11:59 p.m. Organization time; past dates are
allowed with a warning; extending a passed deadline reopens member self-service while recorded
history stays immutable.

This replaces the derived-deadline model (start minus configured lead days) because administrators
need per-event control of the member close date, and a calculation rule cannot express that. The
backfill preserves each cohort's lived behavior: Organizations with Expiry enabled receive their
previously calculated dates, while Organizations with Expiry disabled receive their own start-date
end-of-day, approximating the old open-until-showtime reality so nothing newly closes. Rehearsals
keep no deadline at all, matching their exemption from RSVP Expiry.

Considered options: an optional per-event override over the calculation (rejected — keeps two
sources of truth for one visible date); making conversion unconditional without a toggle (rejected —
auto-conversion feeds Profile Status Automation misses, so the off switch remains the safety valve).
Refines ADR-0020 (the seven-day default becomes the migration backfill source, not a live rule) and
ADR-0026 (self-service still closes at the deadline; the deadline is now stored).
