import { z } from "zod";

import type { readPrivateOrganizationFile } from "../../storage/privateFiles";
import {
  MAX_PRIVATE_FILE_BYTES,
  privateFileContentTypeSchema,
  privateFileNameSchema,
} from "../../storage/privateFiles";

export function decodePrivateFileName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = privateFileNameSchema.safeParse(decodeURIComponent(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parsePrivateFileUploadHeaders(headers: Headers): {
  readonly contentType: string;
  readonly fileName: string;
  readonly sizeBytes: number;
} | null {
  const fileName = decodePrivateFileName(headers.get("x-file-name") ?? undefined);
  const contentType = privateFileContentTypeSchema.safeParse(
    headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase(),
  );
  const declaredSize = z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PRIVATE_FILE_BYTES)
    .safeParse(headers.get("content-length"));
  return fileName && contentType.success && declaredSize.success
    ? { contentType: contentType.data, fileName, sizeBytes: declaredSize.data }
    : null;
}

export type PrivateFileReadResult = NonNullable<
  Awaited<ReturnType<typeof readPrivateOrganizationFile>>
>;

export function privateFileDownloadResponse(file: PrivateFileReadResult): Response {
  const disposition = file.metadata.contentType.startsWith("audio/") ? "inline" : "attachment";
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.metadata.fileName)}`,
    "content-length": String(file.range?.length ?? file.metadata.sizeBytes),
    "content-type": file.metadata.contentType,
    etag: file.object.httpEtag,
    "x-audio-content-version": file.object.version,
  });
  if (file.range) {
    const end = file.range.offset + file.range.length - 1;
    headers.set(
      "content-range",
      `bytes ${String(file.range.offset)}-${String(end)}/${String(file.metadata.sizeBytes)}`,
    );
  }
  return new Response(file.object.body, { headers, status: file.range ? 206 : 200 });
}

export const ALLOWED_ARTWORK_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46] as const;
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_HEADER = [0xff, 0xd8, 0xff] as const;

function matchesHeader(bytes: Uint8Array, header: readonly number[]): boolean {
  if (bytes.length < header.length) return false;
  for (let i = 0; i < header.length; i++) {
    if (bytes[i] !== header[i]) return false;
  }
  return true;
}

export function sniffArtworkMimeType(
  bytes: Uint8Array,
): "application/pdf" | "image/png" | "image/jpeg" | null {
  if (matchesHeader(bytes, PDF_HEADER)) return "application/pdf";
  if (matchesHeader(bytes, PNG_HEADER)) return "image/png";
  if (matchesHeader(bytes, JPEG_HEADER)) return "image/jpeg";
  return null;
}
