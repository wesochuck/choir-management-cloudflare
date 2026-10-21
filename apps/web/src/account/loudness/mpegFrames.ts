/** Strict frame-boundary validation. No sync hunting through corrupt payloads. */
export class Mp3AnalysisError extends Error {
  constructor(readonly reasonCode: "invalid_audio" | "unsupported_format" | "processing_limit") {
    super(reasonCode);
  }
}
export interface MpegLayout {
  readonly channels: 1 | 2;
  readonly sampleRate: number;
}
function isTag(bytes: Uint8Array, offset: number, tag: readonly number[]): boolean {
  return tag.every((value, index) => bytes[offset + index] === value);
}
function id3Size(bytes: Uint8Array): number {
  if (!isTag(bytes, 0, [73, 68, 51])) return 0;
  if (![2, 3, 4].includes(bytes[3] ?? 0) || [6, 7, 8, 9].some((i) => (bytes[i] ?? 128) >= 128))
    throw new Mp3AnalysisError("invalid_audio");
  const size =
    10 +
    ((bytes[6] ?? 0) * 2097152 +
      (bytes[7] ?? 0) * 16384 +
      (bytes[8] ?? 0) * 128 +
      (bytes[9] ?? 0)) +
    (bytes[3] === 4 && (bytes[5] ?? 0) & 16 ? 10 : 0);
  if (size > 1024 * 1024) throw new Mp3AnalysisError("processing_limit");
  return size;
}
function frameHeader(bytes: Uint8Array, offset: number) {
  const a = bytes.at(offset);
  const b = bytes[offset + 1] ?? 0;
  const c = bytes[offset + 2] ?? 0;
  const d = bytes[offset + 3] ?? 0;
  const version = (b >> 3) & 3;
  const layer = (b >> 1) & 3;
  const bitrateIndex = c >> 4;
  const rateIndex = (c >> 2) & 3;
  if (
    a !== 255 ||
    (b & 224) !== 224 ||
    version === 1 ||
    layer !== 1 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    rateIndex === 3
  )
    throw new Mp3AnalysisError("invalid_audio");
  // v1 deliberately validates only MPEG1 Layer III at 32/44.1/48 kHz.
  if (version !== 3) throw new Mp3AnalysisError("unsupported_format");
  const sampleRate = [44100, 48000, 32000][rateIndex] ?? 0;
  const bitrate =
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex] ?? 0;
  const channels: 1 | 2 = d >> 6 === 3 ? 1 : 2;
  return {
    channels,
    sampleRate,
    length: Math.floor((144000 * bitrate) / sampleRate) + ((c >> 1) & 1),
  };
}
export class MpegFrameReader {
  private pending = new Uint8Array(0);
  private skip = 0;
  private initial = true;
  private frames = 0;
  layout: MpegLayout | null = null;
  private initialOffset(merged: Uint8Array): number {
    this.initial = false;
    const size = id3Size(merged);
    const offset = Math.min(size, merged.length);
    this.skip = size - offset;
    return offset;
  }
  private acceptLayout(next: MpegLayout): void {
    if (
      this.layout &&
      (this.layout.channels !== next.channels || this.layout.sampleRate !== next.sampleRate)
    )
      throw new Mp3AnalysisError("unsupported_format");
    this.layout = next;
  }
  push(chunk: Uint8Array): void {
    const skipped = Math.min(this.skip, chunk.length);
    this.skip -= skipped;
    chunk = chunk.subarray(skipped);
    if (!chunk.length) return;
    const merged = new Uint8Array(this.pending.length + chunk.length);
    merged.set(this.pending);
    merged.set(chunk, this.pending.length);
    if (this.initial && merged.length < 10) {
      this.pending = merged;
      return;
    }
    let offset = this.initial ? this.initialOffset(merged) : 0;
    while (offset + 4 <= merged.length) {
      if (isTag(merged, offset, [84, 65, 71])) break; // ID3v1 tail only; finish validates length.
      const header = frameHeader(merged, offset);
      this.acceptLayout(header);
      if (offset + header.length > merged.length) break;
      offset += header.length;
      this.frames++;
    }
    this.pending = merged.slice(offset);
    if (this.pending.length > 65536) throw new Mp3AnalysisError("invalid_audio");
  }
  finish(): MpegLayout {
    const validTail =
      this.pending.length === 0 ||
      (this.pending.length === 128 && isTag(this.pending, 0, [84, 65, 71]));
    if (this.skip || this.frames < 2 || !this.layout || !validTail)
      throw new Mp3AnalysisError("invalid_audio");
    return this.layout;
  }
}
