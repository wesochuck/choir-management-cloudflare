# Produce Portable Organization Exports Without Import

The Functional Parity Release will let Organization Owners and Platform Administrators generate a
versioned ZIP containing a manifest, the Organization's records, its audit history, and original
uploaded files. Existing roster, music-library, event-RSVP, donation, attendance,
repertoire-history, and will-call CSV contracts will be reused; structured records that cannot be
represented without loss will also be included as JSON. The archive has no whole-archive import or
restore path.

**Why:** A portable export gives organizations practical custody of their data without introducing
the lifecycle, conflict-resolution, credential, and recovery semantics of a backup-and-restore
system. Reusing established CSV contracts preserves familiar downstream workflows, while a manifest
and JSON retain fidelity. This deliberately leaves deletion, timed recovery, purge automation,
restoration, and archive import outside v1.
