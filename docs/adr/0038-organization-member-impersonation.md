# Organization Member Impersonation

Organization Administrators and Organization Owners may temporarily impersonate any
non-administrative Organization Profile on their Organization's roster to assist members,
troubleshoot issues, and manage participation on their behalf.

Impersonation operates strictly within the host Organization's tenant boundary and provides complete
self-service member parity across dashboard, schedule, practice tracks, bulletins, polls, profile
details, and billing. Administrators may not impersonate other Organization Administrators or
Organization Owners.

Impersonation sessions are ephemeral and time-bounded (60 minutes maximum), presenting a persistent,
high-contrast banner (`Viewing as [Member Name] — [Exit Impersonation]`) across all pages. Clicking
"Exit Impersonation" immediately terminates the session and returns the administrator to the Roster.

All mutations and lifecycle changes performed during an active impersonation session are recorded
with dual-actor attribution in Organization Audit History and domain histories (e.g. Event RSVP
History), explicitly identifying the administrator acting on behalf of the member. Transactional
notifications resulting from actions taken during impersonation are dispatched to the member's email
on file with an administrative copy sent to the acting administrator.

**Why:** Choirs rely heavily on volunteer directors and administrators to support members of varying
technical fluency who need hands-on assistance setting RSVPs, accessing learning tracks, or updating
personal details. Providing seamless in-session impersonation within the Organization boundary
avoids cumbersome credential exchanges or complex support elevation flows while preserving strict
tenant isolation, administrative privilege boundaries, transparency, and audit accountability.
