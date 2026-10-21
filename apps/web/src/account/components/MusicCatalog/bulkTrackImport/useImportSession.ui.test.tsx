import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApiError } from "../../../../api/client";
import type { PlannedImportFile } from "./useImportSession";
import { useImportSession } from "./useImportSession";

const uploadCalls: { clientFileId: string }[] = [];
const commitKeys: string[] = [];
const failOnceFor = new Set<string>();

vi.mock("../../../../api/musicTrackImport", () => ({
  commitMusicTrackImportSession: vi.fn((_sessionId: string, body: { commitKey: string }) => {
    commitKeys.push(body.commitKey);
    return Promise.resolve({
      committedAt: "2026-10-21T00:00:00.000Z",
      commitKey: body.commitKey,
      manifestRevision: 1,
      requestId: "req-commit",
      results: [
        {
          clientFileId: "file-1",
          durationUpdated: true,
          fileId: "server-file-1",
          partKey: "soprano",
          pieceId: "11111111-1111-4111-8111-111111111111",
          status: "attached",
        },
        {
          clientFileId: "file-2",
          durationUpdated: true,
          fileId: "server-file-2",
          partKey: "alto",
          pieceId: "11111111-1111-4111-8111-111111111111",
          status: "attached",
        },
      ],
      sessionId: "session-1",
      summary: { attached: 2, conflict: 0, failed: 0, skipped: 0 },
    });
  }),
  createMusicTrackImportSession: vi.fn((body: { items: { clientFileId: string }[] }) =>
    Promise.resolve({
      counts: {
        attachFailed: 0,
        attached: 0,
        cleanupPending: 0,
        conflict: 0,
        planned: body.items.length,
        reclaimed: 0,
        total: body.items.length,
        uploadFailed: 0,
        uploaded: 0,
        uploading: 0,
      },
      expiresAt: "2026-10-22T00:00:00.000Z",
      items: body.items.map((item) => ({ clientFileId: item.clientFileId, status: "planned" })),
      manifestRevision: 1,
      requestId: "req-session",
      sessionId: "session-1",
    }),
  ),
  discardMusicTrackImportSession: vi.fn(() => Promise.resolve({})),
  getMusicTrackImportSession: vi.fn(() =>
    Promise.resolve({
      manifestRevision: 1,
      sessionId: "session-1",
    }),
  ),
  updateMusicTrackImportAssignments: vi.fn(() => Promise.resolve({})),
  uploadMusicTrackImportFile: vi.fn((_sessionId: string, clientFileId: string) => {
    uploadCalls.push({ clientFileId });
    if (failOnceFor.has(clientFileId)) {
      failOnceFor.delete(clientFileId);
      return Promise.reject(
        new AuthApiError(
          "The practice track could not be stored safely.",
          503,
          "service_unavailable",
        ),
      );
    }
    return Promise.resolve({
      bytesReceived: 18,
      fileId: `server-${clientFileId}`,
      requestId: "req-upload",
      status: "uploaded" as const,
    });
  }),
}));

import {
  commitMusicTrackImportSession,
  createMusicTrackImportSession,
  uploadMusicTrackImportFile,
} from "../../../../api/musicTrackImport";

function plannedFile(clientFileId: string, partKey: string): PlannedImportFile {
  return {
    clientFileId,
    durationSeconds: 180,
    file: new File(["dummy audio bytes"], `${clientFileId}.mp3`, { type: "audio/mpeg" }),
    fileName: `${clientFileId}.mp3`,
    partKey,
    pieceId: "11111111-1111-4111-8111-111111111111",
    pieceTitle: "Hallelujah Chorus",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadCalls.length = 0;
  commitKeys.length = 0;
  failOnceFor.clear();
  sessionStorage.clear();
});

describe("useImportSession", () => {
  it("settles per-file uploads and stops before commit when one file fails", async () => {
    failOnceFor.add("file-2");
    const { result } = renderHook(() => useImportSession());
    let receipt: unknown = "unset";
    await act(async () => {
      receipt = await result.current.startRun([
        plannedFile("file-1", "soprano"),
        plannedFile("file-2", "alto"),
      ]);
    });
    expect(receipt).toBeNull();
    const byId = new Map(result.current.files.map((file) => [file.clientFileId, file]));
    expect(byId.get("file-1")?.status).toBe("uploaded");
    expect(byId.get("file-2")?.status).toBe("upload_failed");
    expect(byId.get("file-2")?.error).toContain("could not be stored");
    expect(commitMusicTrackImportSession).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("awaiting_action");
  });

  it("retries only failed uploads and commits with one stable key", async () => {
    failOnceFor.add("file-2");
    const { result } = renderHook(() => useImportSession());
    await act(async () => {
      await result.current.startRun([
        plannedFile("file-1", "soprano"),
        plannedFile("file-2", "alto"),
      ]);
    });
    failOnceFor.clear();
    let retried = false;
    await act(async () => {
      retried = await result.current.retryUploads();
    });
    expect(retried).toBe(true);
    expect(uploadCalls.filter((call) => call.clientFileId === "file-1")).toHaveLength(1);
    expect(uploadCalls.filter((call) => call.clientFileId === "file-2")).toHaveLength(2);

    await act(async () => {
      await result.current.retryCommit();
    });
    await act(async () => {
      await result.current.retryCommit();
    });
    expect(commitKeys).toEqual([commitKeys[0], commitKeys[0]]);
    const byId = new Map(result.current.files.map((file) => [file.clientFileId, file]));
    expect(byId.get("file-1")?.status).toBe("committed");
    expect(byId.get("file-2")?.status).toBe("committed");
  });

  it("creates one session per batch and clears it after a completed run", async () => {
    const { result } = renderHook(() => useImportSession());
    await act(async () => {
      await result.current.startRun([plannedFile("file-1", "soprano")]);
    });
    expect(createMusicTrackImportSession).toHaveBeenCalledTimes(1);
    expect(uploadMusicTrackImportFile).toHaveBeenCalledTimes(1);
    expect(commitMusicTrackImportSession).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("done");
  });
});
