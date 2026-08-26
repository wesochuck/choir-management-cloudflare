import type { OrganizationMusicPiece } from "@choir/contracts";
import type { z } from "zod";

import { addPerformanceHistory, musicColumns, type MusicPieceRow } from "./types.js";
import type { musicOperationSchema } from "./types.js";
import { parseStoredPiece, readPiece } from "./crud.js";

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

export function renameMusicCredit(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "rename_credit" }>,
): Response {
  const affected = storage.sql
    .exec<MusicPieceRow>(
      `SELECT ${musicColumns} FROM music_pieces
       WHERE composer = ? OR arranger = ?
       ORDER BY created_at ASC, id ASC`,
      operation.credit.currentName,
      operation.credit.currentName,
    )
    .toArray()
    .map(parseStoredPiece);
  if (affected.length === 0) {
    return Response.json({ code: "music_credit_not_found" }, { status: 404 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    for (const piece of affected) {
      const roles = [
        ...(piece.composer === operation.credit.currentName ? (["composer"] as const) : []),
        ...(piece.arranger === operation.credit.currentName ? (["arranger"] as const) : []),
      ];
      storage.sql.exec(
        `UPDATE music_pieces
         SET composer = CASE WHEN composer = ? THEN ? ELSE composer END,
             arranger = CASE WHEN arranger = ? THEN ? ELSE arranger END,
             updated_at = ?
         WHERE id = ?`,
        operation.credit.currentName,
        operation.credit.newName,
        operation.credit.currentName,
        operation.credit.newName,
        occurredAt,
        piece.id,
      );
      insertAudit(
        storage,
        { actorUserId: operation.actorUserId, pieceId: piece.id, requestId: operation.requestId },
        "music.credit.renamed",
        {
          currentName: operation.credit.currentName,
          newName: operation.credit.newName,
          roles,
        },
        occurredAt,
        `${operation.requestId}:${piece.id}`,
      );
    }
  });
  const updated = affected
    .map(({ id }: OrganizationMusicPiece) => readPiece(storage, id))
    .filter(
      (piece: OrganizationMusicPiece | null): piece is OrganizationMusicPiece => piece !== null,
    );
  return Response.json({ pieces: addPerformanceHistory(storage, updated) });
}
