import type { OrganizationMusicPieceRequest } from "@choir/contracts";
import type { z } from "zod";

import { MUSIC_IMPORT_BATCH_SIZE } from "./types.js";
import type { musicOperationSchema } from "./types.js";
import { validatePiece } from "./validation.js";

interface ImportError {
  readonly reason: string;
  readonly row: number;
}

function normalizeGenreLabel(value: string): string {
  return value.trim();
}

function canonicalGenresForPiece(
  rawGenres: readonly string[],
  registryLowerToCanonical: ReadonlyMap<string, string>,
  pendingLowerToCanonical: ReadonlyMap<string, string>,
): readonly string[] {
  const seenLower = new Set<string>();
  const normalized: string[] = [];
  for (const raw of rawGenres) {
    const trimmed = normalizeGenreLabel(raw);
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    const canonical =
      registryLowerToCanonical.get(lower) ?? pendingLowerToCanonical.get(lower) ?? trimmed;
    normalized.push(canonical);
  }
  return normalized;
}

export function importPieces(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "import" }>,
): Response {
  const existingGenres = (() => {
    try {
      const row = storage.sql
        .exec<{ readonly genresJson: string }>(
          "SELECT music_genres_json AS genresJson FROM organization_metadata LIMIT 1",
        )
        .one();
      const parsed: unknown = JSON.parse(row.genresJson);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  })();

  const registryLowerToCanonical = new Map<string, string>();
  for (const label of existingGenres) {
    const lower = label.trim().toLowerCase();
    if (!registryLowerToCanonical.has(lower)) registryLowerToCanonical.set(lower, label);
  }

  const pendingLowerToCanonical = new Map<string, string>();
  const goodPieces: {
    readonly piece: OrganizationMusicPieceRequest;
    readonly pieceId: string;
    readonly row: number;
  }[] = [];
  const errors: ImportError[] = [];

  for (const imported of operation.pieces) {
    const rawGenres = imported.piece.genres as readonly string[];
    const normalizedGenres = canonicalGenresForPiece(
      rawGenres,
      registryLowerToCanonical,
      pendingLowerToCanonical,
    );

    if (normalizedGenres.length > 100) {
      errors.push({ reason: "A piece may have at most 100 genres.", row: imported.row });
      continue;
    }
    const longLabel = normalizedGenres.find((label) => label.length > 100);
    if (longLabel) {
      errors.push({ reason: "Genre label must be 100 characters or less.", row: imported.row });
      continue;
    }

    const newForPiece: string[] = [];
    for (const label of normalizedGenres) {
      const lower = label.toLowerCase();
      if (!registryLowerToCanonical.has(lower) && !pendingLowerToCanonical.has(lower)) {
        newForPiece.push(label);
      }
    }

    if (registryLowerToCanonical.size + pendingLowerToCanonical.size + newForPiece.length > 100) {
      errors.push({ reason: "The genre registry is full (100 genres).", row: imported.row });
      continue;
    }

    const normalizedPiece = { ...imported.piece, genres: [...normalizedGenres] };
    const validation = validatePiece(storage, imported.pieceId, normalizedPiece);
    if (validation) {
      errors.push({ reason: "The music piece is invalid.", row: imported.row });
      continue;
    }

    for (const label of newForPiece) {
      pendingLowerToCanonical.set(label.toLowerCase(), label);
    }

    goodPieces.push({ piece: normalizedPiece, pieceId: imported.pieceId, row: imported.row });
  }

  const occurredAt = new Date().toISOString();
  const newGenres = [...pendingLowerToCanonical.values()];
  const finalGenres = [...existingGenres, ...newGenres];

  storage.transactionSync(() => {
    for (let offset = 0; offset < goodPieces.length; offset += MUSIC_IMPORT_BATCH_SIZE) {
      const importedBatch = goodPieces.slice(offset, offset + MUSIC_IMPORT_BATCH_SIZE);
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
    if (newGenres.length > 0) {
      storage.sql.exec(
        "UPDATE organization_metadata SET music_genres_json = ?, updated_at = ?",
        JSON.stringify(finalGenres),
        occurredAt,
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
      JSON.stringify({ imported: goodPieces.length, newGenres, skipped: errors.length }),
      occurredAt,
    );
  });

  return Response.json({
    errors,
    imported: goodPieces.length,
    skipped: errors.length,
  });
}
