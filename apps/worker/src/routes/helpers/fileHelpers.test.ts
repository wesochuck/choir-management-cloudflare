import { describe, expect, it } from "vitest";

import { ALLOWED_ARTWORK_MIME_TYPES, sniffArtworkMimeType } from "./fileHelpers";

describe("fileHelpers artwork sniffing", () => {
  it("allows only pdf, png, and jpeg in ALLOWED_ARTWORK_MIME_TYPES", () => {
    expect(ALLOWED_ARTWORK_MIME_TYPES.has("application/pdf")).toBe(true);
    expect(ALLOWED_ARTWORK_MIME_TYPES.has("image/png")).toBe(true);
    expect(ALLOWED_ARTWORK_MIME_TYPES.has("image/jpeg")).toBe(true);
    expect(ALLOWED_ARTWORK_MIME_TYPES.has("image/svg+xml")).toBe(false);
    expect(ALLOWED_ARTWORK_MIME_TYPES.has("text/html")).toBe(false);
    expect(ALLOWED_ARTWORK_MIME_TYPES.has("image/gif")).toBe(false);
  });

  it("identifies PDF magic bytes (%PDF-)", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    expect(sniffArtworkMimeType(bytes)).toBe("application/pdf");
  });

  it("identifies PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(sniffArtworkMimeType(bytes)).toBe("image/png");
  });

  it("identifies JPEG SOI magic bytes (FF D8 FF)", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffArtworkMimeType(bytes)).toBe("image/jpeg");
  });

  it("rejects unknown or invalid byte sequences", () => {
    const htmlBytes = new TextEncoder().encode("<!DOCTYPE html><html>");
    expect(sniffArtworkMimeType(htmlBytes)).toBeNull();

    const svgBytes = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>");
    expect(sniffArtworkMimeType(svgBytes)).toBeNull();

    const emptyBytes = new Uint8Array([]);
    expect(sniffArtworkMimeType(emptyBytes)).toBeNull();
  });
});
