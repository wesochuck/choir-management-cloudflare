import {
  invokeOrganizationRpc,
  organizationStoreStub,
  type OrganizationStoreStub,
} from "../../organization/rpc/client";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";

const MUSIC_TRACK_IMPORT_CLEANUP_ACTOR = "system:music-track-import-cleanup";

/**
 * Durable practice-track import cleanup delivery.
 *
 * The hourly scheduler (or a discard) enqueues one `music_track_import_cleanup`
 * job per due session. Each execution claims at most 25 eligible attempts
 * through the typed cleanup RPC — which never claims live leases or
 * referenced files — then settles them with the existing private-file
 * reclamation pipeline (ready files) or exact-key R2 deletes (abandoned
 * pending uploads), and finally marks attempts reclaimed. Sessions whose
 * attempts are all settled close; sessions with remaining work request one
 * bounded continuation. Unexpected provider errors are rethrown so the
 * consumer records the attempt and retries with backoff before dead-lettering.
 */

type MusicTrackImportCleanupStub = Pick<
  OrganizationStoreStub,
  | "claimMusicTrackImportCleanupBatch"
  | "completeMusicTrackImportCleanup"
  | "getMusicTrackImportSession"
  | "scheduleMusicTrackImportCleanupContinuation"
>;

type MusicTrackImportCleanupEnv = Pick<JobConsumerEnv, "ORGANIZATION_FILES">;

async function postFileRpc(
  stub: OrganizationStoreStub,
  path: string,
  body: unknown,
): Promise<Response> {
  return invokeOrganizationRpc(stub, `https://organization.internal${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function reclaimReadyFile(
  stub: OrganizationStoreStub,
  env: MusicTrackImportCleanupEnv,
  input: {
    readonly fileId: string;
    readonly organizationId: string;
    readonly storageKey: string;
  },
): Promise<boolean> {
  const operationId = crypto.randomUUID();
  const claimResponse = await postFileRpc(stub, "/internal/files/reclaim", {
    actorUserId: MUSIC_TRACK_IMPORT_CLEANUP_ACTOR,
    fileId: input.fileId,
    organizationId: input.organizationId,
    requestId: operationId,
  });
  if (claimResponse.status === 409) {
    // Already reclaimed, finalized by a concurrent path, or referenced: the
    // attempt stays claimed and the next sweep re-evaluates it.
    return false;
  }
  if (!claimResponse.ok) {
    throw new Error(`The file reclaim claim failed with status ${String(claimResponse.status)}.`);
  }
  await env.ORGANIZATION_FILES.delete(input.storageKey);
  const finishResponse = await postFileRpc(stub, "/internal/files/reclaimed", {
    actorUserId: MUSIC_TRACK_IMPORT_CLEANUP_ACTOR,
    fileId: input.fileId,
    organizationId: input.organizationId,
    requestId: operationId,
    storageKey: input.storageKey,
  });
  // A 409 here means the row is already gone (replay-safe); anything else
  // unexpected must surface so the queue retries.
  if (!finishResponse.ok && finishResponse.status !== 409) {
    throw new Error(
      `The file reclaim finalize failed with status ${String(finishResponse.status)}.`,
    );
  }
  return true;
}

async function reclaimPendingFile(
  stub: OrganizationStoreStub,
  env: MusicTrackImportCleanupEnv,
  input: {
    readonly fileId: string;
    readonly organizationId: string;
    readonly storageKey: string;
    readonly uploadRequestId: string | null;
    readonly uploadedBy: string | null;
  },
): Promise<boolean> {
  await env.ORGANIZATION_FILES.delete(input.storageKey);
  if (!input.uploadedBy || !input.uploadRequestId) return true;
  const abortResponse = await postFileRpc(stub, "/internal/files/abort", {
    actorUserId: input.uploadedBy,
    fileId: input.fileId,
    organizationId: input.organizationId,
    requestId: input.uploadRequestId,
    storageKey: input.storageKey,
  });
  if (!abortResponse.ok) {
    throw new Error(`The pending upload abort failed with status ${String(abortResponse.status)}.`);
  }
  return true;
}

export async function drainMusicTrackImportCleanup(
  stub: MusicTrackImportCleanupStub,
  fileStub: OrganizationStoreStub,
  env: MusicTrackImportCleanupEnv,
  job: DeliveryJob,
): Promise<void> {
  const claimed = await stub.claimMusicTrackImportCleanupBatch({
    limit: 25,
    now: new Date().toISOString(),
    organizationId: job.organizationId,
    sessionId: job.jobId,
  });
  const settled: string[] = [];
  try {
    for (const attempt of claimed.attempts) {
      if (attempt.privateFileStatus === "ready") {
        await reclaimReadyFile(fileStub, env, {
          fileId: attempt.fileId,
          organizationId: job.organizationId,
          storageKey: attempt.storageKey,
        });
      } else {
        await reclaimPendingFile(fileStub, env, {
          fileId: attempt.fileId,
          organizationId: job.organizationId,
          storageKey: attempt.storageKey,
          uploadRequestId: attempt.uploadRequestId,
          uploadedBy: attempt.uploadedBy,
        });
      }
      settled.push(attempt.fileId);
    }
  } catch (error: unknown) {
    // Persist the attempts that were already reclaimed, then fail noisily so
    // the queue records the attempt and retries the rest with backoff.
    await stub.completeMusicTrackImportCleanup({
      errorCode: "cleanup_provider_error",
      fileIds: settled,
      now: new Date().toISOString(),
      organizationId: job.organizationId,
      sessionId: job.jobId,
    });
    throw error;
  }
  const completed = await stub.completeMusicTrackImportCleanup({
    fileIds: settled,
    now: new Date().toISOString(),
    organizationId: job.organizationId,
    sessionId: job.jobId,
  });
  if (completed.remaining > 0) {
    await stub.scheduleMusicTrackImportCleanupContinuation({
      now: new Date().toISOString(),
      organizationId: job.organizationId,
      sessionId: job.jobId,
    });
  }
}

export async function deliverMusicTrackImportCleanupJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const stub = organizationStoreStub(env, job.organizationId);
  await drainMusicTrackImportCleanup(stub, stub, env, job);
}
