import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearImportSessionContext,
  matchReselectedFiles,
  readImportSessionContext,
  sha256HexOfFile,
  verifyReselectedDigests,
  writeImportSessionContext,
  type ImportSessionContext,
} from "./importSessionStorage";

function manifestRow(overrides: Partial<ImportSessionContext["manifest"][number]> = {}) {
  return {
    clientFileId: "file-1",
    durationSeconds: 180,
    fileName: "01 Hallelujah Chorus - Soprano.mp3",
    lastModifiedMs: 1_700_000_000_000,
    partKey: "soprano",
    pieceId: "11111111-1111-4111-8111-111111111111",
    sha256Hex: "a".repeat(64),
    sizeBytes: 17,
    ...overrides,
  };
}

function sessionContext(overrides: Partial<ImportSessionContext> = {}): ImportSessionContext {
  return {
    clientBatchKey: "batch-1",
    host: window.location.host,
    manifest: [manifestRow()],
    savedAt: "2026-10-21T00:00:00.000Z",
    sessionId: "session-1",
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("import session persistence", () => {
  it("round-trips a saved context", () => {
    writeImportSessionContext(sessionContext());
    expect(readImportSessionContext()).toEqual(sessionContext());
  });

  it("clears the saved context", () => {
    writeImportSessionContext(sessionContext());
    clearImportSessionContext();
    expect(readImportSessionContext()).toBeNull();
  });

  it("refuses contexts saved under a different host", () => {
    writeImportSessionContext(sessionContext({ host: "other-choir.example" }));
    expect(readImportSessionContext()).toBeNull();
  });

  it("refuses malformed stored payloads", () => {
    sessionStorage.setItem("choir.track-import-session", JSON.stringify({ bogus: true }));
    expect(readImportSessionContext()).toBeNull();
    sessionStorage.setItem("choir.track-import-session", "not-json{{{");
    expect(readImportSessionContext()).toBeNull();
  });
});

describe("reselect verification", () => {
  it("hashes file bytes deterministically", async () => {
    const file = new File(["dummy audio bytes"], "track.mp3", { type: "audio/mpeg" });
    const first = await sha256HexOfFile(file);
    const second = await sha256HexOfFile(file);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches reselected files by exact name, size, and timestamp", async () => {
    const expected = manifestRow({ sizeBytes: 17, lastModifiedMs: 1_700_000_000_000 });
    const digest = await sha256HexOfFile(new File(["dummy audio bytes"], "track.mp3"));
    const manifest = [{ ...expected, sha256Hex: digest }];
    const file = new File(["dummy audio bytes"], expected.fileName, { type: "audio/mpeg" });
    Object.defineProperty(file, "lastModified", { value: expected.lastModifiedMs });
    const report = matchReselectedFiles(manifest, [file]);
    expect(report.missing).toEqual([]);
    expect(report.mismatched).toEqual([]);
    expect(report.matched).toHaveLength(1);
    expect(await verifyReselectedDigests(report.matched)).toEqual([]);
  });

  it("flags renamed, resized, and byte-changed files", async () => {
    const digest = await sha256HexOfFile(new File(["dummy audio bytes"], "track.mp3"));
    const manifest = [{ ...manifestRow(), sha256Hex: digest }];
    const renamed = new File(["dummy audio bytes"], "other.mp3", { type: "audio/mpeg" });
    const resized = new File(["different bytes here"], manifest[0]?.fileName ?? "x", {
      type: "audio/mpeg",
    });
    const report = matchReselectedFiles(manifest, [renamed, resized]);
    expect(report.missing).toHaveLength(1);
    expect(report.mismatched.map((entry) => entry.fileName)).toEqual(
      expect.arrayContaining(["other.mp3"]),
    );
  });

  it("rejects byte-changed files that keep the same name and size", async () => {
    const original = new File(["aaaaaaaaaaaaaaaaa"], "track.mp3", { type: "audio/mpeg" });
    const digest = await sha256HexOfFile(original);
    const manifest = [
      {
        ...manifestRow(),
        fileName: "track.mp3",
        lastModifiedMs: original.lastModified,
        sha256Hex: digest,
        sizeBytes: original.size,
      },
    ];
    const tampered = new File(["bbbbbbbbbbbbbbbbb"], "track.mp3", { type: "audio/mpeg" });
    Object.defineProperty(tampered, "lastModified", { value: original.lastModified });
    const report = matchReselectedFiles(manifest, [tampered]);
    expect(report.matched).toHaveLength(1);
    const failures = await verifyReselectedDigests(report.matched);
    expect(failures).toEqual([{ clientFileId: "file-1", fileName: "track.mp3" }]);
  });
});
