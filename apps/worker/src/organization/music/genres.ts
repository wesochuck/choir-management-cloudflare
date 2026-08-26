import type { OrganizationMusicPiece } from "@choir/contracts";
import type { z } from "zod";

import { addPerformanceHistory, musicColumns, type MusicPieceRow } from "./types.js";
import type { musicOperationSchema } from "./types.js";
import { parseStoredPiece, readPiece } from "./crud.js";
import { storedMusicLibrarySettings } from "./settings.js";

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

export function rewriteGenreLabels(
  storage: DurableObjectStorage,
  operation:
    | Extract<z.infer<typeof musicOperationSchema>, { readonly action: "rename_genre" }>
    | Extract<z.infer<typeof musicOperationSchema>, { readonly action: "delete_genre" }>,
): Response {
  const currentLabel =
    operation.action === "rename_genre" ? operation.genre.currentLabel : operation.genre.label;
  const settings = storedMusicLibrarySettings(storage);
  const inRegistry = settings.genres.includes(currentLabel);
  const affected = storage.sql
    .exec<MusicPieceRow>(`SELECT ${musicColumns} FROM music_pieces ORDER BY created_at ASC, id ASC`)
    .toArray()
    .map(parseStoredPiece)
    .filter((piece: OrganizationMusicPiece) => piece.genres.includes(currentLabel));
  if (!inRegistry && affected.length === 0) {
    return Response.json({ code: "music_genre_not_found" }, { status: 404 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    const nextGenres =
      operation.action === "rename_genre"
        ? [
            ...new Set(
              settings.genres.map((label: string) =>
                label === currentLabel ? operation.genre.newLabel : label,
              ),
            ),
          ]
        : settings.genres.filter((label: string) => label !== currentLabel);
    storage.sql.exec(
      "UPDATE organization_metadata SET music_genres_json = ?, updated_at = ?",
      JSON.stringify(nextGenres),
      occurredAt,
    );
    for (const piece of affected) {
      const pieceGenres =
        operation.action === "rename_genre"
          ? [
              ...new Set(
                piece.genres.map((label: string) =>
                  label === currentLabel ? operation.genre.newLabel : label,
                ),
              ),
            ]
          : piece.genres.filter((label: string) => label !== currentLabel);
      storage.sql.exec(
        "UPDATE music_pieces SET genres_json = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(pieceGenres),
        occurredAt,
        piece.id,
      );
      insertAudit(
        storage,
        { actorUserId: operation.actorUserId, pieceId: piece.id, requestId: operation.requestId },
        operation.action === "rename_genre" ? "music.genre.renamed" : "music.genre.deleted",
        operation.action === "rename_genre"
          ? { currentLabel, newLabel: operation.genre.newLabel }
          : { currentLabel },
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
  return Response.json({
    pieces: addPerformanceHistory(storage, updated),
    settings: storedMusicLibrarySettings(storage),
  });
}
