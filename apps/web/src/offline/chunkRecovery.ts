import { lazy, type LazyExoticComponent } from "react";

const CHUNK_RELOAD_STORAGE_PREFIX = "choir:chunk-reload:";
const CHUNK_RELOAD_COOLDOWN_MS = 15_000;

const CHUNK_ERROR_PATTERNS = [
  "failed to fetch dynamically imported module",
  "importing a module script failed",
  "error loading dynamically imported module",
  "unable to preload css",
  "failed to load module script",
];

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "ChunkLoadError") {
    return true;
  }
  const message = error.message.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export interface ChunkRecoveryOptions {
  readonly now?: number;
  readonly online?: boolean;
  readonly pathname?: string;
  readonly reload?: () => void;
  readonly storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

function resolveSessionStorage(
  override?: Pick<Storage, "getItem" | "setItem"> | null,
): Pick<Storage, "getItem" | "setItem"> | null {
  if (override !== undefined) {
    return override;
  }
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function isBrowserOnline(override?: boolean): boolean {
  if (override !== undefined) {
    return override;
  }
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function recordReloadAttempt(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  pathname: string,
  now: number,
): boolean {
  if (!storage) {
    return true;
  }
  const storageKey = `${CHUNK_RELOAD_STORAGE_PREFIX}${pathname}`;
  try {
    const previousRaw = storage.getItem(storageKey);
    const previousTimestamp = previousRaw ? Number.parseInt(previousRaw, 10) : Number.NaN;
    if (Number.isFinite(previousTimestamp) && now - previousTimestamp < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(storageKey, String(now));
    return true;
  } catch {
    return false;
  }
}

export function attemptChunkRecoveryReload(options: ChunkRecoveryOptions = {}): boolean {
  if (typeof window === "undefined" && !options.reload) {
    return false;
  }
  if (!isBrowserOnline(options.online)) {
    return false;
  }

  const pathname =
    options.pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  const now = options.now ?? Date.now();
  const storage = resolveSessionStorage(options.storage);

  if (!recordReloadAttempt(storage, pathname, now)) {
    return false;
  }

  const triggerReload =
    options.reload ??
    (() => {
      window.location.reload();
    });
  triggerReload();
  return true;
}

export async function importWithRetry<T>(
  importer: () => Promise<T>,
  options?: ChunkRecoveryOptions,
): Promise<T> {
  try {
    return await importer();
  } catch (error: unknown) {
    if (isChunkLoadError(error) && attemptChunkRecoveryReload(options)) {
      return new Promise<T>(() => {
        // Keep callers suspended while the browser reloads the fresh document shell.
      });
    }
    throw error;
  }
}

type LazyComponentConstraint = Parameters<typeof lazy>[0] extends () => Promise<{
  default: infer C;
}>
  ? C
  : never;

export function lazyWithRetry<T extends LazyComponentConstraint>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(importer));
}

export function installChunkErrorHandling(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.addEventListener("vite:preloadError", (event) => {
    if (attemptChunkRecoveryReload()) {
      event.preventDefault();
    }
  });
}
