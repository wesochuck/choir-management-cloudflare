import { describe, expect, it } from "vitest";

import {
  chunkMusicTrackImport,
  computeMusicTrackImportAttemptLease,
  computeMusicTrackImportExpiries,
  isRecoverableImportSessionState,
  isTerminalImportSessionState,
  MUSIC_TRACK_IMPORT_ABSOLUTE_EXPIRY_SECONDS,
  MUSIC_TRACK_IMPORT_ATTEMPT_LEASE_SECONDS,
  MUSIC_TRACK_IMPORT_CLEANUP_BATCH_SIZE,
  MUSIC_TRACK_IMPORT_CLEANUP_SWEEP_LIMIT,
  MUSIC_TRACK_IMPORT_COMMIT_CHUNK_SIZE,
  MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS,
  MUSIC_TRACK_IMPORT_MAX_ITEMS,
  MUSIC_TRACK_IMPORT_UPLOAD_CONCURRENCY,
  musicTrackImportCleanupJobIdempotencyKey,
} from "./musicTrackImport";

describe("music track import limits", () => {
  it("enforces the fixed implementation budgets", () => {
    expect(MUSIC_TRACK_IMPORT_MAX_ITEMS).toBe(100);
    expect(MUSIC_TRACK_IMPORT_UPLOAD_CONCURRENCY).toBe(3);
    expect(MUSIC_TRACK_IMPORT_COMMIT_CHUNK_SIZE).toBe(25);
    expect(MUSIC_TRACK_IMPORT_CLEANUP_BATCH_SIZE).toBe(25);
    expect(MUSIC_TRACK_IMPORT_CLEANUP_SWEEP_LIMIT).toBe(10);
    expect(MUSIC_TRACK_IMPORT_ATTEMPT_LEASE_SECONDS).toBe(900);
    expect(MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS).toBe(86_400);
    expect(MUSIC_TRACK_IMPORT_ABSOLUTE_EXPIRY_SECONDS).toBe(7 * 86_400);
  });

  it("classifies session states", () => {
    expect(isRecoverableImportSessionState("active")).toBe(true);
    expect(isRecoverableImportSessionState("partial")).toBe(true);
    expect(isRecoverableImportSessionState("completed")).toBe(false);
    expect(isRecoverableImportSessionState("cleanup_pending")).toBe(false);
    expect(isTerminalImportSessionState("completed")).toBe(true);
    expect(isTerminalImportSessionState("discarded")).toBe(true);
    expect(isTerminalImportSessionState("expired")).toBe(true);
    expect(isTerminalImportSessionState("active")).toBe(false);
  });

  it("computes idle and absolute expiries from now", () => {
    const now = Date.parse("2026-10-21T00:00:00.000Z");
    const expiries = computeMusicTrackImportExpiries(now);
    expect(expiries.expiresAt).toBe("2026-10-22T00:00:00.000Z");
    expect(expiries.absoluteExpiresAt).toBe("2026-10-28T00:00:00.000Z");
    expect(computeMusicTrackImportAttemptLease(now)).toBe("2026-10-21T00:15:00.000Z");
  });

  it("chunks commit work into bounded transactions", () => {
    const values = Array.from({ length: 30 }, (_, index) => index);
    expect(chunkMusicTrackImport(values, 25)).toEqual([values.slice(0, 25), values.slice(25)]);
    expect(chunkMusicTrackImport([], 25)).toEqual([]);
  });

  it("builds stable cleanup idempotency keys", () => {
    expect(musicTrackImportCleanupJobIdempotencyKey("org-1", "session-1", 0)).toBe(
      "music-track-import-cleanup:org-1:session-1:round:0",
    );
    expect(
      musicTrackImportCleanupJobIdempotencyKey("org-1", "session-1", 0) ===
        musicTrackImportCleanupJobIdempotencyKey("org-1", "session-1", 1),
    ).toBe(false);
  });
});
