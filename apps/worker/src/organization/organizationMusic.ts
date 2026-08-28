import {
  organizationMusicBulkDeleteResponseSchema,
  organizationMusicGenreMutationResponseSchema,
  organizationMusicImportResponseSchema,
  organizationMusicLibrarySettingsRequestSchema,
  organizationMusicPieceSchema,
  organizationMusicPiecesResponseSchema,
  type OrganizationMusicBulkDeleteRequest,
  type OrganizationMusicBulkUpdateRequest,
  type OrganizationMusicCreditRenameRequest,
  type OrganizationMusicGenreDeleteRequest,
  type OrganizationMusicGenreRenameRequest,
  type OrganizationMusicLibrarySettings,
  type OrganizationMusicPiece,
  type OrganizationMusicPieceRequest,
} from "@choir/contracts";

import type { Env } from "../env";
import {
  mutateOrganizationStore,
  readOrganizationStore,
  storeErrorCode,
  storeErrorStatus,
} from "./rpc/repository";

export class MusicRepositoryError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409 | 500 | 503;

  constructor(code: string, status: MusicRepositoryError["status"]) {
    super(code);
    this.name = "MusicRepositoryError";
    this.code = code;
    this.status = status;
  }
}

async function repositoryError(response: Response): Promise<MusicRepositoryError> {
  return new MusicRepositoryError(
    await storeErrorCode(response, "music_repository_error"),
    storeErrorStatus(response),
  );
}

async function mutate(
  env: Env,
  organizationId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await mutateOrganizationStore(
    env,
    organizationId,
    "/internal/music/manage",
    body,
  );
  if (!response.ok) throw await repositoryError(response);
  return response;
}

export async function listOrganizationMusicPieces(
  env: Env,
  organizationId: string,
): Promise<readonly OrganizationMusicPiece[]> {
  const response = await readOrganizationStore(env, organizationId, "/internal/music/pieces");
  if (!response.ok) throw await repositoryError(response);
  return organizationMusicPiecesResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).pieces;
}

export async function readOrganizationMusicLibrarySettings(
  env: Env,
  organizationId: string,
): Promise<OrganizationMusicLibrarySettings> {
  const response = await readOrganizationStore(env, organizationId, "/internal/music/settings");
  if (!response.ok) throw await repositoryError(response);
  return organizationMusicLibrarySettingsRequestSchema.parse(await response.json());
}

export async function updateOrganizationMusicLibrarySettings(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  settings: OrganizationMusicLibrarySettings,
): Promise<OrganizationMusicLibrarySettings> {
  const response = await mutate(env, context.organizationId, {
    action: "update_settings",
    ...context,
    settings,
  });
  return organizationMusicLibrarySettingsRequestSchema.parse(await response.json());
}

export async function createOrganizationMusicPiece(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  piece: OrganizationMusicPieceRequest,
): Promise<OrganizationMusicPiece> {
  const pieceId = crypto.randomUUID();
  const response = await mutate(env, context.organizationId, {
    action: "create",
    ...context,
    piece,
    pieceId,
  });
  const created = organizationMusicPieceSchema.parse(await response.json());
  if (created.id !== pieceId)
    throw new Error("The Organization store returned a mismatched piece.");
  return created;
}

export async function updateOrganizationMusicPiece(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  pieceId: string,
  piece: OrganizationMusicPieceRequest,
): Promise<OrganizationMusicPiece> {
  const response = await mutate(env, context.organizationId, {
    action: "update",
    ...context,
    piece,
    pieceId,
  });
  const updated = organizationMusicPieceSchema.parse(await response.json());
  if (updated.id !== pieceId)
    throw new Error("The Organization store returned a mismatched piece.");
  return updated;
}

export async function bulkUpdateOrganizationMusicPieces(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  request: OrganizationMusicBulkUpdateRequest,
): Promise<readonly OrganizationMusicPiece[]> {
  const response = await mutate(env, context.organizationId, {
    action: "bulk_update",
    ...context,
    changes: request.changes,
    pieceIds: request.pieceIds,
  });
  return organizationMusicPiecesResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).pieces;
}

export async function bulkDeleteOrganizationMusicPieces(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  request: OrganizationMusicBulkDeleteRequest,
): Promise<readonly string[]> {
  const response = await mutate(env, context.organizationId, {
    action: "bulk_delete",
    ...context,
    pieceIds: request.pieceIds,
    unlinkChildren: request.unlinkChildren,
  });
  return organizationMusicBulkDeleteResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).deletedIds;
}

export async function renameOrganizationMusicCredit(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  credit: OrganizationMusicCreditRenameRequest,
): Promise<readonly OrganizationMusicPiece[]> {
  const response = await mutate(env, context.organizationId, {
    action: "rename_credit",
    ...context,
    credit,
  });
  return organizationMusicPiecesResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).pieces;
}

export async function renameOrganizationMusicGenre(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  genre: OrganizationMusicGenreRenameRequest,
): Promise<{
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly settings: OrganizationMusicLibrarySettings;
}> {
  const response = await mutate(env, context.organizationId, {
    action: "rename_genre",
    ...context,
    genre,
  });
  return parseGenreMutationResponse(response);
}

export async function deleteOrganizationMusicGenre(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  genre: OrganizationMusicGenreDeleteRequest,
): Promise<{
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly settings: OrganizationMusicLibrarySettings;
}> {
  const response = await mutate(env, context.organizationId, {
    action: "delete_genre",
    ...context,
    genre,
  });
  return parseGenreMutationResponse(response);
}

async function parseGenreMutationResponse(response: Response): Promise<{
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly settings: OrganizationMusicLibrarySettings;
}> {
  const parsed = organizationMusicGenreMutationResponseSchema
    .omit({ requestId: true })
    .parse(await response.json());
  return {
    pieces: parsed.pieces,
    settings: organizationMusicLibrarySettingsRequestSchema.parse(parsed.settings),
  };
}

export async function deleteOrganizationMusicPiece(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  pieceId: string,
  unlinkChildren: boolean,
): Promise<void> {
  await mutate(env, context.organizationId, {
    action: "delete",
    ...context,
    pieceId,
    unlinkChildren,
  });
}

export async function importOrganizationMusicPieces(
  env: Env,
  context: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  pieces: readonly { readonly piece: OrganizationMusicPieceRequest; readonly row: number }[],
): Promise<{
  readonly errors: readonly { readonly reason: string; readonly row: number }[];
  readonly imported: number;
  readonly skipped: number;
}> {
  const response = await mutate(env, context.organizationId, {
    action: "import",
    ...context,
    pieces: pieces.map(({ piece, row }) => ({ piece, pieceId: crypto.randomUUID(), row })),
  });
  return organizationMusicImportResponseSchema
    .omit({ requestId: true })
    .parse(await response.json());
}
