import { enqueueAttachedLoudness } from "../loudnessStore";
import type { MusicTrackAttachmentResult } from "@choir/contracts";
import type { z } from "zod";
import type { musicOperationSchema } from "./types.js";

type AttachOperation = Extract<
  z.infer<typeof musicOperationSchema>,
  { readonly action: "attach_tracks" }
>;

interface StoredPieceForAttach {
  durationSeconds: number | null;
  id: string;
  isDirty: boolean;
  trackFileIds: Record<string, string>;
}

interface AuditEntry {
  actorUserId: string;
  fileId: string;
  partKey: string;
  pieceId: string;
  requestId: string;
}

function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function resolveValidAudioFileIds(
  storage: DurableObjectStorage,
  fileIds: readonly string[],
): Set<string> {
  const validIds = new Set<string>();
  const chunks = chunkArray(fileIds, 50);
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const rows = storage.sql
      .exec<{ readonly id: string }>(
        `SELECT id FROM private_files
         WHERE id IN (${placeholders})
           AND status = 'ready'
           AND content_type LIKE 'audio/%'`,
        ...chunk,
      )
      .toArray();
    for (const row of rows) {
      validIds.add(row.id);
    }
  }
  return validIds;
}

function fetchPiecesForAttachment(
  storage: DurableObjectStorage,
  pieceIds: readonly string[],
): Map<string, StoredPieceForAttach> {
  const pieces = new Map<string, StoredPieceForAttach>();
  const chunks = chunkArray(pieceIds, 50);
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const rows = storage.sql
      .exec<{
        readonly durationSeconds: number | null;
        readonly id: string;
        readonly trackFileIdsJson: string;
      }>(
        `SELECT id, duration_seconds AS durationSeconds, track_file_ids_json AS trackFileIdsJson
         FROM music_pieces
         WHERE id IN (${placeholders})`,
        ...chunk,
      )
      .toArray();
    for (const row of rows) {
      let trackFileIds: Record<string, string> = {};
      try {
        const parsed = JSON.parse(row.trackFileIdsJson) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") {
              trackFileIds[k] = v;
            }
          }
        }
      } catch {
        trackFileIds = {};
      }
      pieces.set(row.id, {
        durationSeconds: row.durationSeconds,
        id: row.id,
        isDirty: false,
        trackFileIds,
      });
    }
  }
  return pieces;
}

function evaluateSingleAssignment(
  assignment: AttachOperation["assignments"][number],
  piece: StoredPieceForAttach | undefined,
  validAudioFileIds: ReadonlySet<string>,
): {
  auditEntry: AuditEntry | null;
  result: MusicTrackAttachmentResult;
} {
  if (!validAudioFileIds.has(assignment.fileId)) {
    return {
      auditEntry: null,
      result: {
        durationUpdated: false,
        fileId: assignment.fileId,
        partKey: assignment.partKey,
        pieceId: assignment.pieceId,
        reason: "Invalid or unready audio file",
        status: "failed",
      },
    };
  }

  if (!piece) {
    return {
      auditEntry: null,
      result: {
        durationUpdated: false,
        fileId: assignment.fileId,
        partKey: assignment.partKey,
        pieceId: assignment.pieceId,
        reason: "Music piece not found",
        status: "failed",
      },
    };
  }

  const existingFileId = piece.trackFileIds[assignment.partKey];
  if (existingFileId === assignment.fileId) {
    return {
      auditEntry: null,
      result: {
        durationUpdated: false,
        fileId: assignment.fileId,
        partKey: assignment.partKey,
        pieceId: assignment.pieceId,
        status: "attached",
      },
    };
  }

  if (existingFileId && existingFileId !== assignment.fileId) {
    return {
      auditEntry: null,
      result: {
        durationUpdated: false,
        fileId: assignment.fileId,
        partKey: assignment.partKey,
        pieceId: assignment.pieceId,
        reason: "Slot already occupied by existing track",
        status: "conflict",
      },
    };
  }

  // Empty slot: attach!
  piece.trackFileIds[assignment.partKey] = assignment.fileId;
  const durationUpdated =
    (piece.durationSeconds === null || piece.durationSeconds === 0) &&
    typeof assignment.durationSeconds === "number" &&
    assignment.durationSeconds > 0;
  if (durationUpdated && typeof assignment.durationSeconds === "number") {
    piece.durationSeconds = assignment.durationSeconds;
  }
  piece.isDirty = true;

  return {
    auditEntry: {
      actorUserId: "",
      fileId: assignment.fileId,
      partKey: assignment.partKey,
      pieceId: assignment.pieceId,
      requestId: "",
    },
    result: {
      durationUpdated,
      fileId: assignment.fileId,
      partKey: assignment.partKey,
      pieceId: assignment.pieceId,
      status: "attached",
    },
  };
}

export function attachTracksInStore(
  storage: DurableObjectStorage,
  operation: AttachOperation,
): Response {
  const uniqueFileIds = Array.from(new Set(operation.assignments.map((a) => a.fileId)));
  const uniquePieceIds = Array.from(new Set(operation.assignments.map((a) => a.pieceId)));

  const validAudioFileIds = resolveValidAudioFileIds(storage, uniqueFileIds);
  const pieces = fetchPiecesForAttachment(storage, uniquePieceIds);

  const results: MusicTrackAttachmentResult[] = [];
  const pendingAudits: AuditEntry[] = [];

  for (const assignment of operation.assignments) {
    const piece = pieces.get(assignment.pieceId);
    const { auditEntry, result } = evaluateSingleAssignment(assignment, piece, validAudioFileIds);
    if (auditEntry) {
      pendingAudits.push({
        ...auditEntry,
        actorUserId: operation.actorUserId,
        requestId: operation.requestId,
      });
    }
    results.push(result);
  }

  const occurredAt = new Date().toISOString();

  storage.transactionSync(() => {
    for (const piece of pieces.values()) {
      if (!piece.isDirty) continue;
      storage.sql.exec(
        `UPDATE music_pieces
         SET track_file_ids_json = ?, duration_seconds = ?, updated_at = ?
         WHERE id = ?`,
        JSON.stringify(piece.trackFileIds),
        piece.durationSeconds,
        occurredAt,
        piece.id,
      );
    }

    for (const audit of pendingAudits) {
      enqueueAttachedLoudness(storage, audit.pieceId, [audit.fileId]);
      storage.sql.exec(
        `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'music.track.attached', 'music_piece', ?, ?, ?, ?)`,
        crypto.randomUUID(),
        audit.actorUserId,
        audit.pieceId,
        audit.requestId,
        JSON.stringify({ fileId: audit.fileId, partKey: audit.partKey }),
        occurredAt,
      );
    }
  });

  const summary = {
    attached: results.filter((r) => r.status === "attached").length,
    conflict: results.filter((r) => r.status === "conflict").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  };

  return Response.json({ results, summary });
}
