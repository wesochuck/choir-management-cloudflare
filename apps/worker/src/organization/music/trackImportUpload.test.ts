import type { Env } from "../../env";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  failMusicTrackImportUploadInStore,
  finalizeMusicTrackImportUploadInStore,
} from "./trackImportStore";
import type { UploadClaimResult } from "./trackImportStore";
import { uploadMusicTrackImportFile } from "./trackImportUpload";

const { claimImpl, failImpl, finalizeImpl } = vi.hoisted(() => ({
  claimImpl: vi.fn((): Promise<UploadClaimResult> => {
    throw new Error("claimMusicTrackImportUpload is not mocked for this test");
  }),
  failImpl: vi.fn((): Promise<ReturnType<typeof failMusicTrackImportUploadInStore>> =>
    Promise.resolve({ superseded: null }),
  ),
  finalizeImpl: vi.fn((): Promise<ReturnType<typeof finalizeMusicTrackImportUploadInStore>> =>
    Promise.resolve({ fileId: "file-uuid-1", status: "uploaded" }),
  ),
}));

vi.mock("../rpc/client", () => ({
  organizationStoreStub: () => ({
    claimMusicTrackImportUpload: claimImpl,
    failMusicTrackImportUpload: failImpl,
    finalizeMusicTrackImportUpload: finalizeImpl,
  }),
}));

const putCalls: { body: unknown; key: string; options: unknown }[] = [];
const deleteCalls: string[] = [];
let putBehavior: "ok" | "throw" = "ok";

const BYTES = new TextEncoder().encode("dummy-audio-bytes");

function baseInput() {
  const bytes = BYTES.buffer.slice(0, BYTES.byteLength);
  return {
    actorUserId: "actor-1",
    body: bytes,
    clientFileId: "file-1",
    contentType: "audio/mpeg",
    fileName: "file-1.mp3",
    organizationId: "org-1",
    requestId: "req-1",
    sessionId: "session-1",
    sizeBytes: bytes.byteLength,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mock upload environment
const fakeBucket = {
  delete: (key: string): Promise<void> => {
    deleteCalls.push(key);
    return Promise.resolve();
  },
  put: (key: string, body: unknown, options: unknown): Promise<{ version: string | null }> => {
    putCalls.push({ body, key, options });
    if (putBehavior === "throw") return Promise.reject(new Error("R2 exploded"));
    return Promise.resolve({ version: "v1" });
  },
} as unknown as Env["ORGANIZATION_FILES"];

const env = (): Pick<Env, "ORGANIZATION_FILES" | "ORGANIZATION_STORE"> => ({
  ORGANIZATION_FILES: fakeBucket,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mocked Durable Object namespace
  ORGANIZATION_STORE: {} as unknown as Env["ORGANIZATION_STORE"],
});

beforeEach(() => {
  vi.clearAllMocks();
  putCalls.length = 0;
  deleteCalls.length = 0;
  putBehavior = "ok";
  claimImpl.mockResolvedValue({
    alreadyUploaded: false,
    fileId: "file-uuid-1",
    leaseExpiresAt: "2026-10-21T00:15:00.000Z",
    storageKey: "organizations/org-1/private/file-1-file-uuid-1.mp3",
    superseded: null,
  });
  failImpl.mockResolvedValue({ superseded: null });
  finalizeImpl.mockResolvedValue({ fileId: "file-uuid-1", status: "uploaded" });
});

describe("session upload orchestration", () => {
  it("puts bytes to the exact claimed key and finalizes the attempt", async () => {
    const result = await uploadMusicTrackImportFile(env(), baseInput());
    expect(result).toEqual({
      bytesReceived: BYTES.byteLength,
      fileId: "file-uuid-1",
      status: "uploaded",
    });
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.key).toBe("organizations/org-1/private/file-1-file-uuid-1.mp3");
    expect(putCalls[0]?.options).toEqual({
      customMetadata: { fileId: "file-uuid-1", organizationId: "org-1" },
      httpMetadata: { contentType: "audio/mpeg" },
    });
    expect(finalizeImpl).toHaveBeenCalledTimes(1);
    expect(failImpl).not.toHaveBeenCalled();
    expect(deleteCalls).toEqual([]);
  });

  it("returns already-uploaded replays without touching R2", async () => {
    claimImpl.mockResolvedValue({
      alreadyUploaded: true,
      fileId: "file-uuid-1",
      leaseExpiresAt: "2026-10-21T00:15:00.000Z",
      storageKey: "organizations/org-1/private/file-1-file-uuid-1.mp3",
      superseded: null,
    });
    const result = await uploadMusicTrackImportFile(env(), baseInput());
    expect(result.status).toBe("already_uploaded");
    expect(putCalls).toEqual([]);
    expect(finalizeImpl).not.toHaveBeenCalled();
  });

  it("rejects a claimed key that does not match the server-derived scope", async () => {
    claimImpl.mockResolvedValue({
      alreadyUploaded: false,
      fileId: "file-uuid-1",
      leaseExpiresAt: "2026-10-21T00:15:00.000Z",
      storageKey: "organizations/org-1/private/evil.mp3",
      superseded: null,
    });
    await expect(uploadMusicTrackImportFile(env(), baseInput())).rejects.toThrow(
      "storage scope was rejected",
    );
    expect(putCalls).toEqual([]);
    expect(failImpl).toHaveBeenCalledTimes(1);
  });

  it("records the failure and cleans up keys when the R2 write fails", async () => {
    putBehavior = "throw";
    await expect(uploadMusicTrackImportFile(env(), baseInput())).rejects.toThrow(
      "could not be stored safely",
    );
    expect(failImpl).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "r2_write_failed", fileId: "file-uuid-1" }),
    );
    expect(deleteCalls).toContain("organizations/org-1/private/file-1-file-uuid-1.mp3");
  });

  it("deletes the key and reports a retryable lease error when finalization fails", async () => {
    finalizeImpl.mockRejectedValue(
      Object.assign(new Error("validation_failed: lease expired"), { code: "validation_failed" }),
    );
    await expect(uploadMusicTrackImportFile(env(), baseInput())).rejects.toThrow(
      "lease expired before the upload finished",
    );
    expect(deleteCalls).toContain("organizations/org-1/private/file-1-file-uuid-1.mp3");
    expect(failImpl).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "finalize_failed" }),
    );
  });
});
