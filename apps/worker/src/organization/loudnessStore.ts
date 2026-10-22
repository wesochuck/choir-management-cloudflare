import {
  loudnessStartSchema,
  loudnessSubmitSchema,
  loudnessMeasurementSchema,
  type LoudnessMeasurement,
  type LoudnessFailure,
} from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";

interface LoudnessStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: readonly unknown[]
    ): { toArray(): T[] };
  };
  transactionSync<T>(callback: () => T): T;
}
interface Scope {
  readonly requestId?: string | undefined;
  readonly organizationId: string;
  readonly actorUserId: string;
}
const LEASE_MS = 120_000;
function verifyLoudnessScope(storage: LoudnessStorage, organizationId: string): void {
  const row = storage.sql
    .exec<{ organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()[0];
  if (row?.organizationId !== organizationId) throw new Error("organization_identity_conflict");
}
function attached(storage: LoudnessStorage, fileId: string): boolean {
  // Indexed job polling never uses this scan. Only batch start and result commit validate mappings.
  return (
    storage.sql
      .exec<{ found: number }>(
        `SELECT 1 AS found FROM music_pieces m, json_each(m.track_file_ids_json) j
         WHERE m.id IN (SELECT value FROM json_each((SELECT piece_ids_json FROM audio_loudness WHERE file_id = ?))) AND j.value = ? LIMIT 1`,
        fileId,
        fileId,
      )
      .toArray().length > 0
  );
}
/** Called in the attachment transaction; indexes private files directly, without a catalog scan. */
export function enqueueAttachedLoudness(
  storage: LoudnessStorage,
  pieceId: string,
  fileIds: readonly string[],
): void {
  for (const fileId of new Set(fileIds))
    storage.sql.exec(
      `
    INSERT INTO audio_loudness(file_id, content_version, status, piece_ids_json, reason_code)
    SELECT id, r2_version, CASE WHEN content_type = 'audio/mpeg' THEN 'pending' ELSE 'unsupported' END,
      json_array(?), CASE WHEN content_type = 'audio/mpeg' THEN NULL ELSE 'unsupported_format' END
    FROM private_files WHERE id = ? AND status = 'ready' AND content_type LIKE 'audio/%'
    ON CONFLICT(file_id) DO UPDATE SET piece_ids_json = (
      SELECT json_group_array(value) FROM (SELECT value FROM json_each(audio_loudness.piece_ids_json) UNION SELECT ?)
    ) WHERE NOT EXISTS (SELECT 1 FROM json_each(audio_loudness.piece_ids_json) WHERE value = ?)
  `,
      pieceId,
      fileId,
      pieceId,
      pieceId,
    );
}
export function startLoudness(
  storage: LoudnessStorage,
  input: Scope & { readonly options: unknown },
) {
  verifyLoudnessScope(storage, input.organizationId);
  const options = loudnessStartSchema.parse(input.options);
  return storage.transactionSync(() => {
    const rows = storage.sql
      .exec<{ id: string; version: string | null; contentType: string; pieceIds: string }>(
        `SELECT DISTINCT f.id, f.r2_version AS version, f.content_type AS contentType, json_group_array(DISTINCT m.id) AS pieceIds
      FROM music_pieces m, json_each(m.track_file_ids_json) j JOIN private_files f ON f.id = j.value
      WHERE f.status = 'ready' AND (? IS NULL OR f.id = ?) GROUP BY f.id LIMIT 10001`,
        options.fileId ?? null,
        options.fileId ?? null,
      )
      .toArray();
    if (rows.length > 10000) throw new Error("loudness_batch_limit");
    if (!options.fileId)
      storage.sql.exec(
        `DELETE FROM audio_loudness WHERE file_id NOT IN (SELECT j.value FROM music_pieces m, json_each(m.track_file_ids_json) j)`,
      );
    for (const row of rows) {
      storage.sql.exec(
        `INSERT INTO audio_loudness(file_id, content_version, status, piece_ids_json) VALUES (?, ?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET piece_ids_json = excluded.piece_ids_json`,
        row.id,
        row.version,
        row.contentType === "audio/mpeg" ? "pending" : "unsupported",
        row.pieceIds,
      );
      storage.sql.exec(
        `UPDATE audio_loudness SET status = 'pending', analysis_version = 1, claim_id = NULL, lease_until = NULL
        WHERE file_id = ? AND status <> 'processing' AND ? = 'audio/mpeg' AND (content_version IS NOT ? OR analysis_version <> 1)`,
        row.id,
        row.contentType,
        row.version,
      );
      if (options.mode !== "resume")
        storage.sql.exec(
          `UPDATE audio_loudness SET status = 'pending', claim_id = NULL, lease_until = NULL WHERE file_id = ? AND status <> 'processing' AND (? = 'reanalyze_all' OR status = 'failed') AND ? = 'audio/mpeg'`,
          row.id,
          options.mode,
          row.contentType,
        );
    }
    auditAnalysis(storage, input, "music.loudness.started", "batch", {
      mode: options.mode,
      queued: rows.length,
    });
    return { queued: rows.length };
  });
}
export function loudnessStatus(storage: LoudnessStorage, organizationId: string) {
  verifyLoudnessScope(storage, organizationId);
  return storage.sql
    .exec<{ status: string; count: number }>(
      "SELECT status, count FROM audio_loudness_counts ORDER BY status",
    )
    .toArray();
}
export function loudnessFailures(
  storage: LoudnessStorage,
  organizationId: string,
): LoudnessFailure[] {
  verifyLoudnessScope(storage, organizationId);
  return storage.sql
    .exec<{
      fileId: string;
      fileName: string;
      pieceTitle: string;
      status: "failed" | "unsupported";
      reasonCode:
        "invalid_audio" | "unsupported_format" | "processing_limit" | "analysis_unavailable" | null;
    }>(
      `SELECT
        a.file_id AS fileId,
        COALESCE(f.file_name, a.file_id) AS fileName,
        COALESCE(
          (SELECT GROUP_CONCAT(m.title, ', ') FROM music_pieces m WHERE m.id IN (SELECT value FROM json_each(a.piece_ids_json))),
          'Unassigned'
        ) AS pieceTitle,
        a.status,
        a.reason_code AS reasonCode
      FROM audio_loudness a
      LEFT JOIN private_files f ON f.id = a.file_id
      WHERE a.status IN ('failed', 'unsupported')
      ORDER BY a.status, fileName
      LIMIT 100`,
    )
    .toArray();
}
export function claimLoudness(
  storage: LoudnessStorage,
  input: Scope & { readonly fileId?: string | undefined },
) {
  verifyLoudnessScope(storage, input.organizationId);
  return storage.transactionSync(() => {
    const now = Date.now();
    storage.sql.exec(
      "UPDATE audio_loudness SET status = 'pending', claim_id = NULL, lease_until = NULL WHERE status = 'processing' AND lease_until <= ?",
      now,
    );
    if (
      storage.sql
        .exec("SELECT file_id FROM audio_loudness WHERE status = 'processing' LIMIT 1")
        .toArray().length
    )
      return null;
    const row = storage.sql
      .exec<{
        fileId: string;
        storageKey: string;
        sizeBytes: number;
        contentVersion: string | null;
      }>(
        `SELECT a.file_id AS fileId, f.storage_key AS storageKey, f.size_bytes AS sizeBytes, f.r2_version AS contentVersion FROM audio_loudness a JOIN private_files f ON f.id = a.file_id WHERE a.status = 'pending' AND f.status = 'ready' AND f.content_type = 'audio/mpeg' ${input.fileId ? "AND a.file_id = ?" : ""} ORDER BY a.file_id LIMIT 1`,
        ...(input.fileId ? [input.fileId] : []),
      )
      .toArray()[0];
    if (!row) return null;
    const claimId = crypto.randomUUID();
    storage.sql.exec(
      "UPDATE audio_loudness SET status = 'processing', claim_id = ?, actor_id = ?, lease_until = ? WHERE file_id = ?",
      claimId,
      input.actorUserId,
      now + LEASE_MS,
      row.fileId,
    );
    return { ...row, claimId };
  });
}
export function bindLoudnessVersion(
  storage: LoudnessStorage,
  input: Scope & {
    readonly fileId: string;
    readonly claimId: string;
    readonly contentVersion: string;
  },
) {
  verifyLoudnessScope(storage, input.organizationId);
  return storage.transactionSync(() => {
    const valid = storage.sql
      .exec(
        "SELECT file_id FROM audio_loudness WHERE file_id = ? AND claim_id = ? AND actor_id = ? AND status = 'processing' AND lease_until > ?",
        input.fileId,
        input.claimId,
        input.actorUserId,
        Date.now(),
      )
      .toArray().length;
    if (!valid) return false;
    storage.sql.exec(
      "UPDATE private_files SET r2_version = ? WHERE id = ? AND status = 'ready' AND (r2_version IS NULL OR r2_version = ?)",
      input.contentVersion,
      input.fileId,
      input.contentVersion,
    );
    if (storage.sql.exec<{ count: number }>("SELECT changes() AS count").toArray()[0]?.count !== 1)
      return false;
    storage.sql.exec(
      "UPDATE audio_loudness SET content_version = ? WHERE file_id = ?",
      input.contentVersion,
      input.fileId,
    );
    return true;
  });
}
export function renewLoudness(
  storage: LoudnessStorage,
  input: Scope & { readonly claimId: string; readonly release: boolean },
) {
  verifyLoudnessScope(storage, input.organizationId);
  storage.sql.exec(
    `UPDATE audio_loudness SET lease_until = ?, status = ? WHERE claim_id = ? AND actor_id = ? AND status = 'processing' AND lease_until > ?`,
    input.release ? 0 : Date.now() + LEASE_MS,
    input.release ? "pending" : "processing",
    input.claimId,
    input.actorUserId,
    Date.now(),
  );
  return storage.sql.exec<{ count: number }>("SELECT changes() AS count").toArray()[0]?.count === 1;
}
export function submitLoudness(
  storage: LoudnessStorage,
  input: Scope & { readonly submission: unknown },
) {
  verifyLoudnessScope(storage, input.organizationId);
  const { fileId, claimId, result } = loudnessSubmitSchema.parse(input.submission);
  return storage.transactionSync(() => {
    const row = storage.sql
      .exec<{
        status: string;
        claimId: string | null;
        version: string | null;
        actor: string | null;
        lease: number | null;
      }>(
        `SELECT a.status, a.claim_id AS claimId, a.actor_id AS actor, a.lease_until AS lease, f.r2_version AS version FROM audio_loudness a JOIN private_files f ON a.file_id = f.id WHERE a.file_id = ? AND f.status = 'ready' AND f.content_type = 'audio/mpeg'`,
        fileId,
      )
      .toArray()[0];
    if (
      row?.claimId !== claimId ||
      row.actor !== input.actorUserId ||
      row.version !== result.contentVersion ||
      !attached(storage, fileId)
    )
      return false;
    if (row.status === result.status) return true; // Same completed claim is idempotent.
    if (row.status !== "processing" || (row.lease ?? 0) <= Date.now()) return false;
    storage.sql.exec(
      `UPDATE audio_loudness SET status = ?, analysis_version = ?, content_version = ?, integrated_lufs = ?, true_peak_dbtp = ?, reason_code = ?, analyzed_at = ?, lease_until = NULL, decoder_name = 'mpg123-decoder', decoder_version = '1.0.3', meter_name = 'bravoh-loudness', meter_version = '0.1.0' WHERE file_id = ?`,
      result.status,
      result.analysisVersion,
      result.contentVersion,
      result.status === "ready" ? result.integratedLufs : null,
      result.status === "ready" ? result.truePeakDbtp : null,
      result.status !== "ready" ? result.reasonCode : null,
      new Date().toISOString(),
      fileId,
    );
    auditAnalysis(storage, input, "music.loudness.analyzed", fileId, {
      status: result.status,
      analysisVersion: result.analysisVersion,
    });
    return true;
  });
}
export function readLoudness(
  storage: LoudnessStorage,
  fileIds: readonly string[],
): Record<string, LoudnessMeasurement> {
  const result: Record<string, LoudnessMeasurement> = {};
  const ids = [...new Set(fileIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const rows = storage.sql
      .exec<{
        fileId: string;
        analysisVersion: number;
        contentVersion: string;
        integratedLufs: number;
        truePeakDbtp: number;
      }>(
        `SELECT (SELECT practice_loudness_target_lufs FROM organization_metadata LIMIT 1) AS targetLufs, a.file_id AS fileId, a.analysis_version AS analysisVersion, a.content_version AS contentVersion, a.integrated_lufs AS integratedLufs, a.true_peak_dbtp AS truePeakDbtp FROM audio_loudness a JOIN private_files f ON f.id = a.file_id WHERE a.status = 'ready' AND f.status = 'ready' AND a.content_version = f.r2_version AND a.file_id IN (${batch.map(() => "?").join(",")})`,
        ...batch,
      )
      .toArray();
    for (const row of rows) {
      const parsed = loudnessMeasurementSchema.safeParse(row);
      if (parsed.success) result[row.fileId] = parsed.data;
    }
  }
  return result;
}

function auditAnalysis(
  storage: LoudnessStorage,
  scope: Scope,
  action: string,
  target: string,
  summary: Record<string, string | number>,
) {
  storage.sql.exec(
    `INSERT INTO audit_events (id,actor_type,actor_id,action,target_type,target_id,request_id,change_summary,occurred_at) VALUES (?, 'organization_member', ?, ?, 'audio_loudness', ?, ?, ?, ?)`,
    crypto.randomUUID(),
    scope.actorUserId,
    action,
    target,
    scope.requestId ?? crypto.randomUUID(),
    JSON.stringify(summary),
    new Date().toISOString(),
  );
}
