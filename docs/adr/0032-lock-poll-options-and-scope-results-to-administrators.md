# Lock poll options on response and scope results to administrators

**Status:** accepted

Poll option structures must be immutable once at least one response has been recorded, preventing
option deletion or ID reassignment from invalidating existing votes. Administrators may still update
non-structural metadata (title, description, and expiration date) or archive the poll. Poll result
details, including option percentage distributions, raw counts, and respondent rosters with voice
parts, are strictly scoped to Organization Administrators and Owners in the management portal and
are not exposed on public voter endpoints.
