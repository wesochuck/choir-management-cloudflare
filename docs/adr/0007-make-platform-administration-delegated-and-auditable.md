# Make Platform Administration Delegated and Auditable

A Platform Administrator may enter any single Organization Scope and easily elevate from viewing to
editing without acquiring an Organization Membership or impersonating another person. Elevation is
explicit and visibly indicated for the active scope, expires when its bounded session ends, and
every operational write records the Platform Administrator as its actor.

**Why:** Platform Administrators are expected to perform most Organization administration, so an
exceptional, high-friction support workflow would obstruct the primary operating model. Direct
delegated access preserves speed while single-Organization scoping, mandatory platform MFA, visible
edit state, bounded elevation, and immutable attribution trade some separation of duties for
practical managed-service operation.
