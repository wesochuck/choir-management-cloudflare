import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireOfflineAudioUrl,
  listOfflineAudioIds,
  offlineAudioUrl,
  planOfflineEvictions,
  purgeOfflineAudioForOrganization,
  releaseOfflineAudioUrl,
  removeOfflineAudio,
  saveOfflineAudio,
} from "./mediaStore";

interface FakeRequest<T> {
  error: Error | null;
  onerror: ((event?: unknown) => void) | null;
  onsuccess: ((event?: unknown) => void) | null;
  result: T | null;
}

interface MockDatabase {
  close: ReturnType<typeof vi.fn>;
  readonly isClosed: boolean;
  objectStoreNames: { contains: () => boolean };
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onversionchange: (() => void) | null;
  transaction: ReturnType<typeof vi.fn>;
}

function successfulRequest<T>(result: T): FakeRequest<T> {
  const request: FakeRequest<T> = { error: null, onerror: null, onsuccess: null, result };
  queueMicrotask(() => {
    request.onsuccess?.();
  });
  return request;
}

function installIndexedDatabase() {
  const audioRecords = new Map<string, unknown>();
  const metadataRecords = new Map<string, unknown>();
  const activeDatabases: MockDatabase[] = [];

  const audioStore = {
    delete: vi.fn((key: string) => {
      audioRecords.delete(key);
      return successfulRequest(undefined);
    }),
    get: vi.fn((key: string) => successfulRequest(audioRecords.get(key))),
    getAll: vi.fn(() => successfulRequest([...audioRecords.values()])),
    put: vi.fn((record: { readonly key: string }) => {
      audioRecords.set(record.key, record);
      return successfulRequest(record.key);
    }),
  };

  const metadataIndex = {
    getAll: vi.fn((scope: string) => {
      const matched = [...metadataRecords.values()].filter(
        (rec): rec is { readonly scope: string } =>
          typeof rec === "object" && rec !== null && "scope" in rec && rec.scope === scope,
      );
      return successfulRequest(matched);
    }),
  };

  const metadataStore = {
    delete: vi.fn((key: string) => {
      metadataRecords.delete(key);
      return successfulRequest(undefined);
    }),
    get: vi.fn((key: string) => successfulRequest(metadataRecords.get(key))),
    getAll: vi.fn(() => successfulRequest([...metadataRecords.values()])),
    index: vi.fn((name: string) => {
      if (name === "scope") return metadataIndex;
      throw new Error(`Unknown index ${name}`);
    }),
    put: vi.fn((record: { readonly key: string }) => {
      metadataRecords.set(record.key, record);
      return successfulRequest(record.key);
    }),
  };

  const openFn = vi.fn<() => FakeRequest<MockDatabase>>(() => {
    let isClosed = false;
    const database: MockDatabase = {
      close: vi.fn(() => {
        isClosed = true;
      }),
      get isClosed() {
        return isClosed;
      },
      objectStoreNames: { contains: () => true },
      onclose: null,
      onerror: null,
      onversionchange: null,
      transaction: vi.fn(() => {
        const tx = {
          objectStore: (name: string) => {
            if (name === "audioMetadata") return metadataStore;
            return audioStore;
          },
          onabort: null as (() => void) | null,
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
        };
        queueMicrotask(() => {
          tx.oncomplete?.();
        });
        return tx;
      }),
    };
    activeDatabases.push(database);
    return successfulRequest(database);
  });
  vi.stubGlobal("indexedDB", {
    open: openFn,
  });
  return {
    activeDatabases,
    audioRecords,
    audioStore,
    metadataIndex,
    metadataStore,
    metadataRecords,
    openFn,
  };
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

describe("cached player metadata", () => {
  it("persists and retrieves player metadata without affecting audio records", async () => {
    installIndexedDatabase();
    const { getCachedPlayerMetadata, saveCachedPlayerMetadata } = await import("./mediaStore");
    await saveCachedPlayerMetadata("scope-1", "test-key", { title: "Song" });
    const retrieved = await getCachedPlayerMetadata("scope-1", "test-key");
    expect(retrieved).toEqual({ title: "Song" });

    // Ensure audio listing ignores metadata records
    const audioIds = await listOfflineAudioIds("scope-1");
    expect(audioIds.size).toBe(0);
  });

  it("handles empty scope, empty key, or missing records gracefully", async () => {
    installIndexedDatabase();
    const { getCachedPlayerMetadata, saveCachedPlayerMetadata } = await import("./mediaStore");
    expect(await getCachedPlayerMetadata("", "key")).toBeNull();
    expect(await getCachedPlayerMetadata("scope", "")).toBeNull();
    expect(await getCachedPlayerMetadata("scope", "non-existent")).toBeNull();

    await saveCachedPlayerMetadata("", "key", { title: "Song" });
    await saveCachedPlayerMetadata("scope", "", { title: "Song" });
    expect(await getCachedPlayerMetadata("scope", "")).toBeNull();
  });

  it("evicts expired metadata when maxAgeMs is exceeded", async () => {
    installIndexedDatabase();
    const { getCachedPlayerMetadata, saveCachedPlayerMetadata } = await import("./mediaStore");
    await saveCachedPlayerMetadata("scope-ttl", "key-1", { title: "Old Song" });

    // Pass maxAgeMs of 0 ms to simulate expiration
    const expired = await getCachedPlayerMetadata("scope-ttl", "key-1", 0);
    expect(expired).toBeNull();

    // Verify it was evicted from storage
    const afterEvict = await getCachedPlayerMetadata("scope-ttl", "key-1");
    expect(afterEvict).toBeNull();
  });

  it("purges metadata scoped to an organization without touching other scopes or audio", async () => {
    installIndexedDatabase();
    const { getCachedPlayerMetadata, purgeCachedPlayerMetadata, saveCachedPlayerMetadata } =
      await import("./mediaStore");

    await saveCachedPlayerMetadata("org-a.localhost", "token-1", { title: "A1" });
    await saveCachedPlayerMetadata("org-a.localhost", "token-2", { title: "A2" });
    await saveCachedPlayerMetadata("org-b.localhost", "token-3", { title: "B1" });

    const purged = await purgeCachedPlayerMetadata("org-a.localhost");
    expect(purged).toBe(2);

    expect(await getCachedPlayerMetadata("org-a.localhost", "token-1")).toBeNull();
    expect(await getCachedPlayerMetadata("org-a.localhost", "token-2")).toBeNull();
    expect(await getCachedPlayerMetadata("org-b.localhost", "token-3")).toEqual({ title: "B1" });
  });
});

describe("offline IndexedDB connection lifecycle", () => {
  it("reuses one open request across repeated and concurrent operations", async () => {
    const harness = installIndexedDatabase();
    await Promise.all([
      listOfflineAudioIds("alpha.localhost"),
      listOfflineAudioIds("alpha.localhost"),
      listOfflineAudioIds("beta.localhost"),
    ]);
    expect(harness.openFn).toHaveBeenCalledOnce();
    await listOfflineAudioIds("alpha.localhost");
    expect(harness.openFn).toHaveBeenCalledOnce();
  });

  it("resets cached promise on open failure so retry succeeds", async () => {
    let shouldFail = true;
    const harness = installIndexedDatabase();
    harness.openFn.mockImplementation(() => {
      if (shouldFail) {
        const req: FakeRequest<MockDatabase> = {
          error: new Error("Opening failed"),
          onerror: null,
          onsuccess: null,
          result: null,
        };
        queueMicrotask(() => req.onerror?.());
        return req;
      }
      let isClosed = false;
      const database: MockDatabase = {
        close: vi.fn(() => {
          isClosed = true;
        }),
        get isClosed() {
          return isClosed;
        },
        objectStoreNames: { contains: () => true },
        onclose: null,
        onerror: null,
        onversionchange: null,
        transaction: vi.fn(() => ({
          objectStore: () => ({
            index: () => ({ getAll: () => successfulRequest([]) }),
          }),
        })),
      };
      return successfulRequest(database);
    });

    await expect(listOfflineAudioIds("alpha.localhost")).rejects.toThrow("Opening failed");

    shouldFail = false;
    const ids = await listOfflineAudioIds("alpha.localhost");
    expect(ids).toEqual(new Set());
    expect(harness.openFn).toHaveBeenCalledTimes(2);
  });

  it("closes old handle on versionchange and next calls obtain new version", async () => {
    const harness = installIndexedDatabase();
    await listOfflineAudioIds("alpha.localhost");
    expect(harness.openFn).toHaveBeenCalledTimes(1);

    const oldDb = harness.activeDatabases[0];
    if (!oldDb) throw new Error("Expected database connection");
    expect(oldDb.isClosed).toBe(false);

    // Simulate versionchange event
    oldDb.onversionchange?.();
    expect(oldDb.close).toHaveBeenCalled();

    // Subsequent operation should open a new connection
    await listOfflineAudioIds("alpha.localhost");
    expect(harness.openFn).toHaveBeenCalledTimes(2);
    expect(harness.activeDatabases.length).toBe(2);
  });

  it("does not invalidate new connection when old handle fires late close or error", async () => {
    const harness = installIndexedDatabase();
    await listOfflineAudioIds("alpha.localhost");
    const oldDb = harness.activeDatabases[0];
    if (!oldDb) throw new Error("Expected database connection");

    // Trigger versionchange to roll generation
    oldDb.onversionchange?.();

    // New operation creates new connection
    await listOfflineAudioIds("alpha.localhost");
    expect(harness.openFn).toHaveBeenCalledTimes(2);

    // Late close/error on oldDb
    oldDb.onclose?.();
    oldDb.onerror?.();

    // Next operation should still reuse the new connection without re-opening
    await listOfflineAudioIds("alpha.localhost");
    expect(harness.openFn).toHaveBeenCalledTimes(2);
  });
});

describe("scoped metadata storage and eviction", () => {
  it("lists IDs using scoped metadata index without accessing audio blob records", async () => {
    const harness = installIndexedDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Blob(["audio-bytes"], { type: "audio/mpeg" }), { status: 200 }),
        ),
      ),
    );
    await saveOfflineAudio("scope-a", "file-1", "/track-1");
    await saveOfflineAudio("scope-b", "file-2", "/track-2");

    harness.audioStore.get.mockClear();
    harness.audioStore.getAll.mockClear();

    const idsA = await listOfflineAudioIds("scope-a");
    expect(idsA).toEqual(new Set(["file-1"]));
    expect(harness.metadataIndex.getAll).toHaveBeenCalledWith("scope-a");
    // Assert audioStore (blobs) was never read
    expect(harness.audioStore.get).not.toHaveBeenCalled();
    expect(harness.audioStore.getAll).not.toHaveBeenCalled();
  });

  it("evicts oldest entries when storage exceeds cap, touching only the scoped metadata", async () => {
    installIndexedDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Blob([new Uint8Array(100 * 1024 * 1024)], { type: "audio/mpeg" }), {
            status: 200,
          }),
        ),
      ),
    );
    // OFFLINE_AUDIO_CAP_BYTES is 300MB
    await saveOfflineAudio("scope-evict", "file-1", "/track-1");
    await saveOfflineAudio("scope-evict", "file-2", "/track-2");
    await saveOfflineAudio("scope-evict", "file-3", "/track-3");
    expect(await listOfflineAudioIds("scope-evict")).toEqual(
      new Set(["file-1", "file-2", "file-3"]),
    );

    // Save a 4th file (100MB) which exceeds 300MB cap; file-1 should be evicted as oldest
    await saveOfflineAudio("scope-evict", "file-4", "/track-4");
    expect(await listOfflineAudioIds("scope-evict")).toEqual(
      new Set(["file-2", "file-3", "file-4"]),
    );
  });

  it("migrates existing v1 records to audioMetadata store on upgrade", async () => {
    const metaPut = vi.fn();
    const metaStore = {
      createIndex: vi.fn(),
      put: metaPut,
    };
    const blob = new Blob(["v1 audio"], { type: "audio/mpeg" });
    const cursor = {
      key: "scope-v1:file-v1",
      value: {
        blob,
        fileId: "file-v1",
        organizationId: "org-1",
        savedAt: 123456,
        scope: "scope-v1",
        source: "session" as const,
      },
      continue: vi.fn(),
    };
    let cursorCallback: (() => void) | null = null;
    const cursorReq = {
      get result() {
        return cursor;
      },
      set onsuccess(cb: () => void) {
        cursorCallback = cb;
      },
    };
    const audioStore = {
      openCursor: vi.fn(() => cursorReq),
    };

    const metadataIndex = {
      getAll: vi.fn(() => successfulRequest([])),
    };
    const metadataQueryStore = {
      index: vi.fn(() => metadataIndex),
    };

    vi.stubGlobal("indexedDB", {
      open: vi.fn(() => {
        const req = {
          error: null,
          onerror: null,
          onsuccess: null as (() => void) | null,
          onupgradeneeded: null as ((ev: { oldVersion: number }) => void) | null,
          result: {
            close: vi.fn(),
            isClosed: false,
            objectStoreNames: { contains: (name: string) => name === "audio" },
            createObjectStore: vi.fn(() => metaStore),
            onclose: null,
            onerror: null,
            onversionchange: null,
            transaction: vi.fn(() => ({
              objectStore: vi.fn(() => metadataQueryStore),
            })),
          },
          transaction: {
            objectStore: vi.fn((name: string) =>
              name === "audioMetadata" ? metaStore : audioStore,
            ),
          },
        };
        queueMicrotask(() => {
          req.onupgradeneeded?.({ oldVersion: 1 });
          cursorCallback?.();
          req.onsuccess?.();
        });
        return req;
      }),
    });

    await listOfflineAudioIds("scope-v1");
    expect(metaPut).toHaveBeenCalledWith({
      fileId: "file-v1",
      key: "scope-v1:file-v1",
      organizationId: "org-1",
      savedAt: 123456,
      scope: "scope-v1",
      sizeBytes: blob.size,
      source: "session",
    });
  });
});

describe("offline playback object URL lifecycle", () => {
  it("deduplicates concurrent acquisitions to one URL creation", async () => {
    installIndexedDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Blob(["audio-bytes"], { type: "audio/mpeg" }), { status: 200 }),
        ),
      ),
    );
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:dedup-audio");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await saveOfflineAudio("scope-lease", "file-1", "/track-1");
    createUrl.mockClear();

    const [lease1, lease2] = await Promise.all([
      acquireOfflineAudioUrl("scope-lease", "file-1"),
      acquireOfflineAudioUrl("scope-lease", "file-1"),
    ]);

    expect(createUrl).toHaveBeenCalledOnce();
    expect(lease1?.url).toBe("blob:dedup-audio");
    expect(lease2?.url).toBe("blob:dedup-audio");

    // Release lease 1: lease 2 is still held, so URL is not revoked yet
    lease1?.release();
    expect(revokeUrl).not.toHaveBeenCalled();

    // Release lease 2: refCount reaches 0, so URL is revoked
    lease2?.release();
    expect(revokeUrl).toHaveBeenCalledWith("blob:dedup-audio");
  });

  it("delayed reads racing deletion/purge do not publish an obsolete URL", async () => {
    installIndexedDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Blob(["audio-bytes"], { type: "audio/mpeg" }), { status: 200 }),
        ),
      ),
    );
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:raced-audio");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await saveOfflineAudio("scope-race", "file-1", "/track-1");
    createUrl.mockClear();

    // Start acquisition
    const acquirePromise = acquireOfflineAudioUrl("scope-race", "file-1");

    // Race with removal before resolution completes
    await removeOfflineAudio("scope-race", "file-1");

    const lease = await acquirePromise;
    expect(lease).toBeNull();
  });

  it("permits retry after a failed read", async () => {
    const harness = installIndexedDatabase();
    let shouldFail = true;
    harness.audioStore.get.mockImplementation((key: string) => {
      if (shouldFail) {
        const req: FakeRequest<unknown> = {
          error: new Error("Read failed"),
          onerror: null,
          onsuccess: null,
          result: null,
        };
        queueMicrotask(() => req.onerror?.());
        return req;
      }
      return successfulRequest({ blob: new Blob(["audio"], { type: "audio/mpeg" }), key });
    });

    await expect(acquireOfflineAudioUrl("scope-retry", "file-retry")).rejects.toThrow(
      "Read failed",
    );

    // Retry should succeed
    shouldFail = false;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retried-audio");
    const lease = await acquireOfflineAudioUrl("scope-retry", "file-retry");
    expect(lease?.url).toBe("blob:retried-audio");
    lease?.release();
  });

  it("releases tracked URL when releaseOfflineAudioUrl is called directly", async () => {
    installIndexedDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Blob(["audio-bytes"], { type: "audio/mpeg" }), { status: 200 }),
        ),
      ),
    );
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:direct-audio");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await saveOfflineAudio("scope-direct", "file-1", "/track-1");
    createUrl.mockClear();

    const lease = await acquireOfflineAudioUrl("scope-direct", "file-1");
    expect(lease?.url).toBe("blob:direct-audio");

    releaseOfflineAudioUrl("scope-direct", "file-1");
    expect(revokeUrl).toHaveBeenCalledWith("blob:direct-audio");
  });
});
