export type OfflineAudioSource = "session" | "token";

interface OfflineAudioRecord {
  readonly blob: Blob;
  readonly fileId: string;
  readonly organizationId: string | null;
  readonly savedAt: number;
  readonly scope: string;
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
const storeName = "audio";
const databaseVersion = 1;
const activeUrls = new Map<string, string>();

function recordKey(scope: string, fileId: string): string {
  return `${scope}:${fileId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Offline media storage could not be opened."));
    };
  });
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

function releaseUrl(key: string): void {
  const url = activeUrls.get(key);
  if (!url) return;
  URL.revokeObjectURL(url);
  activeUrls.delete(key);
}

function recordBlob(value: object): Blob | null {
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

async function readScopeRecords(
  database: IDBDatabase,
  scope: string,
): Promise<readonly OfflineAudioRecord[]> {
  const result: unknown = await requestResult(
    database.transaction(storeName, "readonly").objectStore(storeName).getAll(),
  );
  const records = Array.isArray(result)
    ? result.flatMap((value) => offlineRecord(value) ?? [])
    : [];
  return records.filter((record) => record.scope === scope);
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
  await requestResult(
    database.transaction(storeName, "readwrite").objectStore(storeName).delete(key),
  );
  releaseUrl(key);
}

export async function listOfflineAudioIds(scope: string): Promise<ReadonlySet<string>> {
  const database = await openDatabase();
  const records = await readScopeRecords(database, scope);
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
  await requestResult(
    database
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
      .put({
        blob,
        fileId,
        key,
        organizationId: details.organizationId ?? null,
        savedAt: Date.now(),
        scope,
        source: details.source ?? null,
      }),
  );
  releaseUrl(key);
  const records = await readScopeRecords(database, scope);
  const victims = planOfflineEvictions(
    records.map((record) => ({
      key: recordKey(record.scope, record.fileId),
      savedAt: record.savedAt,
      sizeBytes: record.blob.size,
    })),
    OFFLINE_AUDIO_CAP_BYTES,
    key,
  );
  for (const victim of victims) {
    await deleteOfflineRecord(database, victim);
  }
}

export async function offlineAudioUrl(scope: string, fileId: string): Promise<string | null> {
  const key = recordKey(scope, fileId);
  const active = activeUrls.get(key);
  if (active) return active;
  const database = await openDatabase();
  const result: unknown = await requestResult(
    database.transaction(storeName, "readonly").objectStore(storeName).get(key),
  );
  const record = offlineRecord(result);
  if (!record?.blob) return null;
  const url = URL.createObjectURL(record.blob);
  activeUrls.set(key, url);
  return url;
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
  const records = await readScopeRecords(database, scope);
  const doomed = records.filter((record) => record.organizationId === organizationId);
  for (const record of doomed) {
    await deleteOfflineRecord(database, recordKey(record.scope, record.fileId));
  }
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
  const records = await readScopeRecords(database, scope);
  const doomed = records.filter((record) => record.source === source);
  for (const record of doomed) {
    await deleteOfflineRecord(database, recordKey(record.scope, record.fileId));
  }
  return doomed.length;
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
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
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
    database.transaction(storeName, "readonly").objectStore(storeName).get(storageKey),
  );
  if (typeof result === "object" && result !== null && "details" in result) {
    if ("savedAt" in result && typeof result.savedAt === "number") {
      if (Date.now() - result.savedAt >= maxAgeMs) {
        // Expired metadata: lazily evict from IndexedDB
        void deleteOfflineRecord(database, storageKey).catch(() => undefined);
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
    database.transaction(storeName, "readonly").objectStore(storeName).getAll(),
  );
  if (!Array.isArray(result)) return 0;
  let purged = 0;
  for (const item of result) {
    if (isObjectWithKey(item) && item.key.startsWith(prefix)) {
      await deleteOfflineRecord(database, item.key);
      purged += 1;
    }
  }
  return purged;
}
