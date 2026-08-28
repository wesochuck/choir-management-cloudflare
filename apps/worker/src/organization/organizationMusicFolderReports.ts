import {
  musicFolderNumberBatchResponseSchema,
  musicFolderReportProfileDetailResponseSchema,
  musicFolderReportQueryResponseSchema,
  musicFolderReturnStatusResponseSchema,
  type MusicFolderNumberEdit,
  type MusicFolderReportProfileDetailResponse,
  type MusicFolderReportQueryResponse,
  type MusicFolderReturnStatusResponse,
} from "@choir/contracts";

import type { Env } from "../env";
import { mutateOrganizationStore, storeErrorCode } from "./rpc/repository";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export class MusicFolderReportError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super("The Organization store rejected the Music Folder Report request.");
    this.name = "MusicFolderReportError";
  }
}

async function post(
  env: Env,
  organizationId: string,
  path: string,
  input: Readonly<Record<string, unknown>>,
): Promise<Response> {
  const response = await mutateOrganizationStore(env, organizationId, path, input);
  if (!response.ok) {
    throw new MusicFolderReportError(await storeErrorCode(response, "unknown"), response.status);
  }
  return response;
}

export async function queryMusicFolderReport(
  env: Env,
  actor: ActorContext,
  eventIds: readonly string[],
): Promise<MusicFolderReportQueryResponse> {
  const response = await post(env, actor.organizationId, "/internal/reports/music-folders/query", {
    ...actor,
    eventIds,
  });
  return musicFolderReportQueryResponseSchema.parse(await response.json());
}

export async function readMusicFolderProfileDetail(
  env: Env,
  actor: ActorContext,
  profileId: string,
  eventIds: readonly string[],
): Promise<MusicFolderReportProfileDetailResponse> {
  const response = await post(
    env,
    actor.organizationId,
    "/internal/reports/music-folders/profile-detail",
    { ...actor, eventIds, profileId },
  );
  return musicFolderReportProfileDetailResponseSchema.parse(await response.json());
}

export async function updateMusicFolderNumbers(
  env: Env,
  actor: ActorContext,
  updates: readonly MusicFolderNumberEdit[],
) {
  const response = await post(
    env,
    actor.organizationId,
    "/internal/reports/music-folders/folder-numbers",
    { ...actor, updates },
  );
  return musicFolderNumberBatchResponseSchema.parse(await response.json());
}

export async function updateMusicFolderReturnStatus(
  env: Env,
  actor: ActorContext,
  profileId: string,
  eventId: string,
  folderReturned: boolean,
  expectedUpdatedAt: string | null,
): Promise<MusicFolderReturnStatusResponse> {
  const response = await post(
    env,
    actor.organizationId,
    "/internal/reports/music-folders/return-status",
    {
      ...actor,
      eventId,
      folder: { expectedUpdatedAt, folderReturned },
      profileId,
    },
  );
  return musicFolderReturnStatusResponseSchema.parse(await response.json());
}

export async function exportMusicFolderReport(
  env: Env,
  actor: ActorContext,
  eventIds: readonly string[],
): Promise<string> {
  const response = await post(env, actor.organizationId, "/internal/reports/music-folders/export", {
    ...actor,
    eventIds,
  });
  return response.text();
}
