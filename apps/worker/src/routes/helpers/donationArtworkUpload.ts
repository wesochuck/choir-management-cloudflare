import { MAX_PRIVATE_FILE_BYTES, type PrivateFileUploadBody } from "../../storage/privateFiles";
import { sniffArtworkMimeType } from "./fileHelpers";
import { readBoundedBody } from "./routeContracts";

const STREAM_PEEK_THRESHOLD_BYTES = 65_536;
const ARTWORK_SIGNATURE_PEEK_BYTES = 16;

export type BoundedArtworkResult =
  | {
      readonly code: "request_body_too_large" | "validation_failed";
      readonly message: string;
      readonly ok: false;
      readonly status: 400 | 413;
    }
  | {
      readonly body: PrivateFileUploadBody;
      readonly contentHash: string;
      readonly contentType: "application/pdf" | "image/jpeg" | "image/png";
      readonly ok: true;
      readonly sizeBytes: number;
    };

async function sha256HexBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseDeclaredContentLength(
  header: string | null,
  maxBytes: number,
):
  | { readonly declaredSize: number | undefined; readonly ok: true }
  | {
      readonly code: "request_body_too_large" | "validation_failed";
      readonly message: string;
      readonly ok: false;
      readonly status: 400 | 413;
    } {
  if (header === null) {
    return { declaredSize: undefined, ok: true };
  }
  const declaredSize = Number(header);
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
    return {
      code: "validation_failed",
      message: "The artwork file must be non-empty and at most 20 MB.",
      ok: false,
      status: 400,
    };
  }
  if (declaredSize > maxBytes) {
    return {
      code: "request_body_too_large",
      message: "The artwork file must be non-empty and at most 20 MB.",
      ok: false,
      status: 413,
    };
  }
  return { declaredSize, ok: true };
}

function concatHeaderBytes(chunks: readonly Uint8Array[], maxLen: number): Uint8Array {
  const total = Math.min(
    maxLen,
    chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  );
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= total) break;
    const take = Math.min(chunk.byteLength, total - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

async function prepareStreamingArtworkBody(
  body: ReadableStream<Uint8Array>,
  declaredSize: number,
  declaredContentType: string,
  maxBytes: number,
): Promise<BoundedArtworkResult> {
  const reader = body.getReader();
  const peekedChunks: Uint8Array[] = [];
  let peekedBytes = 0;
  let streamDone = false;

  try {
    while (peekedBytes < ARTWORK_SIGNATURE_PEEK_BYTES) {
      const result = await reader.read();
      if (result.done) {
        streamDone = true;
        break;
      }
      peekedBytes += result.value.byteLength;
      if (peekedBytes > maxBytes) {
        await reader.cancel("artwork_body_too_large");
        reader.releaseLock();
        return {
          code: "request_body_too_large",
          message: "The artwork file must be non-empty and at most 20 MB.",
          ok: false,
          status: 413,
        };
      }
      peekedChunks.push(result.value);
    }
  } catch {
    reader.releaseLock();
    return {
      code: "validation_failed",
      message: "The artwork file must be non-empty and at most 20 MB.",
      ok: false,
      status: 400,
    };
  }

  const headerBytes = concatHeaderBytes(peekedChunks, ARTWORK_SIGNATURE_PEEK_BYTES);
  const sniffedType = sniffArtworkMimeType(headerBytes);
  if (!sniffedType || sniffedType !== declaredContentType) {
    await reader.cancel("invalid_artwork_signature").catch(() => undefined);
    reader.releaseLock();
    return {
      code: "validation_failed",
      message: "The artwork file contents do not match the expected PDF, PNG, or JPEG format.",
      ok: false,
      status: 400,
    };
  }

  let chunkIndex = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (chunkIndex < peekedChunks.length) {
        const chunk = peekedChunks[chunkIndex];
        chunkIndex += 1;
        if (chunk) controller.enqueue(chunk);
        return;
      }
      if (streamDone) {
        reader.releaseLock();
        controller.close();
        return;
      }
      const next = await reader.read();
      if (next.done) {
        streamDone = true;
        reader.releaseLock();
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      reader.releaseLock();
    },
  });

  return {
    body: stream,
    contentHash: "",
    contentType: sniffedType,
    ok: true,
    sizeBytes: declaredSize,
  };
}

export async function readBoundedArtworkUpload(
  request: Request,
  declaredContentType: string,
  maxBytes = MAX_PRIVATE_FILE_BYTES,
): Promise<BoundedArtworkResult> {
  const lengthCheck = parseDeclaredContentLength(request.headers.get("content-length"), maxBytes);
  if (!lengthCheck.ok) {
    return lengthCheck;
  }
  const body = request.body;
  if (!body) {
    return {
      code: "validation_failed",
      message: "The artwork file must be non-empty and at most 20 MB.",
      ok: false,
      status: 400,
    };
  }

  if (
    lengthCheck.declaredSize !== undefined &&
    lengthCheck.declaredSize > STREAM_PEEK_THRESHOLD_BYTES
  ) {
    return prepareStreamingArtworkBody(
      body,
      lengthCheck.declaredSize,
      declaredContentType,
      maxBytes,
    );
  }

  const buffer = await readBoundedBody(body, maxBytes, "artwork_body_too_large");
  if (!buffer) {
    return {
      code: "request_body_too_large",
      message: "The artwork file must be non-empty and at most 20 MB.",
      ok: false,
      status: 413,
    };
  }
  if (
    buffer.byteLength === 0 ||
    (lengthCheck.declaredSize !== undefined && buffer.byteLength !== lengthCheck.declaredSize)
  ) {
    return {
      code: "validation_failed",
      message: "The artwork file must be non-empty and at most 20 MB.",
      ok: false,
      status: 400,
    };
  }

  const sniffedType = sniffArtworkMimeType(
    new Uint8Array(buffer.slice(0, ARTWORK_SIGNATURE_PEEK_BYTES)),
  );
  if (!sniffedType || sniffedType !== declaredContentType) {
    return {
      code: "validation_failed",
      message: "The artwork file contents do not match the expected PDF, PNG, or JPEG format.",
      ok: false,
      status: 400,
    };
  }

  const contentHash = await sha256HexBuffer(buffer);
  return {
    body: buffer,
    contentHash,
    contentType: sniffedType,
    ok: true,
    sizeBytes: buffer.byteLength,
  };
}
