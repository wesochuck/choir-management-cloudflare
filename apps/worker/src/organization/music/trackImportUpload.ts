import type { Env } from "../../env";
import { privateOrganizationUploadKey } from "../../storage/privateFiles";
import { organizationStoreStub } from "../rpc/client";

type TrackImportUploadEnv = Pick<Env, "ORGANIZATION_FILES" | "ORGANIZATION_STORE">;
type TrackImportUploadStub = ReturnType<typeof organizationStoreStub>;

export class TrackImportUploadError extends Error {
  readonly code: "conflict" | "gone" | "unavailable" | "validation";

  constructor(code: TrackImportUploadError["code"], message: string) {
    super(message);
    this.name = "TrackImportUploadError";
    this.code = code;
  }
}

interface TrackImportUploadInput {
  readonly actorUserId: string;
  readonly body: ReadableStream<Uint8Array> | ArrayBuffer | null;
  readonly clientFileId: string;
  readonly contentType: string;
  readonly fileName: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sizeBytes: number;
}

async function deleteImportKey(env: TrackImportUploadEnv, storageKey: string): Promise<void> {
  await env.ORGANIZATION_FILES.delete(storageKey).catch(() => undefined);
}

async function failUploadAttempt(
  stub: TrackImportUploadStub,
  input: TrackImportUploadInput,
  fileId: string,
  errorCode: string,
): Promise<{ readonly fileId: string; readonly storageKey: string } | null> {
  const failure = await stub
    .failMusicTrackImportUpload({
      actorUserId: input.actorUserId,
      clientFileId: input.clientFileId,
      errorCode,
      fileId,
      now: new Date().toISOString(),
      organizationId: input.organizationId,
      requestId: input.requestId,
      sessionId: input.sessionId,
    })
    .catch(() => null);
  return failure?.superseded ?? null;
}

async function putAttemptBytes(
  env: TrackImportUploadEnv,
  storageKey: string,
  body: ReadableStream<Uint8Array> | ArrayBuffer,
  input: TrackImportUploadInput,
  fileId: string,
): Promise<string | null> {
  const putOptions = {
    customMetadata: { fileId, organizationId: input.organizationId },
    httpMetadata: { contentType: input.contentType },
  };
  if (body instanceof ArrayBuffer) {
    const uploaded = await env.ORGANIZATION_FILES.put(storageKey, body, putOptions);
    return uploaded.version;
  }
  const stream = body.pipeThrough(new FixedLengthStream(input.sizeBytes));
  const uploaded = await env.ORGANIZATION_FILES.put(storageKey, stream, putOptions);
  return uploaded.version;
}

async function putAttemptBytesSafely(
  stub: TrackImportUploadStub,
  env: TrackImportUploadEnv,
  storageKey: string,
  body: ReadableStream<Uint8Array> | ArrayBuffer,
  input: TrackImportUploadInput,
  fileId: string,
  superseded: { readonly fileId: string; readonly storageKey: string } | null,
): Promise<string | null> {
  try {
    return await putAttemptBytes(env, storageKey, body, input, fileId);
  } catch (error: unknown) {
    const recorded = await failUploadAttempt(stub, input, fileId, "r2_write_failed");
    const stale = recorded ?? superseded;
    if (stale) await deleteImportKey(env, stale.storageKey);
    await deleteImportKey(env, storageKey);
    if (error instanceof TrackImportUploadError) throw error;
    throw new TrackImportUploadError(
      "unavailable",
      "The practice track could not be stored safely.",
    );
  }
}

async function finalizeAttemptSafely(
  stub: TrackImportUploadStub,
  env: TrackImportUploadEnv,
  input: TrackImportUploadInput,
  fileId: string,
  storageKey: string,
  r2Version: string | null,
): Promise<void> {
  try {
    await stub.finalizeMusicTrackImportUpload({
      actorUserId: input.actorUserId,
      clientFileId: input.clientFileId,
      fileId,
      now: new Date().toISOString(),
      organizationId: input.organizationId,
      r2Version,
      receivedSizeBytes: input.sizeBytes,
      requestId: input.requestId,
      sessionId: input.sessionId,
    });
  } catch (error: unknown) {
    await deleteImportKey(env, storageKey);
    await failUploadAttempt(stub, input, fileId, "finalize_failed");
    if (isStoreValidationFailure(error)) {
      throw new TrackImportUploadError(
        "gone",
        "The upload lease expired before the upload finished. Claim a fresh attempt.",
      );
    }
    throw new TrackImportUploadError(
      "unavailable",
      "The practice track could not be stored safely.",
    );
  }
}

function isStoreValidationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "validation_failed"
  );
}

/**
 * Session-backed MP3 upload: claim (transactional reservation) → R2 PUT →
 * finalize, with fail recording and idempotent key cleanup on every path.
 * Never mints file UUIDs or storage keys here; both arrive from the
 * server-side claim and the recorded key is scope-checked before the write.
 */
export async function uploadMusicTrackImportFile(
  env: TrackImportUploadEnv,
  input: TrackImportUploadInput,
): Promise<{ readonly bytesReceived: number; readonly fileId: string; readonly status: string }> {
  if (!input.body) {
    throw new TrackImportUploadError(
      "validation",
      "The upload body does not match its declared content length.",
    );
  }
  if (input.body instanceof ArrayBuffer && input.body.byteLength !== input.sizeBytes) {
    throw new TrackImportUploadError(
      "validation",
      "The upload body does not match its declared content length.",
    );
  }
  const body = input.body;
  const stub = organizationStoreStub(env, input.organizationId);
  const claim = await stub.claimMusicTrackImportUpload({
    actorUserId: input.actorUserId,
    clientFileId: input.clientFileId,
    contentType: input.contentType,
    expectedSizeBytes: input.sizeBytes,
    fileName: input.fileName,
    now: new Date().toISOString(),
    organizationId: input.organizationId,
    requestId: input.requestId,
    sessionId: input.sessionId,
  });
  if (claim.alreadyUploaded) {
    return { bytesReceived: input.sizeBytes, fileId: claim.fileId, status: "already_uploaded" };
  }
  const expectedKey = privateOrganizationUploadKey(
    input.organizationId,
    claim.fileId,
    input.fileName,
    input.contentType,
  );
  if (claim.storageKey !== expectedKey) {
    await failUploadAttempt(stub, input, claim.fileId, "storage_scope_mismatch");
    throw new TrackImportUploadError("unavailable", "The upload storage scope was rejected.");
  }
  const r2Version = await putAttemptBytesSafely(
    stub,
    env,
    claim.storageKey,
    body,
    input,
    claim.fileId,
    claim.superseded,
  );
  await finalizeAttemptSafely(stub, env, input, claim.fileId, claim.storageKey, r2Version);
  return { bytesReceived: input.sizeBytes, fileId: claim.fileId, status: "uploaded" };
}
