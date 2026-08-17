import {
  organizationMusicLibrarySettingsRequestSchema,
  organizationMusicPieceSchema,
  organizationMusicPiecesResponseSchema,
  type OrganizationMusicLibrarySettings,
  type OrganizationMusicPiece,
  type OrganizationMusicBulkUpdateRequest,
  type OrganizationMusicPieceRequest,
} from "@choir/contracts";

import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "./rpc/client";

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

function organizationStub(
  env: Env,
  organizationId: string,
): ReturnType<typeof organizationStoreStub> {
  return organizationStoreStub(env, organizationId);
}

async function repositoryError(response: Response): Promise<MusicRepositoryError> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : "music_repository_error";
  const status =
    response.status === 400 ||
    response.status === 404 ||
    response.status === 409 ||
    response.status === 500
      ? response.status
      : 503;
  return new MusicRepositoryError(code, status);
}

async function mutate(
  env: Env,
  organizationId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await invokeOrganizationRpc(
    organizationStub(env, organizationId),
    "https://organization.internal/internal/music/manage",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw await repositoryError(response);
  return response;
}

export async function listOrganizationMusicPieces(
  env: Env,
  organizationId: string,
): Promise<readonly OrganizationMusicPiece[]> {
  const url = new URL("https://organization.internal/internal/music/pieces");
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(organizationStub(env, organizationId), url);
  if (!response.ok) throw await repositoryError(response);
  return organizationMusicPiecesResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).pieces;
}

export async function readOrganizationMusicLibrarySettings(
  env: Env,
  organizationId: string,
): Promise<OrganizationMusicLibrarySettings> {
  const url = new URL("https://organization.internal/internal/music/settings");
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(organizationStub(env, organizationId), url);
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
  pieces: readonly OrganizationMusicPieceRequest[],
): Promise<number> {
  const response = await mutate(env, context.organizationId, {
    action: "import",
    ...context,
    pieces: pieces.map((piece) => ({ piece, pieceId: crypto.randomUUID() })),
  });
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("imported" in body) ||
    typeof body.imported !== "number"
  ) {
    throw new Error("The Organization store returned an invalid import result.");
  }
  return body.imported;
}
