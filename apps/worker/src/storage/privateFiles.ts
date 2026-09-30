import type { PrivateFileResponse } from "@choir/contracts";
import { organizationIdSchema } from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";

export const MAX_PRIVATE_FILE_BYTES = 20 * 1024 * 1024;

function isSafePrivateFileName(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127 || value[index] === "/" || value[index] === "\\") {
      return false;
    }
  }
  return true;
}

export const privateFileIdSchema = z.uuid();
export const privateFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(isSafePrivateFileName);
export const privateFileContentTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/);

export const privateFileReservationSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  contentType: privateFileContentTypeSchema,
  fileId: privateFileIdSchema,
  fileName: privateFileNameSchema,
  organizationId: organizationIdSchema,
  requestId: z.uuid(),
  sizeBytes: z.number().int().positive().max(MAX_PRIVATE_FILE_BYTES),
});

export const privateFileTransitionSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  fileId: privateFileIdSchema,
  organizationId: organizationIdSchema,
  requestId: z.uuid(),
  storageKey: z.string().min(1).max(512),
});

export const privateFileReclamationSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  fileId: privateFileIdSchema,
  organizationId: organizationIdSchema,
  requestId: z.uuid(),
});

const privateFileMetadataSchema = z.object({
  contentType: privateFileContentTypeSchema,
  fileName: privateFileNameSchema,
  id: privateFileIdSchema,
  sizeBytes: z.number().int().positive().max(MAX_PRIVATE_FILE_BYTES),
  storageKey: z.string().min(1).max(512),
  uploadedAt: z.iso.datetime(),
});

const reservationResponseSchema = z.object({ reserved: z.literal(true), storageKey: z.string() });
const readyResponseSchema = z.object({ ready: z.literal(true), uploadedAt: z.iso.datetime() });

type PrivateFileEnv = Pick<Env, "ORGANIZATION_FILES" | "ORGANIZATION_STORE">;

export class PrivateFileStorageError extends Error {
  constructor(
    readonly kind:
      "conflict" | "not_found" | "range_not_satisfiable" | "unavailable" | "validation",
    message: string,
    readonly sizeBytes: number | null = null,
  ) {
    super(message);
    this.name = "PrivateFileStorageError";
  }
}

function hasStringKind(error: object): error is { readonly kind: string } {
  return "kind" in error && typeof Reflect.get(error, "kind") === "string";
}

export function isPrivateFileStorageError(error: unknown): error is PrivateFileStorageError {
  return (
    error instanceof PrivateFileStorageError ||
    (error instanceof Error && error.name === "PrivateFileStorageError" && hasStringKind(error))
  );
}

export function findPrivateFileStorageError(error: unknown): PrivateFileStorageError | null {
  if (isPrivateFileStorageError(error)) {
    return error;
  }
  if (error && typeof error === "object" && "cause" in error) {
    return findPrivateFileStorageError(error.cause);
  }
  if (
    error instanceof TypeError &&
    (error.message.includes("FixedLengthStream") ||
      error.message.includes("did not receive expected amount of data") ||
      error.message.includes("too many bytes") ||
      error.message.includes("too few bytes"))
  ) {
    return new PrivateFileStorageError(
      "validation",
      "The private file body does not match its declared content length.",
    );
  }
  return null;
}

export type PrivateFileUploadBody = ReadableStream<Uint8Array> | ArrayBuffer;

function createByteValidationTransform(declaredSizeBytes: number): {
  readonly transform: TransformStream<Uint8Array, Uint8Array>;
  readonly assertComplete: () => void;
} {
  let bytesRead = 0;
  let finished = false;

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesRead += chunk.byteLength;
      if (bytesRead > declaredSizeBytes) {
        throw new PrivateFileStorageError(
          "validation",
          "The private file body does not match its declared content length.",
        );
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (bytesRead !== declaredSizeBytes) {
        throw new PrivateFileStorageError(
          "validation",
          "The private file body does not match its declared content length.",
        );
      }
      finished = true;
    },
  });

  return {
    assertComplete: () => {
      if (!finished || bytesRead !== declaredSizeBytes) {
        throw new PrivateFileStorageError(
          "validation",
          "The private file body does not match its declared content length.",
        );
      }
    },
    transform,
  };
}

function requestedRange(value: string, sizeBytes: number): { length: number; offset: number } {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) {
    throw new PrivateFileStorageError(
      "range_not_satisfiable",
      "The requested byte range is invalid.",
      sizeBytes,
    );
  }
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new PrivateFileStorageError(
        "range_not_satisfiable",
        "The requested byte range is invalid.",
        sizeBytes,
      );
    }
    const offset = Math.max(0, sizeBytes - suffix);
    return { length: sizeBytes - offset, offset };
  }
  const offset = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : sizeBytes - 1;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(requestedEnd) ||
    offset < 0 ||
    offset >= sizeBytes ||
    requestedEnd < offset
  ) {
    throw new PrivateFileStorageError(
      "range_not_satisfiable",
      "The requested byte range is invalid.",
      sizeBytes,
    );
  }
  const end = Math.min(requestedEnd, sizeBytes - 1);
  return { length: end - offset + 1, offset };
}

export function privateOrganizationFileKey(organizationId: string, fileId: string): string {
  return `organizations/${organizationId}/private/${fileId}`;
}

function privateFileStorageName(fileName: string): string {
  const stem = fileName.replace(/\.[^./\\]+$/, "");
  const slug = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 96);
  return slug || "learning-track";
}

export function privateOrganizationUploadKey(
  organizationId: string,
  fileId: string,
  fileName: string,
  contentType: string,
): string {
  if (contentType !== "audio/mpeg") return privateOrganizationFileKey(organizationId, fileId);
  return `organizations/${organizationId}/private/${privateFileStorageName(fileName)}-${fileId}.mp3`;
}

function isPrivateOrganizationFileKey(
  organizationId: string,
  fileId: string,
  fileName: string,
  contentType: string,
  storageKey: string,
): boolean {
  return (
    storageKey === privateOrganizationFileKey(organizationId, fileId) ||
    storageKey === privateOrganizationUploadKey(organizationId, fileId, fileName, contentType)
  );
}

async function abortReservation(
  stub: ReturnType<typeof organizationStoreStub>,
  transition: z.infer<typeof privateFileTransitionSchema>,
): Promise<void> {
  await invokeOrganizationRpc(stub, "https://organization.internal/internal/files/abort", {
    body: JSON.stringify(transition),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).catch(() => undefined);
}

export async function uploadPrivateOrganizationFile(
  env: PrivateFileEnv,
  input: z.infer<typeof privateFileReservationSchema> & {
    readonly body: PrivateFileUploadBody;
  },
): Promise<Omit<PrivateFileResponse, "requestId">> {
  const parsed = privateFileReservationSchema.parse(input);
  if (input.body instanceof ArrayBuffer && input.body.byteLength !== parsed.sizeBytes) {
    throw new PrivateFileStorageError(
      "validation",
      "The private file body does not match its declared content length.",
    );
  }
  const stub = organizationStoreStub(env, parsed.organizationId);
  const reservationResponse = await invokeOrganizationRpc(
    stub,
    "https://organization.internal/internal/files/reserve",
    {
      body: JSON.stringify(parsed),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (reservationResponse.status === 409) {
    throw new PrivateFileStorageError("conflict", "The private file ID is already in use.");
  }
  const reservation = reservationResponseSchema.safeParse(await reservationResponse.json());
  if (!reservationResponse.ok || !reservation.success) {
    throw new PrivateFileStorageError("unavailable", "Private file reservation failed.");
  }
  const expectedKey = privateOrganizationUploadKey(
    parsed.organizationId,
    parsed.fileId,
    parsed.fileName,
    parsed.contentType,
  );
  if (reservation.data.storageKey !== expectedKey) {
    throw new PrivateFileStorageError("unavailable", "Private file storage scope was rejected.");
  }
  const transition = {
    actorUserId: parsed.actorUserId,
    fileId: parsed.fileId,
    organizationId: parsed.organizationId,
    requestId: parsed.requestId,
    storageKey: expectedKey,
  };
  try {
    if (input.body instanceof ArrayBuffer) {
      await env.ORGANIZATION_FILES.put(expectedKey, input.body, {
        customMetadata: { fileId: parsed.fileId, organizationId: parsed.organizationId },
        httpMetadata: { contentType: parsed.contentType },
      });
    } else {
      const validation = createByteValidationTransform(parsed.sizeBytes);
      const stream = input.body
        .pipeThrough(validation.transform)
        .pipeThrough(new FixedLengthStream(parsed.sizeBytes));
      await env.ORGANIZATION_FILES.put(expectedKey, stream, {
        customMetadata: { fileId: parsed.fileId, organizationId: parsed.organizationId },
        httpMetadata: { contentType: parsed.contentType },
      });
      validation.assertComplete();
    }
    const readyResponse = await invokeOrganizationRpc(
      stub,
      "https://organization.internal/internal/files/ready",
      {
        body: JSON.stringify(transition),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const ready = readyResponseSchema.safeParse(await readyResponse.json());
    if (!readyResponse.ok || !ready.success) {
      throw new PrivateFileStorageError("unavailable", "Private file finalization failed.");
    }
    return {
      contentType: parsed.contentType,
      fileName: parsed.fileName,
      id: parsed.fileId,
      sizeBytes: parsed.sizeBytes,
      uploadedAt: ready.data.uploadedAt,
    };
  } catch (error: unknown) {
    await env.ORGANIZATION_FILES.delete(expectedKey).catch(() => undefined);
    await abortReservation(stub, transition);
    const storageError = findPrivateFileStorageError(error);
    if (storageError) {
      throw storageError;
    }
    throw error;
  }
}

export async function readPrivateOrganizationFile(
  env: PrivateFileEnv,
  organizationId: string,
  fileId: string,
  rangeHeader: string | null = null,
): Promise<{
  readonly metadata: z.infer<typeof privateFileMetadataSchema>;
  readonly object: R2ObjectBody;
  readonly range: { readonly length: number; readonly offset: number } | null;
} | null> {
  const metadataResponse = await invokeOrganizationRpc(
    organizationStoreStub(env, organizationId),
    `https://organization.internal/internal/files/${encodeURIComponent(fileId)}`,
  );
  if (metadataResponse.status === 404) {
    return null;
  }
  const metadata = privateFileMetadataSchema.safeParse(await metadataResponse.json());
  if (
    !metadataResponse.ok ||
    !metadata.success ||
    !isPrivateOrganizationFileKey(
      organizationId,
      fileId,
      metadata.data.fileName,
      metadata.data.contentType,
      metadata.data.storageKey,
    )
  ) {
    throw new PrivateFileStorageError("unavailable", "Private file metadata scope was rejected.");
  }
  const storageKey = metadata.data.storageKey;
  const range = rangeHeader ? requestedRange(rangeHeader, metadata.data.sizeBytes) : null;
  const object = await env.ORGANIZATION_FILES.get(
    storageKey,
    range ? { range: { length: range.length, offset: range.offset } } : undefined,
  );
  if (!object) {
    throw new PrivateFileStorageError("unavailable", "Private file storage is unavailable.");
  }
  if (
    object.size !== metadata.data.sizeBytes ||
    object.customMetadata?.organizationId !== organizationId ||
    object.customMetadata.fileId !== fileId
  ) {
    throw new PrivateFileStorageError("unavailable", "Private file storage is unavailable.");
  }
  return { metadata: metadata.data, object, range };
}

export async function reclaimPrivateOrganizationFile(
  env: PrivateFileEnv,
  input: z.infer<typeof privateFileReclamationSchema>,
): Promise<boolean> {
  const parsed = privateFileReclamationSchema.parse(input);
  const stub = organizationStoreStub(env, parsed.organizationId);
  const claim = await invokeOrganizationRpc(
    stub,
    "https://organization.internal/internal/files/reclaim",
    {
      body: JSON.stringify(parsed),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (claim.status === 409) return false;
  const claimed = z
    .object({ claimed: z.literal(true), storageKey: z.string().min(1).max(512) })
    .safeParse(await claim.json());
  if (!claim.ok || !claimed.success)
    throw new PrivateFileStorageError("unavailable", "Private file reclamation failed.");
  const transition = { ...parsed, storageKey: claimed.data.storageKey };
  try {
    await env.ORGANIZATION_FILES.delete(claimed.data.storageKey);
  } catch (error: unknown) {
    await invokeOrganizationRpc(
      stub,
      "https://organization.internal/internal/files/reclaim-abort",
      {
        body: JSON.stringify(transition),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    throw error;
  }
  const finished = await invokeOrganizationRpc(
    stub,
    "https://organization.internal/internal/files/reclaimed",
    {
      body: JSON.stringify(transition),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!finished.ok)
    throw new PrivateFileStorageError("unavailable", "Private file reclamation failed.");
  return true;
}
