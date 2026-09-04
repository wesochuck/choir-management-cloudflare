import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listOfflineAudioIds,
  offlineAudioUrl,
  planOfflineEvictions,
  purgeOfflineAudioForOrganization,
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

  it("purges one organization's copies while keeping other organizations and legacy copies", async () => {
    installIndexedDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(new Blob(["audio"], { type: "audio/mpeg" }), { status: 200 })),
      ),
    );
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:offline-audio");

    await saveOfflineAudio("alpha.localhost", "file-a", "/private/file-a", {
      organizationId: "org-a",
      source: "session",
    });
    await saveOfflineAudio("alpha.localhost", "file-b", "/private/file-b", {
      organizationId: "org-b",
      source: "token",
    });
    await saveOfflineAudio("alpha.localhost", "file-legacy", "/private/file-legacy");
    expect(await offlineAudioUrl("alpha.localhost", "file-a")).toBe("blob:offline-audio");

    expect(await purgeOfflineAudioForOrganization("alpha.localhost", "org-a")).toBe(1);
    expect(await listOfflineAudioIds("alpha.localhost")).toEqual(
      new Set(["file-b", "file-legacy"]),
    );
    expect(revokeUrl).toHaveBeenCalledWith("blob:offline-audio");

    expect(await purgeOfflineAudioForOrganization("alpha.localhost", "org-nothing")).toBe(0);
  });
});

describe("planOfflineEvictions", () => {
  it("evicts nothing under the cap", () => {
    expect(
      planOfflineEvictions(
        [
          { key: "a", savedAt: 1, sizeBytes: 40 },
          { key: "b", savedAt: 2, sizeBytes: 50 },
        ],
        100,
        null,
      ),
    ).toEqual([]);
  });

  it("evicts oldest first until under the cap and never the fresh save", () => {
    expect(
      planOfflineEvictions(
        [
          { key: "old", savedAt: 1, sizeBytes: 60 },
          { key: "mid", savedAt: 2, sizeBytes: 60 },
          { key: "new", savedAt: 3, sizeBytes: 60 },
        ],
        100,
        "new",
      ),
    ).toEqual(["old", "mid"]);
  });

  it("protects the fresh save even when it is the oldest entry", () => {
    expect(
      planOfflineEvictions(
        [
          { key: "new", savedAt: 1, sizeBytes: 90 },
          { key: "other", savedAt: 2, sizeBytes: 90 },
        ],
        100,
        "new",
      ),
    ).toEqual(["other"]);
  });

  it("treats exactly-at-cap as satisfied", () => {
    expect(planOfflineEvictions([{ key: "a", savedAt: 1, sizeBytes: 100 }], 100, null)).toEqual([]);
  });
});
