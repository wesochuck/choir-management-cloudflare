const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const tableIndex = (crc ^ byte) & 0xff;
    const tableVal = CRC_TABLE[tableIndex] ?? 0;
    crc = (tableVal ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFileInput {
  readonly data: Uint8Array;
  readonly fileName: string;
}

function dosDateTime(date: Date): { readonly time: number; readonly date: number } {
  const year = Math.max(1980, date.getFullYear()) - 1980;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosDate = ((year & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  return { date: dosDate, time: dosTime };
}

export function createZipArchive(files: readonly ZipFileInput[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const now = new Date();
  const { date: dosDate, time: dosTime } = dosDateTime(now);

  interface EntryInfo {
    readonly crc32: number;
    readonly data: Uint8Array;
    readonly encodedName: Uint8Array;
    readonly localHeaderOffset: number;
    readonly size: number;
  }

  const entries: EntryInfo[] = [];
  const localChunks: Uint8Array[] = [];
  let currentOffset = 0;

  for (const file of files) {
    const encodedName = encoder.encode(file.fileName);
    const size = file.data.byteLength;
    const crc32 = computeCrc32(file.data);

    const localHeader = new Uint8Array(30 + encodedName.length);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true); // Version needed to extract (2.0)
    view.setUint16(6, 0x0800, true); // Bit flag: UTF-8 filename (bit 11)
    view.setUint16(8, 0, true); // Compression method: 0 (Store)
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc32, true);
    view.setUint32(18, size, true); // Compressed size
    view.setUint32(22, size, true); // Uncompressed size
    view.setUint16(26, encodedName.length, true);
    view.setUint16(28, 0, true); // Extra field length

    localHeader.set(encodedName, 30);

    const localHeaderOffset = currentOffset;
    localChunks.push(localHeader, file.data);
    currentOffset += localHeader.length + file.data.byteLength;

    entries.push({
      crc32,
      data: file.data,
      encodedName,
      localHeaderOffset,
      size,
    });
  }

  const centralDirectoryOffset = currentOffset;
  const centralChunks: Uint8Array[] = [];

  for (const entry of entries) {
    const cdHeader = new Uint8Array(46 + entry.encodedName.length);
    const view = new DataView(cdHeader.buffer);

    view.setUint32(0, 0x02014b50, true); // Central directory file header signature
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed to extract
    view.setUint16(8, 0x0800, true); // Bit flag: UTF-8
    view.setUint16(10, 0, true); // Compression method: 0 (Store)
    view.setUint16(12, dosTime, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, entry.crc32, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.encodedName.length, true);
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // Comment length
    view.setUint16(34, 0, true); // Disk number start
    view.setUint16(36, 0, true); // Internal attributes
    view.setUint32(38, 0, true); // External attributes
    view.setUint32(42, entry.localHeaderOffset, true);

    cdHeader.set(entry.encodedName, 46);
    centralChunks.push(cdHeader);
    currentOffset += cdHeader.length;
  }

  const centralDirectorySize = currentOffset - centralDirectoryOffset;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // End of central dir signature
  eocdView.setUint16(4, 0, true); // Disk number
  eocdView.setUint16(6, 0, true); // Disk where central directory starts
  eocdView.setUint16(8, entries.length, true); // Number of records on this disk
  eocdView.setUint16(10, entries.length, true); // Total number of records
  eocdView.setUint32(12, centralDirectorySize, true);
  eocdView.setUint32(16, centralDirectoryOffset, true);
  eocdView.setUint16(20, 0, true); // Comment length

  const allChunks = [...localChunks, ...centralChunks, eocd];
  const totalLength = allChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const buffer = new ArrayBuffer(totalLength);
  const result = new Uint8Array(buffer);
  let pos = 0;
  for (const chunk of allChunks) {
    result.set(chunk, pos);
    pos += chunk.byteLength;
  }

  return buffer;
}
