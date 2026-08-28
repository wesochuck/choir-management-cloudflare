import {
  addPerformanceHistory,
  identityMatches,
  musicColumns,
  type MusicPieceRow,
} from "./types.js";
import { musicOperationSchema } from "./types.js";
import { parseStoredPiece } from "./crud.js";
import { bulkDeletePieces, bulkUpdatePieces } from "./bulk.js";
import { renameMusicCredit } from "./credits.js";
import { rewriteGenreLabels } from "./genres.js";
import { importPieces } from "./import.js";
import { updateMusicLibrarySettings } from "./settings.js";
import { deletePiece, writePiece } from "./crud.js";

export { MUSIC_IMPORT_BATCH_SIZE, musicColumns, musicOperationSchema } from "./types.js";
export type {
  MusicOperation,
  MusicPieceRow,
  OrganizationIdentityRow,
  PerformanceHistoryRow,
} from "./types.js";
export {
  configuredSections,
  validateParent,
  validatePiece,
  validateSectionBuckets,
  validateTrackFiles,
} from "./validation.js";
export {
  deletePiece,
  eventReferencesPiece,
  parseStoredPiece,
  readPiece,
  writePiece,
} from "./crud.js";
export { bulkDeletePieces, bulkUpdatePieces } from "./bulk.js";
export { renameMusicCredit } from "./credits.js";
export { rewriteGenreLabels } from "./genres.js";
export { importPieces } from "./import.js";
export {
  readMusicLibrarySettingsFromStore,
  storedMusicLibrarySettings,
  updateMusicLibrarySettings,
} from "./settings.js";

export function listMusicPiecesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  try {
    const pieces = storage.sql
      .exec<MusicPieceRow>(
        `SELECT ${musicColumns} FROM music_pieces
                  ORDER BY title COLLATE NOCASE ASC, created_at ASC, id ASC LIMIT 5000`,
      )
      .toArray()
      .map(parseStoredPiece);
    return Response.json({ pieces: addPerformanceHistory(storage, pieces) });
  } catch {
    return Response.json({ code: "music_catalog_corrupt" }, { status: 500 });
  }
}

export async function manageMusicInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const operation = musicOperationSchema.safeParse(await request.json());
  if (!operation.success) {
    return Response.json({ code: "invalid_music_operation" }, { status: 400 });
  }
  if (!identityMatches(storage, operation.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  if (operation.data.action === "delete") return deletePiece(storage, operation.data);
  if (operation.data.action === "bulk_delete") return bulkDeletePieces(storage, operation.data);
  if (operation.data.action === "import") return importPieces(storage, operation.data);
  if (operation.data.action === "bulk_update") return bulkUpdatePieces(storage, operation.data);
  if (operation.data.action === "rename_credit") return renameMusicCredit(storage, operation.data);
  if (operation.data.action === "rename_genre" || operation.data.action === "delete_genre") {
    return rewriteGenreLabels(storage, operation.data);
  }
  if (operation.data.action === "update_settings") {
    return updateMusicLibrarySettings(storage, operation.data);
  }
  return writePiece(storage, operation.data);
}
