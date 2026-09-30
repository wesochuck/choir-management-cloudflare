import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildOrganizationExportArchive,
  MAX_ORGANIZATION_EXPORT_BYTES,
  readArchiveStreamAsText,
} from "./organizationExport";

function independentSha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function parseArchiveManifestAndPayload(jsonText: string): {
  readonly manifest: unknown;
  readonly payload: unknown;
} {
  const value: unknown = JSON.parse(jsonText);
  if (typeof value === "object" && value !== null && "manifest" in value && "payload" in value) {
    return {
      manifest: value.manifest,
      payload: value.payload,
    };
  }
  throw new Error("Invalid archive JSON structure");
}

function parseArchivePayload(jsonText: string): unknown {
  return parseArchiveManifestAndPayload(jsonText).payload;
}

describe("organization export archive streaming and hashing", () => {
  it("matches legacy single-pass JSON serialization byte-for-byte on fixed-clock fixture", async () => {
    const fixedTime = "2026-07-21T12:00:00.000Z";
    const files = [
      {
        checksums: { md5: "abc123", sha256: "def456" },
        contentType: "audio/mp3",
        fileName: "rehearsal.mp3",
        id: "file-1",
        sizeBytes: 1024,
        storageKey: "organizations/org-test/private/file-1",
        uploadedAt: "2026-07-20T10:00:00.000Z",
      },
    ];
    const snapshot = {
      metadata: { choirName: "Test Ensemble", version: 1 },
      records: {
        events: [
          { date: "2026-08-01", id: "ev-1", title: "Summer Concert 🎵" },
          { date: "2026-08-08", id: "ev-2", title: "Rehearsal with Chœur d'enfants" },
        ],
        profiles: [
          { email: "singer1@example.com", id: "prof-1", name: "Alice Wonderland" },
          { email: "singer2@example.com", id: "prof-2", name: "Bob Martin" },
        ],
      },
    };

    // Expected legacy payload & archive construction
    const legacyPayload = {
      exportVersion: 1 as const,
      exportedAt: fixedTime,
      files,
      metadata: snapshot.metadata,
      organizationId: "org-test",
      records: snapshot.records,
    };
    const legacyPayloadJson = JSON.stringify(legacyPayload);
    const legacyPayloadBytes = new TextEncoder().encode(legacyPayloadJson);
    const legacyChecksum = independentSha256Hex(legacyPayloadBytes);
    const legacyManifest = {
      byteCount: legacyPayloadBytes.byteLength,
      checksumSha256: legacyChecksum,
      exportedAt: fixedTime,
      exportVersion: 1 as const,
      fileCount: files.length,
      organizationId: "org-test",
      recordCounts: {
        events: 2,
        profiles: 2,
      },
    };
    const legacyArchiveJson = JSON.stringify({ manifest: legacyManifest, payload: legacyPayload });

    const exportArchive = await buildOrganizationExportArchive({
      exportedAt: fixedTime,
      files,
      organizationId: "org-test",
      snapshot,
    });

    expect(exportArchive.byteCount).toBe(legacyPayloadBytes.byteLength);
    expect(exportArchive.checksumSha256).toBe(legacyChecksum);
    expect(exportArchive.manifest).toEqual(legacyManifest);

    const streamedArchiveJson = await readArchiveStreamAsText(exportArchive.archive);
    expect(streamedArchiveJson).toBe(legacyArchiveJson);

    // Verify the parsed archive content matches qualification expectations
    const parsed = parseArchiveManifestAndPayload(streamedArchiveJson);
    expect(parsed.manifest).toEqual(legacyManifest);
    expect(parsed.payload).toEqual(legacyPayload);

    // Verify independent SHA-256 of parsed payload matches manifest
    const parsedPayloadBytes = new TextEncoder().encode(JSON.stringify(parsed.payload));
    expect(parsedPayloadBytes.byteLength).toBe(exportArchive.byteCount);
    expect(independentSha256Hex(parsedPayloadBytes)).toBe(exportArchive.checksumSha256);
  });

  it("handles empty exports with zero files and empty tables", async () => {
    const fixedTime = "2026-07-21T12:00:00.000Z";
    const exportArchive = await buildOrganizationExportArchive({
      exportedAt: fixedTime,
      files: [],
      organizationId: "org-empty",
      snapshot: {
        metadata: {},
        records: {
          attendance: [],
          profiles: [],
        },
      },
    });

    expect(exportArchive.manifest.fileCount).toBe(0);
    expect(exportArchive.manifest.recordCounts).toEqual({ attendance: 0, profiles: 0 });

    const archiveText = await readArchiveStreamAsText(exportArchive.archive);
    const payload = parseArchivePayload(archiveText);
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    expect(payloadBytes.byteLength).toBe(exportArchive.byteCount);
    expect(independentSha256Hex(payloadBytes)).toBe(exportArchive.checksumSha256);
  });

  it("correctly counts UTF-8 multibyte byte length and matches independent checksum", async () => {
    const multibyteRow = {
      description: "Chinese: 合唱团, Cyrillic: хор, Arabic: كورس, Emojis: 🎶🎼🎭🎤",
      id: "row-multibyte",
    };
    const exportArchive = await buildOrganizationExportArchive({
      files: [],
      organizationId: "org-utf8",
      snapshot: {
        metadata: { greeting: "Bonjour le monde! 🌍" },
        records: {
          texts: [multibyteRow],
        },
      },
    });

    const archiveText = await readArchiveStreamAsText(exportArchive.archive);
    const payload = parseArchivePayload(archiveText);
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

    expect(payloadBytes.byteLength).toBe(exportArchive.byteCount);
    expect(independentSha256Hex(payloadBytes)).toBe(exportArchive.checksumSha256);
  });

  it("fails predictably before uncontrolled memory allocation when payload exceeds 50 MiB limit", async () => {
    // Create a snapshot whose records exceed MAX_ORGANIZATION_EXPORT_BYTES (50 MiB)
    // 52 chunks of 1 MiB strings
    const largeChunk = "X".repeat(1024 * 1024);
    const largeRows = Array.from({ length: 51 }, (_, i) => ({
      data: largeChunk,
      id: `row-${String(i)}`,
    }));

    await expect(
      buildOrganizationExportArchive({
        files: [],
        organizationId: "org-oversized",
        snapshot: {
          metadata: {},
          records: {
            blobs: largeRows,
          },
        },
      }),
    ).rejects.toThrow("export_too_large");
  });

  it("succeeds for payloads just under the 50 MiB allowance without running out of memory", async () => {
    // 2 chunks of 1 MiB strings (~2 MiB total, well within limits but large enough to test multi-chunk streaming)
    const chunkSize = 1024 * 1024;
    const chunk = "A".repeat(chunkSize);
    const rows = [
      { data: chunk, id: "row-1" },
      { data: chunk, id: "row-2" },
    ];

    const exportArchive = await buildOrganizationExportArchive({
      files: [],
      organizationId: "org-near-limit",
      snapshot: {
        metadata: {},
        records: {
          blobs: rows,
        },
      },
    });

    expect(exportArchive.byteCount).toBeGreaterThan(2 * chunkSize);
    expect(exportArchive.byteCount).toBeLessThan(MAX_ORGANIZATION_EXPORT_BYTES);

    const archiveText = await readArchiveStreamAsText(exportArchive.archive);
    const payload = parseArchivePayload(archiveText);
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    expect(payloadBytes.byteLength).toBe(exportArchive.byteCount);
    expect(independentSha256Hex(payloadBytes)).toBe(exportArchive.checksumSha256);
  });
});
