import { organizationMusicPieceRequestSchema } from "@choir/contracts";
import type { OrganizationMusicPiece, OrganizationMusicPieceRequest } from "@choir/contracts";
import type { z } from "zod";

import { addPerformanceHistory } from "./types.js";
import type { musicOperationSchema } from "./types.js";
import { eventReferencesPiece, readPiece, requestFromPiece } from "./crud.js";
import { validatePiece } from "./validation.js";

function insertAudit(
  storage: DurableObjectStorage,
  operation: { readonly actorUserId: string; readonly pieceId: string; readonly requestId: string },
  action: string,
  summary: Record<string, unknown>,
  occurredAt: string,
  auditKey: string,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, 'music_piece', ?, ?, ?, ?)`,
    `music:${action}:${auditKey}`,
    operation.actorUserId,
    action,
    operation.pieceId,
    operation.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

export function bulkUpdatePieces(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "bulk_update" }>,
): Response {
  const pieces = operation.pieceIds.map((pieceId) => readPiece(storage, pieceId));
  if (pieces.some((piece) => piece === null)) {
    return Response.json({ code: "music_piece_not_found" }, { status: 404 });
  }
  const storedPieces = pieces.filter((piece): piece is OrganizationMusicPiece => piece !== null);
  const requests: { piece: OrganizationMusicPieceRequest; pieceId: string }[] = storedPieces.map(
    (stored) => ({
      piece: organizationMusicPieceRequestSchema.parse({
        ...requestFromPiece(stored),
        ...operation.changes,
      }),
      pieceId: stored.id,
    }),
  );
  for (const { piece, pieceId } of requests) {
    const validation = validatePiece(storage, pieceId, piece);
    if (validation) return validation;
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    for (const { piece, pieceId } of requests) {
      storage.sql.exec(
        `UPDATE music_pieces
         SET title = ?, composer = ?, arranger = ?, purchase_date = ?, copies = ?, catalog_id = ?,
           duration_seconds = ?, notes = ?, section_buckets_json = ?, genres_json = ?, parent_id = ?,
           track_file_ids_json = ?, updated_at = ?
         WHERE id = ?`,
        piece.title,
        piece.composer,
        piece.arranger,
        piece.purchaseDate,
        piece.copies,
        piece.catalogId,
        piece.durationSeconds,
        piece.notes,
        JSON.stringify(piece.sectionBuckets),
        JSON.stringify(piece.genres),
        piece.parentId,
        JSON.stringify(piece.trackFileIds),
        occurredAt,
        pieceId,
      );
      insertAudit(
        storage,
        {
          actorUserId: operation.actorUserId,
          requestId: operation.requestId,
          pieceId,
        },
        "music.piece.updated",
        { bulk: true, fields: Object.keys(operation.changes) },
        occurredAt,
        `${operation.requestId}:${pieceId}`,
      );
    }
  });
  const updated = requests
    .map(({ pieceId }) => readPiece(storage, pieceId))
    .filter((piece): piece is OrganizationMusicPiece => piece !== null);
  return Response.json({ pieces: addPerformanceHistory(storage, updated) });
}

export function bulkDeletePieces(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "bulk_delete" }>,
): Response {
  const pieces = operation.pieceIds.map((pieceId) => readPiece(storage, pieceId));
  if (pieces.some((piece) => piece === null)) {
    return Response.json({ code: "music_piece_not_found" }, { status: 404 });
  }
  const storedPieces = pieces.filter((piece): piece is OrganizationMusicPiece => piece !== null);
  for (const piece of storedPieces) {
    if (eventReferencesPiece(storage, piece.id)) {
      return Response.json({ code: "music_piece_in_set_list" }, { status: 409 });
    }
  }
  const childCounts = new Map<string, number>();
  const selectedJson = JSON.stringify(operation.pieceIds);
  for (const piece of storedPieces) {
    const remainingChildren = storage.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM music_pieces WHERE parent_id = ? AND id NOT IN (SELECT value FROM json_each(?))",
        piece.id,
        selectedJson,
      )
      .one().count;
    childCounts.set(piece.id, remainingChildren);
    if (remainingChildren > 0 && !operation.unlinkChildren) {
      return Response.json({ code: "music_piece_has_movements" }, { status: 409 });
    }
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    if (operation.unlinkChildren) {
      for (const piece of storedPieces) {
        const remaining = childCounts.get(piece.id) ?? 0;
        if (remaining > 0) {
          storage.sql.exec(
            "UPDATE music_pieces SET parent_id = NULL, updated_at = ? WHERE parent_id = ? AND id NOT IN (SELECT value FROM json_each(?))",
            occurredAt,
            piece.id,
            selectedJson,
          );
        }
      }
    }
    for (const piece of storedPieces) {
      storage.sql.exec("DELETE FROM music_pieces WHERE id = ?", piece.id);
      insertAudit(
        storage,
        {
          actorUserId: operation.actorUserId,
          requestId: operation.requestId,
          pieceId: piece.id,
        },
        "music.piece.deleted",
        { bulk: true, title: piece.title, unlinkedMovements: childCounts.get(piece.id) ?? 0 },
        occurredAt,
        `${operation.requestId}:${piece.id}`,
      );
    }
  });
  return Response.json({ deletedIds: operation.pieceIds });
}
