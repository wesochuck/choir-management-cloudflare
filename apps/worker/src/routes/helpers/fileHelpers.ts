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
