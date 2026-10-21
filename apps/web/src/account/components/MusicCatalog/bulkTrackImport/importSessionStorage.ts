/**
 * Browser persistence for durable bulk practice-track import sessions.
 *
 * Only identifiers and manifest fingerprints are kept in sessionStorage,
 * scoped per Organization so one tenant can never resume another tenant's
 * import. Audio bytes are never stored here; resuming requires reselecting
 * the original files, which are verified by exact filename/size/lastModified
 * plus a SHA-256 digest recomputed in the browser.
 */

export interface ImportSessionManifestRow {
  readonly clientFileId: string;
  readonly durationSeconds: number | null;
  readonly fileName: string;
  readonly lastModifiedMs: number;
  readonly partKey: string;
  readonly pieceId: string;
  readonly sha256Hex: string;
  readonly sizeBytes: number;
}

export interface ImportSessionContext {
  readonly clientBatchKey: string;
  readonly host: string;
  readonly manifest: readonly ImportSessionManifestRow[];
  readonly savedAt: string;
  readonly sessionId: string;
}

const SESSION_STORAGE_KEY = "choir.track-import-session";

function currentHost(): string {
  return typeof window === "undefined" ? "" : window.location.host;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRaw(): unknown {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isManifestRow(value: unknown): value is ImportSessionManifestRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.clientFileId === "string" &&
    (typeof value.durationSeconds === "number" || value.durationSeconds === null) &&
    typeof value.fileName === "string" &&
    typeof value.lastModifiedMs === "number" &&
    typeof value.partKey === "string" &&
    typeof value.pieceId === "string" &&
    typeof value.sha256Hex === "string" &&
    typeof value.sizeBytes === "number"
  );
}

function isSessionContext(value: unknown): value is ImportSessionContext {
  if (!isRecord(value)) return false;
  return (
    typeof value.clientBatchKey === "string" &&
    typeof value.host === "string" &&
    Array.isArray(value.manifest) &&
    value.manifest.every(isManifestRow) &&
    typeof value.savedAt === "string" &&
    typeof value.sessionId === "string"
  );
}

/**
 * Reads the saved import context. The stored host must match the current
 * origin: sessionStorage is origin-bound and one canonical hostname resolves
 * to exactly one Organization, so a context saved under another host (or a
 * foreign session smuggled into storage) is never resumed here.
 */
export function readImportSessionContext(): ImportSessionContext | null {
  const parsed = readRaw();
  if (!isSessionContext(parsed)) return null;
  if (parsed.host !== currentHost()) return null;
  return parsed;
}

export function writeImportSessionContext(context: ImportSessionContext): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(context));
  } catch {
    // Private-mode storage failures must not break the import itself.
  }
}

export function clearImportSessionContext(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures on cleanup.
  }
}

export async function sha256HexOfFile(file: File | Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ReselectedFileMatch {
  readonly file: File;
  readonly manifest: ImportSessionManifestRow;
}

export interface ReselectionReport {
  readonly matched: readonly ReselectedFileMatch[];
  readonly mismatched: readonly { readonly fileName: string; readonly reason: string }[];
  readonly missing: readonly ImportSessionManifestRow[];
}

/**
 * Verifies reselected files against the stored manifest by exact filename,
 * size, and lastModified. SHA-256 equality is checked separately per file
 * (async) so a single mismatched byte cannot silently reuse another upload.
 */
export function matchReselectedFiles(
  manifest: readonly ImportSessionManifestRow[],
  files: readonly File[],
): ReselectionReport {
  const remaining = [...files];
  const matched: ReselectedFileMatch[] = [];
  const missing: ImportSessionManifestRow[] = [];
  for (const row of manifest) {
    const index = remaining.findIndex(
      (file) =>
        file.name === row.fileName &&
        file.size === row.sizeBytes &&
        file.lastModified === row.lastModifiedMs,
    );
    if (index === -1) {
      missing.push(row);
      continue;
    }
    const [file] = remaining.splice(index, 1);
    if (!file) {
      missing.push(row);
      continue;
    }
    matched.push({ file, manifest: row });
  }
  const mismatched = remaining.map((file) => ({
    fileName: file.name,
    reason: "This file does not match any remaining import row.",
  }));
  return { matched, mismatched, missing };
}

export async function verifyReselectedDigests(
  matched: readonly ReselectedFileMatch[],
): Promise<readonly { readonly clientFileId: string; readonly fileName: string }[]> {
  const failures: { clientFileId: string; fileName: string }[] = [];
  for (const { file, manifest } of matched) {
    const digest = await sha256HexOfFile(file);
    if (digest !== manifest.sha256Hex) {
      failures.push({ clientFileId: manifest.clientFileId, fileName: file.name });
    }
  }
  return failures;
}
