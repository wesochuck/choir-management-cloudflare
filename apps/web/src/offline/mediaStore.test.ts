import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listOfflineAudioIds,
  offlineAudioUrl,
  removeOfflineAudio,
  saveOfflineAudio,
} from "./mediaStore";

interface FakeRequest<T> {
  error: Error | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  result: T;
}

function successfulRequest<T>(result: T): FakeRequest<T> {
  const request: FakeRequest<T> = { error: null, onerror: null, onsuccess: null, result };
  queueMicrotask(() => {
    request.onsuccess?.();
  });
  return request;
}

function installIndexedDatabase(): void {
  const records = new Map<string, unknown>();
  const store = {
    delete: (key: string) => {
      records.delete(key);
      return successfulRequest(undefined);
    },
    get: (key: string) => successfulRequest(records.get(key)),
    getAll: () => successfulRequest([...records.values()]),
    put: (record: { readonly key: string }) => {
      records.set(record.key, record);
      return successfulRequest(record.key);
    },
  };
  const database = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store }),
  };
  vi.stubGlobal("indexedDB", {
    open: () => successfulRequest(database),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("offline private audio", () => {
  it("persists by host scope, creates a playable blob URL, and removes the copy", async () => {
    installIndexedDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(new Blob(["audio"], { type: "audio/mpeg" }), { status: 200 })),
      ),
    );
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:offline-audio");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await saveOfflineAudio("alpha.localhost", "file-one", "/private/file-one");
    expect(await listOfflineAudioIds("alpha.localhost")).toEqual(new Set(["file-one"]));
    expect(await listOfflineAudioIds("bravo.localhost")).toEqual(new Set());
    expect(await offlineAudioUrl("alpha.localhost", "file-one")).toBe("blob:offline-audio");
    expect(createUrl).toHaveBeenCalledOnce();

    await removeOfflineAudio("alpha.localhost", "file-one");
    expect(await listOfflineAudioIds("alpha.localhost")).toEqual(new Set());
    expect(revokeUrl).toHaveBeenCalledWith("blob:offline-audio");
  });
});
