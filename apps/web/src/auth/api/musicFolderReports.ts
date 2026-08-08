import {
  musicFolderNumberBatchResponseSchema,
  musicFolderReportProfileDetailResponseSchema,
  musicFolderReportQueryResponseSchema,
  musicFolderReturnStatusResponseSchema,
  type MusicFolderNumberEdit,
  type MusicFolderNumberBatchResponse,
  type MusicFolderReportProfileDetailResponse,
  type MusicFolderReportQueryResponse,
  type MusicFolderReturnStatusResponse,
} from "@choir/contracts";

import { request } from "./client";

export async function queryMusicFolderReport(
  eventIds: readonly string[],
  signal?: AbortSignal,
): Promise<MusicFolderReportQueryResponse> {
  const response = await request("/api/organization/reports/music-folders/query", {
    body: JSON.stringify({ eventIds }),
    method: "POST",
    signal: signal ?? null,
  });
  return musicFolderReportQueryResponseSchema.parse(await response.json());
}

export async function getMusicFolderProfileDetail(
  profileId: string,
  eventIds: readonly string[],
  signal?: AbortSignal,
): Promise<MusicFolderReportProfileDetailResponse> {
  const response = await request(
    `/api/organization/reports/music-folders/profiles/${encodeURIComponent(profileId)}`,
    {
      body: JSON.stringify({ eventIds }),
      method: "POST",
      signal: signal ?? null,
    },
  );
  return musicFolderReportProfileDetailResponseSchema.parse(await response.json());
}

export async function updateMusicFolderNumbers(
  updates: readonly MusicFolderNumberEdit[],
): Promise<MusicFolderNumberBatchResponse> {
  const response = await request("/api/organization/reports/music-folders/folder-numbers", {
    body: JSON.stringify({ updates }),
    method: "PUT",
  });
  return musicFolderNumberBatchResponseSchema.parse(await response.json());
}

export async function updateMusicFolderReturnStatus(
  profileId: string,
  eventId: string,
  folderReturned: boolean,
  expectedUpdatedAt: string | null,
): Promise<MusicFolderReturnStatusResponse> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/folder-numbers/${encodeURIComponent(eventId)}/return-status`,
    {
      body: JSON.stringify({ expectedUpdatedAt, folderReturned }),
      method: "PUT",
    },
  );
  return musicFolderReturnStatusResponseSchema.parse(await response.json());
}

export async function exportMusicFolderReport(eventIds: readonly string[]): Promise<Blob> {
  const response = await request("/api/organization/reports/music-folders/export.csv", {
    body: JSON.stringify({ eventIds }),
    method: "POST",
  });
  return response.blob();
}
