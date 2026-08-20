const MAX_ORGANIZATION_EXPORT_BYTES = 50 * 1024 * 1024;

export interface OrganizationExportArchive {
  readonly archive: string;
  readonly byteCount: number;
  readonly checksumSha256: string;
  readonly manifest: {
    readonly byteCount: number;
    readonly checksumSha256: string;
    readonly exportedAt: string;
    readonly exportVersion: 1;
    readonly fileCount: number;
    readonly organizationId: string;
    readonly recordCounts: Readonly<Record<string, number>>;
  };
}

interface ArchiveFile {
  readonly checksums: Readonly<Record<string, string>>;
  readonly contentType: string;
  readonly fileName: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly uploadedAt: string | null;
}

interface ExportSnapshotLike {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly records: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const input = new Uint8Array(value.byteLength);
  input.set(value);
  const digest = await crypto.subtle.digest("SHA-256", input.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildOrganizationExportArchive(input: {
  readonly files: readonly ArchiveFile[];
  readonly organizationId: string;
  readonly snapshot: ExportSnapshotLike;
  readonly exportedAt?: string;
}): Promise<OrganizationExportArchive> {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const payload = {
    exportVersion: 1 as const,
    exportedAt,
    files: input.files,
    metadata: input.snapshot.metadata,
    organizationId: input.organizationId,
    records: input.snapshot.records,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  if (payloadBytes.byteLength > MAX_ORGANIZATION_EXPORT_BYTES) {
    throw new Error("export_too_large");
  }
  const manifest = {
    byteCount: payloadBytes.byteLength,
    checksumSha256: await sha256Hex(payloadBytes),
    exportedAt,
    exportVersion: 1 as const,
    fileCount: input.files.length,
    organizationId: input.organizationId,
    recordCounts: Object.fromEntries(
      Object.entries(input.snapshot.records).map(([table, rows]) => [table, rows.length]),
    ),
  };
  return {
    archive: JSON.stringify({ manifest, payload }),
    byteCount: manifest.byteCount,
    checksumSha256: manifest.checksumSha256,
    manifest,
  };
}
