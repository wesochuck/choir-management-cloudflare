/**
 * Durable bulk practice-track import limits and pure scheduling helpers.
 *
 * Numeric policy lives here so the Worker (sessions, uploads, commits,
 * cleanup) and the browser wizard share one source of truth. All helpers
 * are pure and side-effect free; persistence lives in the Organization
 * Durable Object store.
 */

/** Maximum manifest rows staged per import session. */
export const MUSIC_TRACK_IMPORT_MAX_ITEMS = 100;

/** Maximum MP3 bytes accepted per import file (matches the file pipeline). */
export const MUSIC_TRACK_IMPORT_MAX_BYTES = 20 * 1024 * 1024;

/** Browser upload parallelism for session files. */
export const MUSIC_TRACK_IMPORT_UPLOAD_CONCURRENCY = 3;

/** Maximum track attachments committed in one Durable Object transaction. */
export const MUSIC_TRACK_IMPORT_COMMIT_CHUNK_SIZE = 25;

/** Maximum cleanup attempts settled per queue execution. */
export const MUSIC_TRACK_IMPORT_CLEANUP_BATCH_SIZE = 25;

/** Maximum sessions swept per Organization scheduler pass. */
export const MUSIC_TRACK_IMPORT_CLEANUP_SWEEP_LIMIT = 10;

/** Per upload attempt lease in seconds: a crashed upload becomes reclaimable after this. */
export const MUSIC_TRACK_IMPORT_ATTEMPT_LEASE_SECONDS = 15 * 60;

/** Idle session expiry in seconds without a state-changing user action. */
export const MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS = 24 * 60 * 60;

/** Absolute session lifetime in seconds even when repeatedly resumed. */
export const MUSIC_TRACK_IMPORT_ABSOLUTE_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/** Terminal file-level diagnostics are kept at least this long after cleanup. */
export const MUSIC_TRACK_IMPORT_DIAGNOSTIC_RETENTION_SECONDS = 30 * 24 * 60 * 60;

/** Bounded cleanup retry backoff window in seconds. */
export const MUSIC_TRACK_IMPORT_CLEANUP_RETRY_MIN_SECONDS = 60;
export const MUSIC_TRACK_IMPORT_CLEANUP_RETRY_MAX_SECONDS = 60 * 60;

/** Cleanup-eligible attempts older than this emit the actionable orphan signal. */
export const MUSIC_TRACK_IMPORT_ORPHAN_ALERT_AFTER_SECONDS = 24 * 60 * 60;

export type MusicTrackImportSessionRuntimeState =
  | "active"
  | "partial"
  | "completed"
  | "cancel_requested"
  | "cleanup_pending"
  | "discarded"
  | "expired";

const RECOVERABLE_IMPORT_SESSION_STATES: ReadonlySet<MusicTrackImportSessionRuntimeState> = new Set(
  ["active", "partial"],
);

const TERMINAL_IMPORT_SESSION_STATES: ReadonlySet<MusicTrackImportSessionRuntimeState> = new Set([
  "completed",
  "discarded",
  "expired",
]);

export function isRecoverableImportSessionState(
  state: MusicTrackImportSessionRuntimeState,
): boolean {
  return RECOVERABLE_IMPORT_SESSION_STATES.has(state);
}

export function isTerminalImportSessionState(state: MusicTrackImportSessionRuntimeState): boolean {
  return TERMINAL_IMPORT_SESSION_STATES.has(state);
}

export function computeMusicTrackImportExpiries(nowMs: number): {
  readonly absoluteExpiresAt: string;
  readonly expiresAt: string;
} {
  return {
    absoluteExpiresAt: new Date(
      nowMs + MUSIC_TRACK_IMPORT_ABSOLUTE_EXPIRY_SECONDS * 1000,
    ).toISOString(),
    expiresAt: new Date(nowMs + MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS * 1000).toISOString(),
  };
}

export function computeMusicTrackImportAttemptLease(nowMs: number): string {
  return new Date(nowMs + MUSIC_TRACK_IMPORT_ATTEMPT_LEASE_SECONDS * 1000).toISOString();
}

export function chunkMusicTrackImport<T>(values: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

export function musicTrackImportCleanupJobIdempotencyKey(
  organizationId: string,
  sessionId: string,
  round: number,
): string {
  return `music-track-import-cleanup:${organizationId}:${sessionId}:round:${String(round)}`;
}
