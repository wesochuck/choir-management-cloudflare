export interface ParsedId3Metadata {
  readonly album: string | null;
  readonly artist: string | null;
  readonly comment: string | null;
  readonly composer: string | null;
  readonly title: string | null;
  readonly trackNumber: string | null;
}

export type AsyncByteSliceReader = (offset: number, length: number) => Promise<Uint8Array>;

export const DEFAULT_ID3_MAX_BUDGET_BYTES = 512 * 1024; // 512 KiB

function getByte(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function cleanControlChars(raw: string): string {
  let result = "";
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      result += " ";
    } else {
      result += raw.charAt(i);
    }
  }
  return result;
}

function sanitizeString(raw: string | null | undefined, maxLen = 300): string | null {
  if (!raw) return null;
  const cleaned = cleanControlChars(raw.replaceAll("\0", ""))
    .normalize("NFC")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, maxLen);
}

function decodeText(bytes: Uint8Array, encodingByte: number): string {
  try {
    switch (encodingByte) {
      case 0: {
        return new TextDecoder("iso-8859-1").decode(bytes);
      }
      case 1: {
        // UTF-16 with BOM
        if (bytes.length < 2) return "";
        if (getByte(bytes, 0) === 0xfe && getByte(bytes, 1) === 0xff) {
          return new TextDecoder("utf-16be").decode(bytes.subarray(2));
        }
        if (getByte(bytes, 0) === 0xff && getByte(bytes, 1) === 0xfe) {
          return new TextDecoder("utf-16le").decode(bytes.subarray(2));
        }
        return new TextDecoder("utf-16le").decode(bytes);
      }
      case 2: {
        return new TextDecoder("utf-16be").decode(bytes);
      }
      case 3:
      default: {
        return new TextDecoder("utf-8").decode(bytes);
      }
    }
  } catch {
    return "";
  }
}

function readSynchsafe32(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
}

function readUint32BE(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 << 24) >>> 0) | (b1 << 16) | (b2 << 8) | b3;
}

function readUint24BE(b0: number, b1: number, b2: number): number {
  return (b0 << 16) | (b1 << 8) | b2;
}

function removeUnsynchronization(bytes: Uint8Array): Uint8Array {
  let needsUnsync = false;
  for (let i = 0; i < bytes.length - 1; i += 1) {
    if (getByte(bytes, i) === 0xff && getByte(bytes, i + 1) === 0x00) {
      needsUnsync = true;
      break;
    }
  }
  if (!needsUnsync) return bytes;

  const result: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const b = getByte(bytes, i);
    result.push(b);
    if (b === 0xff && i + 1 < bytes.length && getByte(bytes, i + 1) === 0x00) {
      i += 1;
    }
  }
  return new Uint8Array(result);
}

function parseId3v1(tailBytes: Uint8Array): Partial<ParsedId3Metadata> {
  if (tailBytes.length < 128) return {};
  if (
    getByte(tailBytes, 0) !== 0x54 ||
    getByte(tailBytes, 1) !== 0x41 ||
    getByte(tailBytes, 2) !== 0x47
  ) {
    return {};
  }
  const latin1 = new TextDecoder("iso-8859-1");
  const rawTitle = latin1.decode(tailBytes.subarray(3, 33));
  const rawArtist = latin1.decode(tailBytes.subarray(33, 63));
  const rawAlbum = latin1.decode(tailBytes.subarray(63, 93));

  let rawComment: string;
  let trackNumber: string | null = null;
  if (getByte(tailBytes, 125) === 0 && getByte(tailBytes, 126) !== 0) {
    rawComment = latin1.decode(tailBytes.subarray(97, 125));
    trackNumber = String(getByte(tailBytes, 126));
  } else {
    rawComment = latin1.decode(tailBytes.subarray(97, 127));
  }

  return {
    album: sanitizeString(rawAlbum),
    artist: sanitizeString(rawArtist),
    comment: sanitizeString(rawComment),
    title: sanitizeString(rawTitle),
    trackNumber: sanitizeString(trackNumber),
  };
}

function parseCommFrame(bytes: Uint8Array): string | null {
  if (bytes.length < 5) return null;
  const encoding = getByte(bytes, 0);
  let offset = 4;
  const step = encoding === 1 || encoding === 2 ? 2 : 1;
  while (offset < bytes.length) {
    if (step === 2) {
      if (
        offset + 1 < bytes.length &&
        getByte(bytes, offset) === 0 &&
        getByte(bytes, offset + 1) === 0
      ) {
        offset += 2;
        break;
      }
    } else if (getByte(bytes, offset) === 0) {
      offset += 1;
      break;
    }
    offset += step;
  }
  if (offset >= bytes.length) return null;
  return sanitizeString(decodeText(bytes.subarray(offset), encoding));
}

interface V2FramesResult {
  album: string | null;
  artist: string | null;
  comment: string | null;
  composer: string | null;
  title: string | null;
  trackNumber: string | null;
}

function applyV22Frame(frameId: string, frameData: Uint8Array, target: V2FramesResult) {
  if (frameId.startsWith("P")) return;
  const encoding = getByte(frameData, 0);
  const text = decodeText(frameData.subarray(1), encoding);

  switch (frameId) {
    case "TT2":
      target.title ??= sanitizeString(text);
      break;
    case "TP1":
      target.artist ??= sanitizeString(text);
      break;
    case "TCM":
      target.composer ??= sanitizeString(text);
      break;
    case "TAL":
      target.album ??= sanitizeString(text);
      break;
    case "TRK":
      target.trackNumber ??= sanitizeString(text);
      break;
    case "COM":
      target.comment ??= parseCommFrame(frameData);
      break;
  }
}

function parseId3v22Frames(body: Uint8Array, startOffset: number, target: V2FramesResult) {
  let offset = startOffset;
  while (offset + 6 <= body.length) {
    const b0 = getByte(body, offset);
    const b1 = getByte(body, offset + 1);
    const b2 = getByte(body, offset + 2);
    if (b0 === 0 && b1 === 0 && b2 === 0) break;
    const frameId = String.fromCharCode(b0, b1, b2);
    const frameSize = readUint24BE(
      getByte(body, offset + 3),
      getByte(body, offset + 4),
      getByte(body, offset + 5),
    );
    offset += 6;
    if (frameSize <= 0 || offset + frameSize > body.length) break;

    const frameData = body.subarray(offset, offset + frameSize);
    offset += frameSize;
    applyV22Frame(frameId, frameData, target);
  }
}

function applyTextFrame(frameId: string, text: string, target: V2FramesResult) {
  const sanitized = sanitizeString(text);
  switch (frameId) {
    case "TIT2":
      target.title ??= sanitized;
      break;
    case "TPE1":
      target.artist ??= sanitized;
      break;
    case "TCOM":
      target.composer ??= sanitized;
      break;
    case "TALB":
      target.album ??= sanitized;
      break;
    case "TRCK":
      target.trackNumber ??= sanitized;
      break;
  }
}

function applyV23And4Frame(frameId: string, frameData: Uint8Array, target: V2FramesResult) {
  if (frameId === "APIC" || frameId.startsWith("P")) return;

  if (frameId === "COMM") {
    target.comment ??= parseCommFrame(frameData);
    return;
  }

  if (frameId.startsWith("T") && frameData.length > 1) {
    const encoding = getByte(frameData, 0);
    const text = decodeText(frameData.subarray(1), encoding);
    applyTextFrame(frameId, text, target);
  }
}

function transformTextFrame(
  data: Uint8Array,
  version: number,
  flags: number,
  unsync: boolean,
): Uint8Array | null {
  if ((version === 3 && (flags & 0xe0) !== 0) || (version === 4 && (flags & 0x4c) !== 0))
    return null;
  if (version !== 4) return data;
  const decoded = unsync || (flags & 0x02) !== 0 ? removeUnsynchronization(data) : data;
  return (flags & 0x01) !== 0 ? decoded.subarray(4) : decoded;
}

function parseId3v23And4Frames(
  body: Uint8Array,
  startOffset: number,
  majorVersion: number,
  target: V2FramesResult,
  tagUnsync = false,
) {
  let offset = startOffset;
  while (offset + 10 <= body.length) {
    const b0 = getByte(body, offset);
    const b1 = getByte(body, offset + 1);
    const b2 = getByte(body, offset + 2);
    const b3 = getByte(body, offset + 3);
    if (b0 === 0 && b1 === 0 && b2 === 0 && b3 === 0) break;

    const frameId = String.fromCharCode(b0, b1, b2, b3);
    const b4 = getByte(body, offset + 4);
    const b5 = getByte(body, offset + 5);
    const b6 = getByte(body, offset + 6);
    const b7 = getByte(body, offset + 7);
    const frameSize =
      majorVersion === 4 ? readSynchsafe32(b4, b5, b6, b7) : readUint32BE(b4, b5, b6, b7);
    const formatFlags = getByte(body, offset + 9);
    offset += 10;
    if (frameSize <= 0 || offset + frameSize > body.length) break;

    let frameData = body.subarray(offset, offset + frameSize);
    offset += frameSize;
    const transformed = transformTextFrame(frameData, majorVersion, formatFlags, tagUnsync);
    if (!transformed) continue;
    frameData = transformed;
    applyV23And4Frame(frameId, frameData, target);
  }
}

function parseId3v2Tag(tagHeader: Uint8Array, tagBody: Uint8Array): Partial<ParsedId3Metadata> {
  const majorVersion = getByte(tagHeader, 3);
  const flags = getByte(tagHeader, 5);
  const unsync = (flags & 0x80) !== 0;
  const extendedHeader = (flags & 0x40) !== 0;

  const body = unsync && majorVersion < 4 ? removeUnsynchronization(tagBody) : tagBody;

  let offset = 0;
  if (extendedHeader && body.length >= 4) {
    const b0 = getByte(body, 0);
    const b1 = getByte(body, 1);
    const b2 = getByte(body, 2);
    const b3 = getByte(body, 3);
    if (majorVersion === 3) {
      offset += 4 + readUint32BE(b0, b1, b2, b3);
    } else if (majorVersion === 4) {
      offset += readSynchsafe32(b0, b1, b2, b3);
    }
  }

  const result: V2FramesResult = {
    album: null,
    artist: null,
    comment: null,
    composer: null,
    title: null,
    trackNumber: null,
  };

  if (majorVersion === 2) {
    parseId3v22Frames(body, offset, result);
  } else if (majorVersion === 3 || majorVersion === 4) {
    parseId3v23And4Frames(body, offset, majorVersion, result, unsync);
  }

  return result;
}

function combineMetadata(
  v2Meta: Partial<ParsedId3Metadata>,
  v1Meta: Partial<ParsedId3Metadata>,
): ParsedId3Metadata {
  return {
    album: v2Meta.album ?? v1Meta.album ?? null,
    artist: v2Meta.artist ?? v1Meta.artist ?? null,
    comment: v2Meta.comment ?? v1Meta.comment ?? null,
    composer: v2Meta.composer ?? null,
    title: v2Meta.title ?? v1Meta.title ?? null,
    trackNumber: v2Meta.trackNumber ?? v1Meta.trackNumber ?? null,
  };
}

function isId3v2Header(header: Uint8Array): boolean {
  if (header.length < 10) return false;
  if (getByte(header, 0) !== 0x49 || getByte(header, 1) !== 0x44 || getByte(header, 2) !== 0x33) {
    return false;
  }
  const v = getByte(header, 3);
  return (v === 2 || v === 3 || v === 4) && header.subarray(6, 10).every((byte) => byte < 128);
}

function supportsFrameTraversal(header: Uint8Array): boolean {
  return [3, 4].includes(getByte(header, 3)) && getByte(header, 5) === 0;
}

async function readV2Metadata(
  reader: AsyncByteSliceReader,
  header: Uint8Array,
  declaredTagSize: number,
  readLength: number,
): Promise<Partial<ParsedId3Metadata>> {
  if (!supportsFrameTraversal(header)) return parseId3v2Tag(header, await reader(10, readLength));
  const textFrames: number[] = [];
  let offset = 0;
  let consumed = 0;
  while (offset + 10 <= declaredTagSize && consumed + 10 <= readLength) {
    const frame = await reader(10 + offset, 10);
    consumed += 10;
    if (frame.length !== 10) break;
    const id = String.fromCharCode(...frame.subarray(0, 4));
    if (!/^[A-Z0-9]{4}$/u.test(id)) break;
    const size =
      getByte(header, 3) === 4
        ? readSynchsafe32(
            getByte(frame, 4),
            getByte(frame, 5),
            getByte(frame, 6),
            getByte(frame, 7),
          )
        : readUint32BE(getByte(frame, 4), getByte(frame, 5), getByte(frame, 6), getByte(frame, 7));
    if (size <= 0 || offset + 10 + size > declaredTagSize) break;
    if (
      ["TIT2", "TPE1", "TCOM", "TALB", "TRCK", "COMM"].includes(id) &&
      size <= readLength - consumed
    ) {
      const data = await reader(20 + offset, size);
      consumed += size;
      if (data.length !== size) break;
      textFrames.push(...frame);
      for (const byte of data) textFrames.push(byte);
    }
    offset += 10 + size;
  }
  return parseId3v2Tag(header, new Uint8Array(textFrames));
}

export async function parseId3MetadataFromReader(
  reader: AsyncByteSliceReader,
  fileSizeBytes: number,
  maxBudgetBytes = DEFAULT_ID3_MAX_BUDGET_BYTES,
): Promise<ParsedId3Metadata> {
  let v2Meta: Partial<ParsedId3Metadata> = {};
  try {
    if (fileSizeBytes >= 10) {
      const header = await reader(0, 10);
      if (isId3v2Header(header)) {
        const declaredTagSize = readSynchsafe32(
          getByte(header, 6),
          getByte(header, 7),
          getByte(header, 8),
          getByte(header, 9),
        );
        if (declaredTagSize > 0 && declaredTagSize <= fileSizeBytes - 10) {
          const readLength = Math.min(
            declaredTagSize,
            Math.max(0, Math.min(maxBudgetBytes, DEFAULT_ID3_MAX_BUDGET_BYTES)),
          );
          v2Meta = await readV2Metadata(reader, header, declaredTagSize, readLength);
        }
      }
    }
  } catch {
    v2Meta = {};
  }

  let v1Meta: Partial<ParsedId3Metadata> = {};
  const needsV1 = !v2Meta.title || !v2Meta.artist || !v2Meta.album || !v2Meta.trackNumber;
  if (needsV1 && fileSizeBytes >= 128) {
    try {
      const tail = await reader(fileSizeBytes - 128, 128);
      v1Meta = parseId3v1(tail);
    } catch {
      v1Meta = {};
    }
  }

  return combineMetadata(v2Meta, v1Meta);
}

export function parseId3MetadataFromBytes(
  bytes: Uint8Array,
  maxBudgetBytes = DEFAULT_ID3_MAX_BUDGET_BYTES,
): ParsedId3Metadata {
  let v2Meta: Partial<ParsedId3Metadata> = {};
  if (isId3v2Header(bytes)) {
    const declaredTagSize = readSynchsafe32(
      getByte(bytes, 6),
      getByte(bytes, 7),
      getByte(bytes, 8),
      getByte(bytes, 9),
    );
    if (declaredTagSize > 0) {
      const readLength = Math.min(
        declaredTagSize,
        Math.max(0, Math.min(maxBudgetBytes, DEFAULT_ID3_MAX_BUDGET_BYTES)),
      );
      const body = bytes.subarray(10, Math.min(bytes.length, 10 + readLength));
      v2Meta = parseId3v2Tag(bytes.subarray(0, 10), body);
    }
  }

  let v1Meta: Partial<ParsedId3Metadata> = {};
  const needsV1 = !v2Meta.title || !v2Meta.artist || !v2Meta.album || !v2Meta.trackNumber;
  if (needsV1 && bytes.length >= 128) {
    v1Meta = parseId3v1(bytes.subarray(bytes.length - 128));
  }

  return combineMetadata(v2Meta, v1Meta);
}
