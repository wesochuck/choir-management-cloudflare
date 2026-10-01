export type OfflineAudioSource = "session" | "token";

interface OfflineAudioRecord {
  readonly blob: Blob;
  readonly fileId: string;
  readonly organizationId: string | null;
  readonly savedAt: number;
  readonly scope: string;
  readonly source: OfflineAudioSource | null;
}

export interface OfflineAudioMetadata {
  readonly fileId: string;
  readonly key: string;
  readonly organizationId: string | null;
  readonly savedAt: number;
  readonly scope: string;
  readonly sizeBytes: number;
  readonly source: OfflineAudioSource | null;
}

export interface SaveOfflineAudioDetails {
  readonly organizationId?: string;
  readonly source?: OfflineAudioSource;
}

export interface OfflineStorageEntry {
  readonly key: string;
  readonly savedAt: number;
  readonly sizeBytes: number;
}

export const OFFLINE_AUDIO_CAP_BYTES = 300 * 1024 * 1024;

const databaseName = "choir-private-media";
const audioStoreName = "audio";
const metadataStoreName = "audioMetadata";
const databaseVersion = 2;

export interface OfflineAudioLease {
  readonly fileId: string;
  readonly release: () => void;
  readonly scope: string;
  readonly url: string;
}

interface TrackedUrl {
  refCount: number;
  url: string;
}

const activeUrlEntries = new Map<string, TrackedUrl>();
const pendingUrlPromises = new Map<string, Promise<string | null>>();
const keyGenerations = new Map<string, number>();

function getKeyGeneration(key: string): number {
  return keyGenerations.get(key) ?? 0;
}

function bumpKeyGeneration(key: string): void {
  keyGenerations.set(key, (keyGenerations.get(key) ?? 0) + 1);
}

function releaseUrlRef(key: string, expectedEntry?: TrackedUrl): void {
  const entry = activeUrlEntries.get(key);
  if (!entry || (expectedEntry && entry !== expectedEntry)) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    URL.revokeObjectURL(entry.url);
    activeUrlEntries.delete(key);
  }
}

function forceRevokeUrl(key: string): void {
  bumpKeyGeneration(key);
  const entry = activeUrlEntries.get(key);
  if (entry) {
    URL.revokeObjectURL(entry.url);
    activeUrlEntries.delete(key);
  }
}

export function releaseOfflineAudioUrl(scope: string, fileId: string): void {
  const key = recordKey(scope, fileId);
  releaseUrlRef(key);
}

function recordKey(scope: string, fileId: string): string {
  return `${scope}:${fileId}`;
}

let cachedDatabasePromise: Promise<IDBDatabase> | null = null;
let currentConnectionGeneration = 0;
let lastIndexedDB: IDBFactory | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Offline media storage is unavailable."));
  }
  if (lastIndexedDB !== indexedDB) {
    cachedDatabasePromise = null;
    lastIndexedDB = indexedDB;
  }
  if (cachedDatabasePromise) {
    return cachedDatabasePromise;
  }
  const generation = ++currentConnectionGeneration;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onblocked = () => {
      if (currentConnectionGeneration === generation) {
        cachedDatabasePromise = null;
      }
      reject(new Error("Offline media storage upgrade was blocked by another tab."));
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(audioStoreName)) {
        db.createObjectStore(audioStoreName, { keyPath: "key" });
      }
      let metaStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(metadataStoreName)) {
        metaStore = db.createObjectStore(metadataStoreName, { keyPath: "key" });
        metaStore.createIndex("scope", "scope", { unique: false });
      } else {
        const tx = request.transaction;
        if (tx) {
          metaStore = tx.objectStore(metadataStoreName);
        } else {
          return;
        }
      }

      if (event.oldVersion < 2 && event.oldVersion > 0) {
        const tx = request.transaction;
        if (!tx) return;
        const audioStore = tx.objectStore(audioStoreName);
        const cursorReq = audioStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const rec = offlineRecord(cursor.value);
            if (rec) {
              const key =
                typeof cursor.key === "string" ? cursor.key : recordKey(rec.scope, rec.fileId);
              metaStore.put({
                fileId: rec.fileId,
                key,
                organizationId: rec.organizationId,
                savedAt: rec.savedAt,
                scope: rec.scope,
                sizeBytes: rec.blob.size,
                source: rec.source,
              });
            }
            cursor.continue();
          }
        };
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => {
        db.close();
        if (currentConnectionGeneration === generation) {
          cachedDatabasePromise = null;
        }
      };

      db.onclose = () => {
        if (currentConnectionGeneration === generation) {
          cachedDatabasePromise = null;
        }
      };

      resolve(db);
    };

    request.onerror = () => {
      if (currentConnectionGeneration === generation) {
        cachedDatabasePromise = null;
      }
      reject(request.error ?? new Error("Offline media storage could not be opened."));
    };
  });

  cachedDatabasePromise = promise.catch((error: unknown) => {
    if (currentConnectionGeneration === generation) {
      cachedDatabasePromise = null;
    }
    throw error;
  });

  return cachedDatabasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Offline media storage failed."));
    };
  });
}

function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error("Offline media transaction aborted."));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error("Offline media transaction failed."));
    };
  });
}

function recordBlob(value: unknown): Blob | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("blob" in value) || !(value.blob instanceof Blob)) return null;
  return value.blob;
}

function recordFileId(value: object): string | null {
  if (!("fileId" in value) || typeof value.fileId !== "string") return null;
  return value.fileId;
}

function recordSavedAt(value: object): number | null {
  if (!("savedAt" in value) || typeof value.savedAt !== "number") return null;
  return value.savedAt;
}

function recordScope(value: object): string | null {
  if (!("scope" in value) || typeof value.scope !== "string") return null;
  return value.scope;
}

function optionalOrganizationId(value: object): string | null {
  if (!("organizationId" in value) || typeof value.organizationId !== "string") return null;
  return value.organizationId;
}

function offlineSource(value: object): OfflineAudioSource | null {
  if (!("source" in value)) return null;
  if (value.source !== "session" && value.source !== "token") return null;
  return value.source;
}

function offlineMetadataRecord(value: unknown): OfflineAudioMetadata | null {
  if (typeof value !== "object" || value === null) return null;
  const fileId = recordFileId(value);
  const savedAt = recordSavedAt(value);
  const scope = recordScope(value);
  if (!fileId || savedAt === null || !scope) return null;
  const key =
    "key" in value && typeof value.key === "string" ? value.key : recordKey(scope, fileId);
  const sizeBytes =
    "sizeBytes" in value && typeof value.sizeBytes === "number" ? value.sizeBytes : 0;
  return {
    fileId,
    key,
    organizationId: optionalOrganizationId(value),
    savedAt,
    scope,
    sizeBytes,
    source: offlineSource(value),
  };
}

function offlineRecord(value: unknown): OfflineAudioRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const blob = recordBlob(value);
  const fileId = recordFileId(value);
  const savedAt = recordSavedAt(value);
  const scope = recordScope(value);
  if (!blob || !fileId || savedAt === null || !scope) return null;
  return {
    blob,
    fileId,
    organizationId: optionalOrganizationId(value),
    savedAt,
    scope,
    source: offlineSource(value),
  };
}

async function readScopeMetadata(
  database: IDBDatabase,
  scope: string,
): Promise<readonly OfflineAudioMetadata[]> {
  const tx = database.transaction(metadataStoreName, "readonly");
  const store = tx.objectStore(metadataStoreName);
  const index = store.index("scope");
  const result: unknown = await requestResult(index.getAll(scope));
  const records = Array.isArray(result)
    ? result.flatMap((value) => offlineMetadataRecord(value) ?? [])
    : [];
  return records;
}

/**
 * Oldest-first eviction plan that brings `records` under `maxBytes`. Re-saving a copy (including
 * background refreshes) renews its recency, so long-held but regularly refreshed event audio is
 * evicted last. `exceptKey` is never evicted, so a fresh save always survives its own enforcement.
 */
export function planOfflineEvictions(
  records: readonly OfflineStorageEntry[],
  maxBytes: number,
  exceptKey: string | null,
): readonly string[] {
  let totalBytes = records.reduce((total, record) => total + record.sizeBytes, 0);
  if (totalBytes <= maxBytes) return [];
  const plan: string[] = [];
  const victims = records
    .filter((record) => record.key !== exceptKey)
    .toSorted((left, right) => left.savedAt - right.savedAt);
  for (const victim of victims) {
    if (totalBytes <= maxBytes) break;
    plan.push(victim.key);
    totalBytes -= victim.sizeBytes;
  }
  return plan;
}

async function deleteOfflineRecord(database: IDBDatabase, key: string): Promise<void> {
  const tx = database.transaction([audioStoreName, metadataStoreName], "readwrite");
  tx.objectStore(audioStoreName).delete(key);
  tx.objectStore(metadataStoreName).delete(key);
  await awaitTransaction(tx);
  forceRevokeUrl(key);
}

export async function listOfflineAudioIds(scope: string): Promise<ReadonlySet<string>> {
  const database = await openDatabase();
  const records = await readScopeMetadata(database, scope);
  return new Set(records.map(({ fileId }) => fileId));
}

export async function saveOfflineAudio(
  scope: string,
  fileId: string,
  sourceUrl: string,
  details: SaveOfflineAudioDetails = {},
): Promise<void> {
  const response = await fetch(sourceUrl, { credentials: "same-origin" });
  if (!response.ok) throw new Error("The learning track could not be downloaded.");
  const blob = await response.blob();
  if (!blob.type.startsWith("audio/") || blob.size === 0) {
    throw new Error("The downloaded learning track was not valid audio.");
  }
  const key = recordKey(scope, fileId);
  const database = await openDatabase();
  const tx = database.transaction([audioStoreName, metadataStoreName], "readwrite");
  tx.objectStore(audioStoreName).put({
    blob,
    key,
  });
  tx.objectStore(metadataStoreName).put({
    fileId,
    key,
    organizationId: details.organizationId ?? null,
    savedAt: Date.now(),
    scope,
    sizeBytes: blob.size,
    source: details.source ?? null,
  });
  await awaitTransaction(tx);
  forceRevokeUrl(key);

  const records = await readScopeMetadata(database, scope);
  const victims = planOfflineEvictions(
    records.map((record) => ({
      key: record.key,
      savedAt: record.savedAt,
      sizeBytes: record.sizeBytes,
    })),
    OFFLINE_AUDIO_CAP_BYTES,
    key,
  );
  if (victims.length > 0) {
    const evictTx = database.transaction([audioStoreName, metadataStoreName], "readwrite");
    const audioStore = evictTx.objectStore(audioStoreName);
    const metaStore = evictTx.objectStore(metadataStoreName);
    for (const victim of victims) {
      audioStore.delete(victim);
      metaStore.delete(victim);
      forceRevokeUrl(victim);
    }
    await awaitTransaction(evictTx);
  }
}

export async function acquireOfflineAudioUrl(
  scope: string,
  fileId: string,
): Promise<OfflineAudioLease | null> {
  const key = recordKey(scope, fileId);
  const active = activeUrlEntries.get(key);
  if (active) {
    active.refCount += 1;
    let released = false;
    return {
      fileId,
      release: () => {
        if (released) return;
        released = true;
        releaseUrlRef(key, active);
      },
      scope,
      url: active.url,
    };
  }

  let pending = pendingUrlPromises.get(key);
  if (!pending) {
    const readGeneration = getKeyGeneration(key);
    pending = (async (): Promise<string | null> => {
      try {
        const database = await openDatabase();
        const result: unknown = await requestResult(
          database.transaction(audioStoreName, "readonly").objectStore(audioStoreName).get(key),
        );
        const blob = recordBlob(result);
        if (!blob) return null;

        if (getKeyGeneration(key) !== readGeneration) {
          return null;
        }

        const url = URL.createObjectURL(blob);
        if (getKeyGeneration(key) !== readGeneration) {
          URL.revokeObjectURL(url);
          return null;
        }

        activeUrlEntries.set(key, { refCount: 0, url });
        return url;
      } finally {
        pendingUrlPromises.delete(key);
      }
    })();

    pendingUrlPromises.set(key, pending);
  }

  const url = await pending;
  if (!url) return null;

  const entry = activeUrlEntries.get(key);
  if (!entry) return null;

  entry.refCount += 1;
  let released = false;
  return {
    fileId,
    release: () => {
      if (released) return;
      released = true;
      releaseUrlRef(key, entry);
    },
    scope,
    url: entry.url,
  };
}

export async function offlineAudioUrl(scope: string, fileId: string): Promise<string | null> {
  const lease = await acquireOfflineAudioUrl(scope, fileId);
  return lease ? lease.url : null;
}

export async function removeOfflineAudio(scope: string, fileId: string): Promise<void> {
  const database = await openDatabase();
  await deleteOfflineRecord(database, recordKey(scope, fileId));
}

/**
 * Deletes every Offline Copy in `scope` recorded for `organizationId`. Copies recorded before
 * organization tracking (or for other organizations) are left untouched. Returns the purge count.
 * Runs on sign-out and observed membership loss — never on switching the active organization.
 */
export async function purgeOfflineAudioForOrganization(
  scope: string,
  organizationId: string,
): Promise<number> {
  const database = await openDatabase();
  const records = await readScopeMetadata(database, scope);
  const doomed = records.filter((record) => record.organizationId === organizationId);
  if (doomed.length === 0) return 0;
  const tx = database.transaction([audioStoreName, metadataStoreName], "readwrite");
  const audioStore = tx.objectStore(audioStoreName);
  const metaStore = tx.objectStore(metadataStoreName);
  for (const record of doomed) {
    audioStore.delete(record.key);
    metaStore.delete(record.key);
    forceRevokeUrl(record.key);
  }
  await awaitTransaction(tx);
  return doomed.length;
}

/**
 * Deletes every Offline Copy in `scope` recorded from `source`, regardless of organization.
 * Sign-out and observed membership loss purge the session source (in the member app one host
 * serves one Organization, so this is organization-precise in practice); token-source copies
 * are link-holder data independent of any session and are left untouched. Returns the count.
 */
export async function purgeOfflineAudioForSource(
  scope: string,
  source: OfflineAudioSource,
): Promise<number> {
  const database = await openDatabase();
  const records = await readScopeMetadata(database, scope);
  const doomed = records.filter((record) => record.source === source);
  if (doomed.length === 0) return 0;
  const tx = database.transaction([audioStoreName, metadataStoreName], "readwrite");
  const audioStore = tx.objectStore(audioStoreName);
  const metaStore = tx.objectStore(metadataStoreName);
  for (const record of doomed) {
    audioStore.delete(record.key);
    metaStore.delete(record.key);
    forceRevokeUrl(record.key);
  }
  await awaitTransaction(tx);
  return doomed.length;
}

async function deletePlayerMetadataRecord(database: IDBDatabase, key: string): Promise<void> {
  await requestResult(
    database.transaction(audioStoreName, "readwrite").objectStore(audioStoreName).delete(key),
  );
}

const DEFAULT_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days retention

export async function saveCachedPlayerMetadata(
  scope: string,
  key: string,
  details: unknown,
): Promise<void> {
  if (!scope || !key) return;
  const database = await openDatabase();
  await requestResult(
    database
      .transaction(audioStoreName, "readwrite")
      .objectStore(audioStoreName)
      .put({
        details,
        key: `metadata:${scope}:${key}`,
        savedAt: Date.now(),
        scope,
      }),
  );
}

export async function getCachedPlayerMetadata(
  scope: string,
  key: string,
  maxAgeMs = DEFAULT_METADATA_TTL_MS,
): Promise<unknown> {
  if (!scope || !key) return null;
  const database = await openDatabase();
  const storageKey = `metadata:${scope}:${key}`;
  const result: unknown = await requestResult(
    database.transaction(audioStoreName, "readonly").objectStore(audioStoreName).get(storageKey),
  );
  if (typeof result === "object" && result !== null && "details" in result) {
    if ("savedAt" in result && typeof result.savedAt === "number") {
      if (Date.now() - result.savedAt >= maxAgeMs) {
        // Expired metadata: lazily evict from IndexedDB
        void deletePlayerMetadataRecord(database, storageKey).catch(() => undefined);
        return null;
      }
    }
    return result.details;
  }
  return null;
}

function isObjectWithKey(value: unknown): value is { readonly key: string } {
  if (typeof value !== "object" || value === null) return false;
  return "key" in value && typeof value.key === "string";
}

export async function purgeCachedPlayerMetadata(scope: string): Promise<number> {
  if (!scope) return 0;
  const database = await openDatabase();
  const prefix = `metadata:${scope}:`;
  const result: unknown = await requestResult(
    database.transaction(audioStoreName, "readonly").objectStore(audioStoreName).getAll(),
  );
  if (!Array.isArray(result)) return 0;
  let purged = 0;
  for (const item of result) {
    if (isObjectWithKey(item) && item.key.startsWith(prefix)) {
      await deletePlayerMetadataRecord(database, item.key);
      purged += 1;
    }
  }
  return purged;
}
