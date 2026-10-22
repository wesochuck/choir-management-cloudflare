import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createContactTestAdapter } from "./contactTestkit";
import { organizationSchemaMigrations } from "./schema/migrations";
import {
  startLoudness,
  enqueueAttachedLoudness,
  loudnessStatus,
  loudnessFailures,
  claimLoudness,
  bindLoudnessVersion,
  submitLoudness,
  renewLoudness,
  readLoudness,
} from "./loudnessStore";
function setup() {
  const db = new DatabaseSync(":memory:");
  const { storage } = createContactTestAdapter(db);
  for (const migration of organizationSchemaMigrations)
    for (const statement of migration.statements) storage.sql.exec(statement);
  storage.sql.exec(
    "INSERT INTO organization_metadata (organization_id,name,slug,timezone,created_at,updated_at) VALUES ('org-a','A','a','UTC','2026-01-01','2026-01-01')",
  );
  const fileId = crypto.randomUUID();
  storage.sql.exec(
    "INSERT INTO private_files (id, storage_key, file_name, content_type, size_bytes, status, uploaded_by, request_id, created_at, r2_version) VALUES (?, 'organizations/org-a/private/file', 'track.mp3', 'audio/mpeg', 123, 'ready', 'admin', 'request', '2026-01-01', 'v1')",
    fileId,
  );
  storage.sql.exec(
    "INSERT INTO music_pieces (id,title,track_file_ids_json,created_at,updated_at) VALUES ('piece','Piece',?,'2026-01-01','2026-01-01')",
    JSON.stringify({ tutti: fileId, soprano: fileId }),
  );
  return { storage, fileId };
}
function requireClaim<T>(value: T | null): T {
  if (!value) throw new Error("Expected claim");
  return value;
}
const scope = { organizationId: "org-a", actorUserId: "admin" };
describe("Organization audio analysis claims", () => {
  it("deduplicates, serializes claims, binds versions and commits idempotently", () => {
    const { storage, fileId } = setup();
    expect(startLoudness(storage, { ...scope, options: {} }).queued).toBe(1);
    const claim = requireClaim(claimLoudness(storage, scope));
    expect(claim.fileId).toBe(fileId);
    expect(claimLoudness(storage, { ...scope, actorUserId: "other" })).toBeNull();
    expect(bindLoudnessVersion(storage, { ...scope, ...claim, contentVersion: "wrong" })).toBe(
      false,
    );
    expect(bindLoudnessVersion(storage, { ...scope, ...claim, contentVersion: "v1" })).toBe(true);
    const submission = {
      fileId,
      claimId: claim.claimId,
      result: {
        status: "ready",
        analysisVersion: 1,
        contentVersion: "v1",
        integratedLufs: -26,
        truePeakDbtp: -3,
      },
    };
    expect(submitLoudness(storage, { ...scope, actorUserId: "other", submission })).toBe(false);
    expect(submitLoudness(storage, { ...scope, submission })).toBe(true);
    expect(submitLoudness(storage, { ...scope, submission })).toBe(true);
    expect(readLoudness(storage, [fileId])[fileId]).toMatchObject({
      integratedLufs: -26,
      targetLufs: -18,
    });
    storage.sql.exec("UPDATE organization_metadata SET practice_loudness_target_lufs = -14");
    expect(readLoudness(storage, [fileId])[fileId]).toMatchObject({
      integratedLufs: -26,
      targetLufs: -14,
    });
    expect(readLoudness(storage, [])).toEqual({});
    storage.sql.exec("UPDATE private_files SET r2_version = 'v2' WHERE id = ?", fileId);
    expect(readLoudness(storage, [fileId])).toEqual({});
  });
  it("rejects wrong Organization, detached assets, expired claims and invalid measurements", () => {
    const { storage, fileId } = setup();
    expect(() =>
      startLoudness(storage, { ...scope, organizationId: "org-b", options: {} }),
    ).toThrow("organization_identity_conflict");
    startLoudness(storage, { ...scope, options: {} });
    const claim = requireClaim(claimLoudness(storage, scope));
    const submission = {
      fileId,
      claimId: claim.claimId,
      result: {
        status: "ready",
        analysisVersion: 1,
        contentVersion: "v1",
        integratedLufs: -26,
        truePeakDbtp: -3,
      },
    };
    expect(() =>
      submitLoudness(storage, {
        ...scope,
        submission: { ...submission, result: { ...submission.result, truePeakDbtp: Infinity } },
      }),
    ).toThrow();
    storage.sql.exec("UPDATE music_pieces SET track_file_ids_json = '{}' WHERE id = 'piece'");
    expect(submitLoudness(storage, { ...scope, submission })).toBe(false);
    storage.sql.exec(
      "UPDATE music_pieces SET track_file_ids_json = ? WHERE id = 'piece'",
      JSON.stringify({ tutti: fileId }),
    );
    storage.sql.exec("UPDATE audio_loudness SET lease_until = 0");
    expect(submitLoudness(storage, { ...scope, submission })).toBe(false);
    const replacement = requireClaim(claimLoudness(storage, scope));
    expect(replacement.claimId).not.toBe(claim.claimId);
    expect(renewLoudness(storage, { ...scope, claimId: claim.claimId, release: false })).toBe(
      false,
    );
  });
  it("persists attachment work and keeps bounded status counters consistent", () => {
    const { storage, fileId } = setup();
    enqueueAttachedLoudness(storage, "piece", [fileId, fileId]);
    enqueueAttachedLoudness(storage, "piece", [fileId]);
    expect(loudnessStatus(storage, "org-a").find((row) => row.status === "pending")?.count).toBe(1);
    const claim = requireClaim(claimLoudness(storage, { ...scope, fileId }));
    expect(loudnessStatus(storage, "org-a").find((row) => row.status === "processing")?.count).toBe(
      1,
    );
    expect(renewLoudness(storage, { ...scope, claimId: claim.claimId, release: true })).toBe(true);
    storage.sql.exec(
      "UPDATE audio_loudness SET status = 'ready', analysis_version = 0, content_version = 'old'",
    );
    startLoudness(storage, { ...scope, options: {} });
    expect(loudnessStatus(storage, "org-a").find((row) => row.status === "pending")?.count).toBe(1);
    expect(loudnessStatus(storage, "org-a").find((row) => row.status === "ready")?.count).toBe(0);
    storage.sql.exec(
      "UPDATE audio_loudness SET status = 'failed', reason_code = 'invalid_audio' WHERE file_id = ?",
      fileId,
    );
    const failures = loudnessFailures(storage, "org-a");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({
      fileId,
      fileName: "track.mp3",
      pieceTitle: "Piece",
      status: "failed",
      reasonCode: "invalid_audio",
    });
  });
  it("uses selective indexes for claims and lease recovery", () => {
    const { storage } = setup();
    for (const [query, index] of [
      [
        "SELECT file_id FROM audio_loudness WHERE status = 'pending' ORDER BY file_id LIMIT 1",
        "audio_loudness_status",
      ],
      [
        "SELECT file_id FROM audio_loudness WHERE status = 'processing' AND lease_until <= 0",
        "audio_loudness_status",
      ],
      [
        "SELECT a.file_id FROM audio_loudness a WHERE a.status IN ('failed', 'unsupported')",
        "audio_loudness_status",
      ],
    ]) {
      const plan = storage.sql
        .exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${String(query)}`)
        .toArray()
        .map((row) => row.detail)
        .join(" ");
      expect(plan).toContain(index);
    }
  });
});
