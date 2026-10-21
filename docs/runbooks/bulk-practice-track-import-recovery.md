# Bulk Practice-Track Import Recovery Runbook

Session-backed bulk imports stage reviewed MP3 manifests in the Organization Durable Object
(`music_track_import_*` tables, schema v121), upload each file under a server-minted private file
UUID, and attach only through exactly-once commit receipts. A crashed browser, expired lease, or
failed provider call leaves a resumable session — never a half-attached catalog.

## First response

1. Identify one Organization scope from safe routing/job metadata. Never scan across tenants;
   session, file, and audit IDs are Organization-scoped.
2. Determine the session state first: `active`/`partial` (resumable), `cleanup_pending` (discarded
   or expired, reclamation running), `completed`/`discarded`/`expired` (terminal).
3. Preserve typed raw provider details for the formatter while redacting credentials, authorization
   headers, full signed tokens, OTPs, recovery codes, and sensitive payload fields.
4. Check the session detail endpoint, attempt history, commit receipts, `music_track_import_cleanup`
   queue depth, dead letters, and Organization audit history before touching anything.

## Resumable sessions (active / partial)

- The wizard offers resume automatically when a saved session context exists. The administrator
  reselects the original files; the browser verifies exact filename, size, lastModified, and the
  SHA-256 digest before adopting the server state.
- Already-uploaded files are never re-sent: claim replays return the stored file UUID with
  `already_uploaded`, and commit reuses uploaded file IDs.
- A changed assignment set after session creation must be reconfirmed (PATCH with the reviewed
  `expectedRevision`); a `stale_revision` response means another tab changed the mapping — refresh
  the session and review again, never force a commit with an old revision.
- Commits are idempotent per `(sessionId, commitKey)`: replaying the same revision returns the
  original receipt; the same key with different assignments is a 409 that requires a fresh commit
  key after reconfirmation.

## Stale and expired sessions

- Idle sessions expire after 24 hours without a state-changing user action; the absolute lifetime is
  7 days even with repeated resumes. Status polling, scheduler work, and cleanup retries never
  extend expiration.
- An expired session rejects uploads, assignment changes, and commits with `session_expired` (409).
  Start a new import; the expired session's orphaned uploads are reclaimed by the hourly cleanup
  sweep.
- A replayed batch key (`clientBatchKey`) resolves to the same session when the manifest is
  identical, and is a 409 `idempotency_conflict` when the manifest differs. Old keys never create a
  fresh import by replay.

## Orphaned R2 cleanup (`music_track_import_cleanup`)

- Discard and expiry enqueue one cleanup execution per session through the scheduler outbox with
  round-scoped idempotency keys (`music-track-import-cleanup:{org}:{session}:round:{n}`); each
  execution settles at most 25 attempts and schedules one bounded continuation when work remains.
- An execution claims only cleanup-eligible attempts: `ready` files, `failed` rows, and
  `reserved`/`uploading` attempts whose 15-minute lease has expired. Live leases and referenced
  files are never claimed.
- Ready files go through the standard private-file reclaim flow (claim → exact-key R2 delete →
  finalize); abandoned pending uploads get an exact-key R2 delete followed by the
  pending-reservation abort.
- A crashed execution leaves attempts in `cleanup_pending`; the next sweep re-picks claims older
  than one hour, so retries are self-healing. Attempts stuck longer than 24 hours raise the
  actionable `orphan` audit signal with the session ID — investigate the provider cause, then let
  the sweep finish the work. Do not manually delete R2 keys: the recorded attempt ledger is the only
  authority for which keys belong to the session.

## Files attached by the retired direct path

- Uploads that bypassed sessions (the retired direct attach flow) have no attempt ledger. Handle
  them with the normal single-file tools:
  - An attached file is a live catalog track; unlink it from the piece through the Music Library
    editor, which runs the standard reference check before deletion.
  - An unattached direct upload is a regular pending private file; reclaim it through the file
    pipeline, never by guessing R2 keys.
- A file the session cleanup reports as still referenced is kept by design; resolve the reference in
  the Music Library and let the next sweep settle it.

## What never to do

- Never copy, rename, or forge R2 keys: the recorded storage key on each attempt is the only key the
  cleanup worker may delete.
- Never attach a UUID the browser supplied: file IDs are minted server-side at claim time.
- Never run cleanup SQL directly against the session tables; use the queue/scheduler path so
  attempts, receipts, and audits stay consistent.
- Never widen scheduler or queue budgets to "catch up" faster than 10 sessions per scan and 25
  attempts per execution; backpressure is the correctness mechanism.
