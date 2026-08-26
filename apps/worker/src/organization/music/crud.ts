import {
  organizationMusicPieceRequestSchema,
  organizationMusicPieceSchema,
} from "@choir/contracts";
import type { OrganizationMusicPiece, OrganizationMusicPieceRequest } from "@choir/contracts";
import type { z } from "zod";

import { isUnknownRecord, musicColumns, type MusicPieceRow } from "./types.js";
import type { musicOperationSchema } from "./types.js";
import { validatePiece } from "./validation.js";

export function parseStoredPiece(row: MusicPieceRow): OrganizationMusicPiece {
  const genres = JSON.parse(row.genresJson) as unknown;
  const sectionBuckets = JSON.parse(row.sectionBucketsJson) as unknown;
  const trackFileIds = JSON.parse(row.trackFileIdsJson) as unknown;
  return organizationMusicPieceSchema.parse({
    ...row,
    genres,
    sectionBuckets,
    trackFileIds,
  });
}

export function readPiece(
  storage: DurableObjectStorage,
  pieceId: string,
): OrganizationMusicPiece | null {
  const row = storage.sql
    .exec<MusicPieceRow>(`SELECT ${musicColumns} FROM music_pieces WHERE id = ? LIMIT 1`, pieceId)
    .toArray()
    .at(0);
  return row ? parseStoredPiece(row) : null;
}

export function eventReferencesPiece(storage: DurableObjectStorage, pieceId: string): boolean {
  const rows = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly setListJson: string }>(
      "SELECT set_list_json AS setListJson FROM events",
    )
    .toArray();
  return rows.some(({ setListJson }: { readonly setListJson: string }) => {
    try {
      const value = JSON.parse(setListJson) as unknown;
      return (
        Array.isArray(value) &&
        value.some((item: unknown) => {
          return isUnknownRecord(item) && item.pieceId === pieceId;
        })
      );
    } catch {
      return false;
    }
  });
}

function requestFromPiece(piece: OrganizationMusicPiece): OrganizationMusicPieceRequest {
  return organizationMusicPieceRequestSchema.parse(piece);
}

function insertAudit(
  storage: DurableObjectStorage,
  operation: {
    readonly actorUserId: string;
    readonly pieceId: string;
    readonly requestId: string;
  },
  action: string,
  summary: Record<string, unknown>,
  occurredAt: string,
  auditKey = operation.requestId,
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

export function writePiece(
  storage: DurableObjectStorage,
  operation: Extract<
    z.infer<typeof musicOperationSchema>,
    { readonly action: "create" | "update" }
  >,
): Response {
  if (operation.action === "update" && !readPiece(storage, operation.pieceId)) {
    return Response.json({ code: "music_piece_not_found" }, { status: 404 });
  }
  const validation = validatePiece(storage, operation.pieceId, operation.piece);
  if (validation) return validation;
  const occurredAt = new Date().toISOString();
  const piece = operation.piece;
  storage.transactionSync(() => {
    if (operation.action === "create") {
      storage.sql.exec(
        `INSERT INTO music_pieces
          (id, title, composer, arranger, purchase_date, copies, catalog_id, duration_seconds,
           notes, section_buckets_json, genres_json, parent_id, track_file_ids_json,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        operation.pieceId,
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
        occurredAt,
      );
    } else {
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
        operation.pieceId,
      );
    }
    insertAudit(
      storage,
      operation,
      operation.action === "create" ? "music.piece.created" : "music.piece.updated",
      {
        parentId: piece.parentId,
        title: piece.title,
        trackCount: Object.keys(piece.trackFileIds).length,
      },
      occurredAt,
    );
  });
  return Response.json(readPiece(storage, operation.pieceId), {
    status: operation.action === "create" ? 201 : 200,
  });
}

export function deletePiece(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "delete" }>,
): Response {
  const piece = readPiece(storage, operation.pieceId);
  if (!piece) return Response.json({ code: "music_piece_not_found" }, { status: 404 });
  if (eventReferencesPiece(storage, operation.pieceId)) {
    return Response.json({ code: "music_piece_in_set_list" }, { status: 409 });
  }
  const childCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM music_pieces WHERE parent_id = ?",
      operation.pieceId,
    )
    .one().count;
  if (childCount > 0 && !operation.unlinkChildren) {
    return Response.json({ code: "music_piece_has_movements" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    if (childCount > 0) {
      storage.sql.exec(
        "UPDATE music_pieces SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
        occurredAt,
        operation.pieceId,
      );
    }
    storage.sql.exec("DELETE FROM music_pieces WHERE id = ?", operation.pieceId);
    insertAudit(
      storage,
      operation,
      "music.piece.deleted",
      { title: piece.title, unlinkedMovements: childCount },
      occurredAt,
    );
  });
  return Response.json({ pieceId: operation.pieceId, status: "deleted" });
}

// Re-export for bulk's composition; keep internal helper accessible.
export { requestFromPiece };
