import type { PrivateFileResponse } from "@choir/contracts";
import { organizationIdSchema } from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";

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
    readonly kind: "conflict" | "not_found" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PrivateFileStorageError";
  }
}

export function privateOrganizationFileKey(organizationId: string, fileId: string): string {
  return `organizations/${organizationId}/private/${fileId}`;
}

async function abortReservation(
  stub: DurableObjectStub,
  transition: z.infer<typeof privateFileTransitionSchema>,
): Promise<void> {
  await stub
    .fetch("https://organization.internal/internal/files/abort", {
      body: JSON.stringify(transition),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    .catch(() => undefined);
}

export async function uploadPrivateOrganizationFile(
  env: PrivateFileEnv,
  input: z.infer<typeof privateFileReservationSchema> & { readonly body: ArrayBuffer },
): Promise<Omit<PrivateFileResponse, "requestId">> {
  const parsed = privateFileReservationSchema.parse(input);
  if (input.body.byteLength !== parsed.sizeBytes) {
    throw new PrivateFileStorageError("conflict", "The private file size changed during upload.");
  }
  const objectId = env.ORGANIZATION_STORE.idFromName(parsed.organizationId);
  const stub = env.ORGANIZATION_STORE.get(objectId);
  const reservationResponse = await stub.fetch(
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
  const expectedKey = privateOrganizationFileKey(parsed.organizationId, parsed.fileId);
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
    await env.ORGANIZATION_FILES.put(expectedKey, input.body, {
      customMetadata: { fileId: parsed.fileId, organizationId: parsed.organizationId },
      httpMetadata: { contentType: parsed.contentType },
    });
    const readyResponse = await stub.fetch("https://organization.internal/internal/files/ready", {
      body: JSON.stringify(transition),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
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
    throw error;
  }
}

export async function readPrivateOrganizationFile(
  env: PrivateFileEnv,
  organizationId: string,
  fileId: string,
): Promise<{
  readonly metadata: z.infer<typeof privateFileMetadataSchema>;
  readonly object: R2ObjectBody;
} | null> {
  const expectedKey = privateOrganizationFileKey(organizationId, fileId);
  const objectId = env.ORGANIZATION_STORE.idFromName(organizationId);
  const metadataResponse = await env.ORGANIZATION_STORE.get(objectId).fetch(
    `https://organization.internal/internal/files/${encodeURIComponent(fileId)}`,
  );
  if (metadataResponse.status === 404) {
    return null;
  }
  const metadata = privateFileMetadataSchema.safeParse(await metadataResponse.json());
  if (!metadataResponse.ok || !metadata.success || metadata.data.storageKey !== expectedKey) {
    throw new PrivateFileStorageError("unavailable", "Private file metadata scope was rejected.");
  }
  const object = await env.ORGANIZATION_FILES.get(expectedKey);
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
  return { metadata: metadata.data, object };
}
