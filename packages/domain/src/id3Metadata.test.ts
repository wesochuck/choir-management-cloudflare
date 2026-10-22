import { describe, expect, it } from "vitest";
import { parseId3MetadataFromBytes, parseId3MetadataFromReader } from "./id3Metadata";

function makeSynchsafe(num: number): [number, number, number, number] {
  return [(num >> 21) & 0x7f, (num >> 14) & 0x7f, (num >> 7) & 0x7f, num & 0x7f];
}

function encodeFrame(id: string, text: string, encoding = 3): number[] {
  // encoding: 0 = iso-8859-1, 1 = utf-16 with BOM, 3 = utf-8
  const idBytes = Array.from(id).map((c) => c.charCodeAt(0));
  let textBytes: number[];
  if (encoding === 0) {
    textBytes = Array.from(text).map((c) => c.charCodeAt(0));
  } else if (encoding === 1) {
    // UTF-16LE with BOM
    textBytes = [0xff, 0xfe];
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      textBytes.push(code & 0xff, (code >> 8) & 0xff);
    }
  } else {
    // UTF-8
    textBytes = Array.from(new TextEncoder().encode(text));
  }
  const payload = [encoding, ...textBytes];
  const size = payload.length;
  const sizeBytes = [(size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff];
  const flags = [0x00, 0x00];
  return [...idBytes, ...sizeBytes, ...flags, ...payload];
}

describe("id3Metadata parser", () => {
  it("returns null fields for empty or tagless buffer", () => {
    const empty = new Uint8Array(100);
    const parsed = parseId3MetadataFromBytes(empty);
    expect(parsed).toEqual({
      album: null,
      artist: null,
      comment: null,
      composer: null,
      title: null,
      trackNumber: null,
    });
  });

  it("parses ID3v2.3 text frames (UTF-8, Latin1, UTF-16)", () => {
    const frames = [
      ...encodeFrame("TIT2", "Ave Maria", 3), // UTF-8
      ...encodeFrame("TPE1", "Choir Ensemble", 0), // Latin1
      ...encodeFrame("TCOM", "Franz Schubert", 1), // UTF-16LE
      ...encodeFrame("TALB", "Sacred Choral Works", 3),
      ...encodeFrame("TRCK", "03/12", 0),
    ];
    const tagSize = frames.length;
    const [b0, b1, b2, b3] = makeSynchsafe(tagSize);
    const header = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, b0, b1, b2, b3];
    const fullTag = new Uint8Array([...header, ...frames]);

    const parsed = parseId3MetadataFromBytes(fullTag);
    expect(parsed.title).toBe("Ave Maria");
    expect(parsed.artist).toBe("Choir Ensemble");
    expect(parsed.composer).toBe("Franz Schubert");
    expect(parsed.album).toBe("Sacred Choral Works");
    expect(parsed.trackNumber).toBe("03/12");
  });

  it("safely skips large APIC artwork frames without decoding", () => {
    // 500 KB fake artwork frame
    const artSizeBytes = 500 * 1024;
    const apicHeader = [
      0x41,
      0x50,
      0x49,
      0x43, // APIC
      (artSizeBytes >> 24) & 0xff,
      (artSizeBytes >> 16) & 0xff,
      (artSizeBytes >> 8) & 0xff,
      artSizeBytes & 0xff,
      0x00,
      0x00, // flags
    ];
    const apicPayload = new Uint8Array(artSizeBytes);
    const titleFrame = encodeFrame("TIT2", "Song With Artwork", 3);

    const frames = [...apicHeader, ...Array.from(apicPayload), ...titleFrame];
    const [b0, b1, b2, b3] = makeSynchsafe(frames.length);
    const header = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, b0, b1, b2, b3];
    const fullTag = new Uint8Array([...header, ...frames]);

    const parsed = parseId3MetadataFromBytes(fullTag);
    expect(parsed.title).toBe("Song With Artwork");
  });

  it("parses ID3v2.4 with synchsafe frame sizes", () => {
    const textBytes = Array.from(new TextEncoder().encode("Modern Choral Piece"));
    const payload = [3, ...textBytes];
    const [s0, s1, s2, s3] = makeSynchsafe(payload.length);
    const tit2Frame = [
      0x54,
      0x49,
      0x54,
      0x32, // TIT2
      s0,
      s1,
      s2,
      s3, // synchsafe size in v2.4
      0x00,
      0x00,
      ...payload,
    ];
    const [b0, b1, b2, b3] = makeSynchsafe(tit2Frame.length);
    const header = [0x49, 0x44, 0x33, 0x04, 0x00, 0x00, b0, b1, b2, b3];
    const fullTag = new Uint8Array([...header, ...tit2Frame]);

    const parsed = parseId3MetadataFromBytes(fullTag);
    expect(parsed.title).toBe("Modern Choral Piece");
  });

  it("handles ID3v2.2 without crashing", () => {
    // 3-byte header "TT2", 3-byte size
    const text = "Vintage Track";
    const payload = [0, ...Array.from(text).map((c) => c.charCodeAt(0))];
    const len = payload.length;
    const tt2Frame = [
      0x54,
      0x54,
      0x32,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
      ...payload,
    ];
    const [b0, b1, b2, b3] = makeSynchsafe(tt2Frame.length);
    const header = [0x49, 0x44, 0x33, 0x02, 0x00, 0x00, b0, b1, b2, b3];
    const fullTag = new Uint8Array([...header, ...tt2Frame]);

    const parsed = parseId3MetadataFromBytes(fullTag);
    expect(parsed.title).toBe("Vintage Track");
  });

  it("parses ID3v1 and ID3v1.1 fallback at the tail", () => {
    const v1 = new Uint8Array(128);
    v1[0] = 0x54; // 'T'
    v1[1] = 0x41; // 'A'
    v1[2] = 0x47; // 'G'
    // Title: 30 bytes at offset 3
    const titleBytes = new TextEncoder().encode("Classic V1 Song");
    v1.set(titleBytes, 3);
    // Artist: 30 bytes at offset 33
    const artistBytes = new TextEncoder().encode("Chamber Choir");
    v1.set(artistBytes, 33);
    // Album: 30 bytes at offset 63
    const albumBytes = new TextEncoder().encode("Winter Collection");
    v1.set(albumBytes, 63);
    // ID3v1.1: offset 125 = 0, offset 126 = track number
    v1[125] = 0;
    v1[126] = 7;

    const parsed = parseId3MetadataFromBytes(v1);
    expect(parsed.title).toBe("Classic V1 Song");
    expect(parsed.artist).toBe("Chamber Choir");
    expect(parsed.album).toBe("Winter Collection");
    expect(parsed.trackNumber).toBe("7");
  });

  it("merges ID3v2 and ID3v1 without overwriting ID3v2", () => {
    // ID3v2 has title only
    const v2Frame = encodeFrame("TIT2", "V2 Title", 3);
    const [b0, b1, b2, b3] = makeSynchsafe(v2Frame.length);
    const v2Header = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, b0, b1, b2, b3];

    // ID3v1 has title, artist, album
    const v1 = new Uint8Array(128);
    v1.set([0x54, 0x41, 0x47], 0);
    v1.set(new TextEncoder().encode("Old V1 Title"), 3);
    v1.set(new TextEncoder().encode("V1 Artist"), 33);

    const merged = new Uint8Array([...v2Header, ...v2Frame, ...Array.from(v1)]);
    const parsed = parseId3MetadataFromBytes(merged);

    expect(parsed.title).toBe("V2 Title"); // V2 preserved
    expect(parsed.artist).toBe("V1 Artist"); // V1 filled in
  });

  it("parses asynchronously via AsyncByteSliceReader with bounded chunks", async () => {
    const frames = [
      ...encodeFrame("TIT2", "Streamed Song", 3),
      ...encodeFrame("TCOM", "Streamed Composer", 3),
    ];
    const [b0, b1, b2, b3] = makeSynchsafe(frames.length);
    const fullTag = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, b0, b1, b2, b3, ...frames]);

    const slicesRequested: { offset: number; length: number }[] = [];
    const reader = (offset: number, length: number) => {
      slicesRequested.push({ offset, length });
      return Promise.resolve(fullTag.subarray(offset, offset + length));
    };

    const parsed = await parseId3MetadataFromReader(reader, fullTag.length, 512 * 1024);
    expect(parsed.title).toBe("Streamed Song");
    expect(parsed.composer).toBe("Streamed Composer");
    // Verify bounded reads: first read header (10 bytes), then tag body
    expect(slicesRequested[0]).toEqual({ offset: 0, length: 10 });
    expect(slicesRequested[1]?.offset).toBe(10);
  });

  it("handles malformed headers, invalid encoding, and control characters gracefully", () => {
    // Header claims huge size, but body is truncated
    const truncated = new Uint8Array([
      0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x7f, 0x7f, 0x7f, 0x7f, 0x01, 0x02,
    ]);
    expect(() => parseId3MetadataFromBytes(truncated)).not.toThrow();

    // Text with control characters
    const dirtyFrame = encodeFrame("TIT2", "Dirty\x00\x07Song\x1fTitle\t", 0);
    const [b0, b1, b2, b3] = makeSynchsafe(dirtyFrame.length);
    const dirtyTag = new Uint8Array([
      0x49,
      0x44,
      0x33,
      0x03,
      0x00,
      0x00,
      b0,
      b1,
      b2,
      b3,
      ...dirtyFrame,
    ]);
    const parsed = parseId3MetadataFromBytes(dirtyTag);
    expect(parsed.title).toBe("Dirty Song Title");
  });
});
