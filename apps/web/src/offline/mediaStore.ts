interface OfflineAudioRecord {
  readonly blob: Blob;
  readonly fileId: string;
  readonly savedAt: number;
  readonly scope: string;
}

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

function offlineRecord(value: unknown): OfflineAudioRecord | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("blob" in value) || !(value.blob instanceof Blob)) return null;
  if (!("fileId" in value) || typeof value.fileId !== "string") return null;
  if (!("savedAt" in value) || typeof value.savedAt !== "number") return null;
  if (!("scope" in value) || typeof value.scope !== "string") return null;
  return { blob: value.blob, fileId: value.fileId, savedAt: value.savedAt, scope: value.scope };
}

export async function listOfflineAudioIds(scope: string): Promise<ReadonlySet<string>> {
  const database = await openDatabase();
  const result: unknown = await requestResult(
    database.transaction(storeName, "readonly").objectStore(storeName).getAll(),
  );
  const records = Array.isArray(result)
    ? result.flatMap((value) => offlineRecord(value) ?? [])
    : [];
  return new Set(records.filter((record) => record.scope === scope).map(({ fileId }) => fileId));
}

export async function saveOfflineAudio(
  scope: string,
  fileId: string,
  sourceUrl: string,
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
      .put({ blob, fileId, key, savedAt: Date.now(), scope }),
  );
  releaseUrl(key);
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
  const key = recordKey(scope, fileId);
  const database = await openDatabase();
  await requestResult(
    database.transaction(storeName, "readwrite").objectStore(storeName).delete(key),
  );
  releaseUrl(key);
}
