import { createHash } from "node:crypto";

export const MAX_ORGANIZATION_EXPORT_BYTES = 50 * 1024 * 1024;

export interface OrganizationExportArchive {
  readonly archive: ReadableStream<Uint8Array>;
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

export interface ArchiveFile {
  readonly checksums: Readonly<Record<string, string>>;
  readonly contentType: string;
  readonly fileName: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly uploadedAt: string | null;
}

export interface ExportSnapshotLike {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly records: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}

function* generatePayloadJsonChunks(input: {
  readonly files: readonly ArchiveFile[];
  readonly organizationId: string;
  readonly snapshot: ExportSnapshotLike;
  readonly exportedAt: string;
}): Generator<string, void, undefined> {
  yield '{"exportVersion":1,"exportedAt":';
  yield JSON.stringify(input.exportedAt);
  yield ',"files":[';
  for (let i = 0; i < input.files.length; i++) {
    if (i > 0) yield ",";
    yield JSON.stringify(input.files[i]);
  }
  yield '],"metadata":';
  yield JSON.stringify(input.snapshot.metadata);
  yield ',"organizationId":';
  yield JSON.stringify(input.organizationId);
  yield ',"records":{';

  const entries = Object.entries(input.snapshot.records);
  for (let t = 0; t < entries.length; t++) {
    const entry = entries[t];
    if (!entry) continue;
    const [table, rows] = entry;
    if (t > 0) yield ",";
    yield `${JSON.stringify(table)}:[`;
    for (let r = 0; r < rows.length; r++) {
      if (r > 0) yield ",";
      yield JSON.stringify(rows[r]);
    }
    yield "]";
  }
  yield "}}";
}

function computePayloadManifest(input: {
  readonly files: readonly ArchiveFile[];
  readonly organizationId: string;
  readonly snapshot: ExportSnapshotLike;
  readonly exportedAt: string;
}): {
  readonly byteCount: number;
  readonly checksumSha256: string;
} {
  const hash = createHash("sha256");
  const encoder = new TextEncoder();
  let byteCount = 0;
  for (const chunk of generatePayloadJsonChunks(input)) {
    const chunkBytes = encoder.encode(chunk);
    byteCount += chunkBytes.byteLength;
    if (byteCount > MAX_ORGANIZATION_EXPORT_BYTES) {
      throw new Error("export_too_large");
    }
    hash.update(chunkBytes);
  }
  return {
    byteCount,
    checksumSha256: hash.digest("hex"),
  };
}

function createOrganizationExportArchiveStream(
  manifest: OrganizationExportArchive["manifest"],
  input: {
    readonly files: readonly ArchiveFile[];
    readonly organizationId: string;
    readonly snapshot: ExportSnapshotLike;
    readonly exportedAt: string;
  },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const manifestPrefix = encoder.encode(`{"manifest":${JSON.stringify(manifest)},"payload":`);
  const archiveSuffix = new Uint8Array([125]); // '}'

  const generator = generatePayloadJsonChunks(input);
  let prefixSent = false;
  let suffixSent = false;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!prefixSent) {
        controller.enqueue(manifestPrefix);
        prefixSent = true;
        return;
      }
      const next = generator.next();
      if (!next.done) {
        controller.enqueue(encoder.encode(next.value));
        return;
      }
      if (!suffixSent) {
        controller.enqueue(archiveSuffix);
        suffixSent = true;
        controller.close();
      }
    },
  });
}

export async function readArchiveStreamAsText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

export async function buildOrganizationExportArchive(input: {
  readonly files: readonly ArchiveFile[];
  readonly organizationId: string;
  readonly snapshot: ExportSnapshotLike;
  readonly exportedAt?: string;
}): Promise<OrganizationExportArchive> {
  await Promise.resolve();
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const payloadInput = {
    exportedAt,
    files: input.files,
    organizationId: input.organizationId,
    snapshot: input.snapshot,
  };
  const payloadManifest = computePayloadManifest(payloadInput);

  const manifest = {
    byteCount: payloadManifest.byteCount,
    checksumSha256: payloadManifest.checksumSha256,
    exportedAt,
    exportVersion: 1 as const,
    fileCount: input.files.length,
    organizationId: input.organizationId,
    recordCounts: Object.fromEntries(
      Object.entries(input.snapshot.records).map(([table, rows]) => [table, rows.length]),
    ),
  };

  const rawStream = createOrganizationExportArchiveStream(manifest, payloadInput);
  const manifestPrefixBytes = new TextEncoder().encode(
    `{"manifest":${JSON.stringify(manifest)},"payload":`,
  ).byteLength;
  const totalArchiveBytes = manifestPrefixBytes + manifest.byteCount + 1; // +1 for trailing '}'

  const archiveStream =
    typeof FixedLengthStream !== "undefined"
      ? rawStream.pipeThrough(new FixedLengthStream(totalArchiveBytes))
      : rawStream;

  return {
    archive: archiveStream,
    byteCount: manifest.byteCount,
    checksumSha256: manifest.checksumSha256,
    manifest,
  };
}
