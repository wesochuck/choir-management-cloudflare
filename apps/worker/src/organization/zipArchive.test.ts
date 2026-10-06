import { describe, expect, it } from "vitest";
import { computeCrc32, createZipArchive } from "./zipArchive";

describe("zipArchive", () => {
  it("computes standard CRC32 correctly", () => {
    const encoder = new TextEncoder();
    expect(computeCrc32(encoder.encode("123456789"))).toBe(0xcbf43926);
    expect(computeCrc32(new Uint8Array(0))).toBe(0);
  });

  it("builds a valid ZIP archive containing multiple files", () => {
    const encoder = new TextEncoder();
    const files = [
      {
        data: encoder.encode("PDF Content 1"),
        fileName: "Piece 1 - Choral Score.pdf",
      },
      {
        data: encoder.encode("PDF Content 2"),
        fileName: "Piece 2 - Tenor 1.pdf",
      },
    ];

    const zipBytes = createZipArchive(files);
    expect(zipBytes.byteLength).toBeGreaterThan(100);

    // Verify local header signature (0x04034b50)
    const view = new DataView(zipBytes);
    expect(view.getUint32(0, true)).toBe(0x04034b50);

    // Verify filenames exist in archive
    const text = new TextDecoder().decode(zipBytes);
    expect(text).toContain("Piece 1 - Choral Score.pdf");
    expect(text).toContain("Piece 2 - Tenor 1.pdf");
    expect(text).toContain("PDF Content 1");
    expect(text).toContain("PDF Content 2");
  });

  it("handles empty files list", () => {
    const zipBytes = createZipArchive([]);
    expect(zipBytes.byteLength).toBe(22); // Only EOCD record
    const view = new DataView(zipBytes);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
  });
});
