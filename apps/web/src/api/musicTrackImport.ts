import {
  musicTrackImportCommitResponseSchema,
  musicTrackImportCreateSessionResponseSchema,
  musicTrackImportDiscardResponseSchema,
  musicTrackImportSessionDetailResponseSchema,
  musicTrackImportSessionListResponseSchema,
  musicTrackImportUploadResponseSchema,
  type MusicTrackImportCommitRequest,
  type MusicTrackImportCreateSessionRequest,
  type MusicTrackImportUpdateAssignmentsRequest,
} from "@choir/contracts";

import { request, requestJson } from "./client";

const SESSIONS_PATH = "/api/organization/music/track-import/sessions";

export async function createMusicTrackImportSession(
  body: MusicTrackImportCreateSessionRequest,
): Promise<{
  readonly counts: {
    readonly attachFailed: number;
    readonly attached: number;
    readonly cleanupPending: number;
    readonly conflict: number;
    readonly planned: number;
    readonly reclaimed: number;
    readonly total: number;
    readonly uploadFailed: number;
    readonly uploaded: number;
    readonly uploading: number;
  };
  readonly expiresAt: string;
  readonly items: readonly { readonly clientFileId: string; readonly status: string }[];
  readonly manifestRevision: number;
  readonly requestId: string;
  readonly sessionId: string;
}> {
  const parsed = await requestJson(SESSIONS_PATH, musicTrackImportCreateSessionResponseSchema, {
    body: JSON.stringify(body),
    method: "POST",
  });
  return parsed;
}

export async function listActiveMusicTrackImportSessions(): Promise<{
  readonly requestId: string;
  readonly sessions: readonly {
    readonly absoluteExpiresAt: string;
    readonly clientBatchKey: string;
    readonly closedAt: string | null;
    readonly expiresAt: string;
    readonly lastFailureCode: string | null;
    readonly manifestRevision: number;
    readonly sessionId: string;
    readonly state: "active" | "partial";
  }[];
}> {
  const parsed = await requestJson(
    `${SESSIONS_PATH}?active=1`,
    musicTrackImportSessionListResponseSchema,
    { method: "GET" },
  );
  return {
    requestId: parsed.requestId,
    sessions: parsed.sessions.filter(
      (session): session is (typeof parsed.sessions)[number] & { state: "active" | "partial" } =>
        session.state === "active" || session.state === "partial",
    ),
  };
}

export async function getMusicTrackImportSession(sessionId: string) {
  const parsed = await requestJson(
    `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}`,
    musicTrackImportSessionDetailResponseSchema,
    { method: "GET" },
  );
  return parsed.session;
}

export async function uploadMusicTrackImportFile(
  sessionId: string,
  clientFileId: string,
  file: File,
): Promise<{
  readonly bytesReceived: number;
  readonly fileId: string;
  readonly requestId: string;
  readonly status: "uploaded" | "already_uploaded";
}> {
  const response = await request(
    `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(clientFileId)}`,
    {
      body: file,
      headers: {
        "content-type": "audio/mpeg",
        "x-file-name": encodeURIComponent(file.name),
      },
      method: "PUT",
    },
  );
  const parsed = musicTrackImportUploadResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("The practice track upload returned an unexpected response.");
  }
  return parsed.data;
}

export async function updateMusicTrackImportAssignments(
  sessionId: string,
  body: MusicTrackImportUpdateAssignmentsRequest,
) {
  const parsed = await requestJson(
    `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}/assignments`,
    musicTrackImportSessionDetailResponseSchema,
    {
      body: JSON.stringify(body),
      method: "PATCH",
    },
  );
  return parsed.session;
}

export async function commitMusicTrackImportSession(
  sessionId: string,
  body: MusicTrackImportCommitRequest,
) {
  const parsed = await requestJson(
    `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}/commit`,
    musicTrackImportCommitResponseSchema,
    {
      body: JSON.stringify(body),
      method: "POST",
    },
  );
  return parsed;
}

export async function discardMusicTrackImportSession(sessionId: string) {
  const response = await request(`${SESSIONS_PATH}/${encodeURIComponent(sessionId)}/discard`, {
    method: "POST",
  });
  const parsed = musicTrackImportDiscardResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("The practice track import discard returned an unexpected response.");
  }
  return parsed.data;
}
