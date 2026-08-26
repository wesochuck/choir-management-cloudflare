import type { z } from "zod";

import { MUSIC_IMPORT_BATCH_SIZE } from "./types.js";
import type { musicOperationSchema } from "./types.js";
import { validatePiece } from "./validation.js";

export function importPieces(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "import" }>,
): Response {
  for (const imported of operation.pieces) {
    const validation = validatePiece(storage, imported.pieceId, imported.piece);
    if (validation) return validation;
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    for (let offset = 0; offset < operation.pieces.length; offset += MUSIC_IMPORT_BATCH_SIZE) {
      const importedBatch = operation.pieces.slice(offset, offset + MUSIC_IMPORT_BATCH_SIZE);
      const values = importedBatch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const parameters = importedBatch.flatMap((imported) => {
        const piece = imported.piece;
        return [
          imported.pieceId,
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
        ];
      });
      storage.sql.exec(
        `INSERT INTO music_pieces
          (id, title, composer, arranger, purchase_date, copies, catalog_id, duration_seconds,
           notes, section_buckets_json, genres_json, parent_id, track_file_ids_json,
           created_at, updated_at)
         VALUES ${values.join(", ")}`,
        ...parameters,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'music.catalog.imported', 'music_catalog',
         'catalog', ?, ?, ?)`,
      `music:import:${operation.requestId}`,
      operation.actorUserId,
      operation.requestId,
      JSON.stringify({ imported: operation.pieces.length }),
      occurredAt,
    );
  });
  return Response.json({ imported: operation.pieces.length });
}
