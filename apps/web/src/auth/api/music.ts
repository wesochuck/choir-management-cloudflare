import {
  organizationMusicBulkDeleteResponseSchema,
  organizationMusicGenreMutationResponseSchema,
  organizationMusicPiecesResponseSchema,
  organizationMusicLibrarySettingsResponseSchema,
  organizationMusicPieceDeleteResponseSchema,
  organizationMusicImportResponseSchema,
  organizationMusicPieceResponseSchema,
  singerLearningTrackPiecesResponseSchema,
  type OrganizationMusicPiece,
  type OrganizationMusicLibrarySettings,
  type OrganizationMusicBulkDeleteRequest,
  type OrganizationMusicBulkUpdateRequest,
  type OrganizationMusicCreditRenameRequest,
  type OrganizationMusicGenreDeleteRequest,
  type OrganizationMusicGenreRenameRequest,
  type OrganizationMusicPieceRequest,
  type SingerLearningTrackPiece,
} from "@choir/contracts";

import { request } from "./client";

export async function listOrganizationMusic(
  signal?: AbortSignal,
): Promise<readonly OrganizationMusicPiece[]> {
  const response = await request("/api/organization/music", { signal: signal ?? null });
  return organizationMusicPiecesResponseSchema.parse(await response.json()).pieces;
}

export async function getOrganizationMusicLibrarySettings(
  signal?: AbortSignal,
): Promise<OrganizationMusicLibrarySettings> {
  const response = await request("/api/organization/music-library-settings", {
    signal: signal ?? null,
  });
  return organizationMusicLibrarySettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationMusicLibrarySettings(
  settings: OrganizationMusicLibrarySettings,
): Promise<OrganizationMusicLibrarySettings> {
  const response = await request("/api/organization/music-library-settings", {
    body: JSON.stringify(settings),
    method: "PUT",
  });
  return organizationMusicLibrarySettingsResponseSchema.parse(await response.json());
}

export async function listSingerLearningTracks(
  signal?: AbortSignal,
): Promise<readonly SingerLearningTrackPiece[]> {
  const response = await request("/api/singer/music", { signal: signal ?? null });
  return singerLearningTrackPiecesResponseSchema.parse(await response.json()).pieces;
}

export async function createOrganizationMusicPiece(
  piece: OrganizationMusicPieceRequest,
): Promise<OrganizationMusicPiece> {
  const response = await request("/api/organization/music", {
    body: JSON.stringify(piece),
    method: "POST",
  });
  return organizationMusicPieceResponseSchema.parse(await response.json());
}

export async function updateOrganizationMusicPiece(
  pieceId: string,
  piece: OrganizationMusicPieceRequest,
): Promise<OrganizationMusicPiece> {
  const response = await request(`/api/organization/music/${encodeURIComponent(pieceId)}`, {
    body: JSON.stringify(piece),
    method: "PUT",
  });
  return organizationMusicPieceResponseSchema.parse(await response.json());
}

export async function bulkUpdateOrganizationMusicPieces(
  changesRequest: OrganizationMusicBulkUpdateRequest,
): Promise<readonly OrganizationMusicPiece[]> {
  const response = await request("/api/organization/music/bulk-update", {
    body: JSON.stringify(changesRequest),
    method: "POST",
  });
  return organizationMusicPiecesResponseSchema.parse(await response.json()).pieces;
}

export async function bulkDeleteOrganizationMusicPieces(
  deleteRequest: OrganizationMusicBulkDeleteRequest,
): Promise<readonly string[]> {
  const response = await request("/api/organization/music/bulk-delete", {
    body: JSON.stringify(deleteRequest),
    method: "POST",
  });
  return organizationMusicBulkDeleteResponseSchema.parse(await response.json()).deletedIds;
}

export async function renameOrganizationMusicCredit(
  renameRequest: OrganizationMusicCreditRenameRequest,
): Promise<readonly OrganizationMusicPiece[]> {
  const response = await request("/api/organization/music/credits/rename", {
    body: JSON.stringify(renameRequest),
    method: "POST",
  });
  return organizationMusicPiecesResponseSchema.parse(await response.json()).pieces;
}

export async function renameOrganizationMusicGenre(
  renameRequest: OrganizationMusicGenreRenameRequest,
): Promise<{
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly settings: OrganizationMusicLibrarySettings;
}> {
  const response = await request("/api/organization/music/genres/rename", {
    body: JSON.stringify(renameRequest),
    method: "POST",
  });
  return parseGenreMutationResponse(await response.json());
}

export async function deleteOrganizationMusicGenre(
  deleteRequest: OrganizationMusicGenreDeleteRequest,
): Promise<{
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly settings: OrganizationMusicLibrarySettings;
}> {
  const response = await request("/api/organization/music/genres/delete", {
    body: JSON.stringify(deleteRequest),
    method: "POST",
  });
  return parseGenreMutationResponse(await response.json());
}

function parseGenreMutationResponse(body: unknown): {
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly settings: OrganizationMusicLibrarySettings;
} {
  const parsed = organizationMusicGenreMutationResponseSchema.parse(body);
  return { pieces: parsed.pieces, settings: parsed.settings };
}

export async function deleteOrganizationMusicPiece(
  pieceId: string,
  unlinkChildren: boolean,
): Promise<void> {
  const query = unlinkChildren ? "?unlinkChildren=true" : "";
  const response = await request(`/api/organization/music/${encodeURIComponent(pieceId)}${query}`, {
    method: "DELETE",
  });
  organizationMusicPieceDeleteResponseSchema.parse(await response.json());
}

export async function importOrganizationMusicCsv(csv: string): Promise<number> {
  const response = await request("/api/organization/music/import", {
    body: csv,
    headers: { "content-type": "text/csv; charset=utf-8" },
    method: "POST",
  });
  return organizationMusicImportResponseSchema.parse(await response.json()).imported;
}
