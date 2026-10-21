import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { dbAllUnknown, descriptorValue, runMigrations } from "../contactTestkit";

function tableNames(db: DatabaseSync): Set<string> {
  const names = new Set<string>();
  for (const row of dbAllUnknown(db, "SELECT name FROM sqlite_master WHERE type = 'table'")) {
    if (typeof row === "object" && row !== null) {
      const name = descriptorValue(row, "name");
      if (typeof name === "string") names.add(name);
    }
  }
  return names;
}

function indexNames(db: DatabaseSync, table: string): Set<string> {
  const names = new Set<string>();
  for (const row of dbAllUnknown(db, `PRAGMA index_list(${table})`)) {
    if (typeof row === "object" && row !== null) {
      const name = descriptorValue(row, "name");
      if (typeof name === "string") names.add(name);
    }
  }
  return names;
}

function explainDetails(db: DatabaseSync, query: string): string[] {
  const details: string[] = [];
  for (const row of dbAllUnknown(db, `EXPLAIN QUERY PLAN ${query}`)) {
    if (typeof row === "object" && row !== null) {
      const detail = descriptorValue(row, "detail");
      if (typeof detail === "string") details.push(detail);
    }
  }
  return details;
}

function planUsesIndex(db: DatabaseSync, query: string, index: string): boolean {
  return explainDetails(db, query).some((detail) => detail.includes(index));
}

describe("music track import session migration (v121)", () => {
  it("creates the session ledger on a fresh database", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    const tables = tableNames(db);
    for (const table of [
      "music_track_import_sessions",
      "music_track_import_items",
      "music_track_import_file_attempts",
      "music_track_import_commit_receipts",
    ]) {
      expect(tables.has(table)).toBe(true);
    }
    const sessionIndexes = indexNames(db, "music_track_import_sessions");
    expect(sessionIndexes.has("idx_music_import_sessions_actor_batch")).toBe(true);
    expect(sessionIndexes.has("idx_music_import_sessions_actor_state")).toBe(true);
    expect(sessionIndexes.has("idx_music_import_sessions_cleanup_due")).toBe(true);
    expect(sessionIndexes.has("idx_music_import_sessions_expiry")).toBe(true);
  });

  it("upgrades a populated v120 database without losing operational data", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, 120);
    expect(tableNames(db).has("music_track_import_sessions")).toBe(false);
    db.prepare(
      `INSERT INTO music_pieces
        (id, title, track_file_ids_json, created_at, updated_at)
       VALUES ('piece-1', 'Shenandoah', '{"S1":"file-1"}', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO private_files
        (id, storage_key, file_name, content_type, size_bytes, status, uploaded_by, request_id, created_at)
       VALUES ('file-1', 'organizations/org/private/file-1', 'track.mp3', 'audio/mpeg', 10, 'ready', 'actor', 'req', '2026-10-01T00:00:00.000Z')`,
    ).run();

    runMigrations(db);

    expect(tableNames(db).has("music_track_import_sessions")).toBe(true);
    const [pieceRow] = dbAllUnknown(
      db,
      "SELECT track_file_ids_json AS tracks FROM music_pieces WHERE id = 'piece-1'",
    );
    if (typeof pieceRow !== "object" || pieceRow === null) {
      throw new Error("Expected the seeded music piece to survive the upgrade.");
    }
    expect(JSON.parse(String(descriptorValue(pieceRow, "tracks")))).toEqual({ S1: "file-1" });
  });

  it("serves the resume, expiry, and cleanup sweeps from indexes", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    expect(
      planUsesIndex(
        db,
        `SELECT id FROM music_track_import_sessions
         WHERE actor_user_id = 'actor' AND state IN ('active', 'partial')
         ORDER BY last_user_action_at DESC LIMIT 20`,
        "idx_music_import_sessions_actor_state",
      ),
    ).toBe(true);
    expect(
      planUsesIndex(
        db,
        `SELECT id FROM music_track_import_sessions
         WHERE state IN ('cancel_requested', 'cleanup_pending', 'expired')
           AND next_cleanup_due_at IS NOT NULL AND next_cleanup_due_at <= '2026-10-21T00:00:00.000Z'
         ORDER BY next_cleanup_due_at LIMIT 10`,
        "idx_music_import_sessions_cleanup_due",
      ),
    ).toBe(true);
    expect(
      planUsesIndex(
        db,
        `SELECT id FROM music_track_import_sessions
         WHERE state IN ('active', 'partial')
           AND (expires_at <= '2026-10-21T00:00:00.000Z' OR absolute_expires_at <= '2026-10-21T00:00:00.000Z')
         ORDER BY expires_at LIMIT 10`,
        "idx_music_import_sessions_expiry",
      ),
    ).toBe(true);
    expect(
      planUsesIndex(
        db,
        `SELECT id FROM music_track_import_items WHERE session_id = 'session' AND status = 'uploaded'`,
        "idx_music_import_items_session_status",
      ),
    ).toBe(true);
  });
});
