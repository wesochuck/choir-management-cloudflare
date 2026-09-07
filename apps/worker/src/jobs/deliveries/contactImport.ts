import { organizationStoreStub, type OrganizationStoreStub } from "../../organization/rpc/client";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";

/**
 * Phase 5 async contact-import delivery.
 *
 * Confirming an import stages a `contact_import` outbox row; the scheduler
 * alarm enqueues it and this consumer drains it in bounded batches through
 * the typed `processContactImportBatch` Durable Object RPC. Batch state
 * lives in `contact_import_rows`, so redelivery after a crash resumes from
 * the first pending row and replaying a completed import performs zero
 * mutations. Terminal import states (`completed`, `failed`, `cancelled`)
 * end the delivery normally; unexpected failures throw so the consumer
 * records the attempt and retries with backoff before dead-lettering.
 */

const CONTACT_IMPORT_DELIVERY_BATCH_SIZE = 200;
/** 60 × 200 rows covers the 10k-row V1 cap with headroom. */
const CONTACT_IMPORT_DELIVERY_MAX_ITERATIONS = 60;

type ContactImportStub = Pick<
  OrganizationStoreStub,
  "getContactImport" | "processContactImportBatch"
>;

export async function deliverContactImportJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  await drainContactImport(organizationStoreStub(env, job.organizationId), job);
}

/** Drains one import through bounded batch RPCs; exported for deterministic tests. */
export async function drainContactImport(stub: ContactImportStub, job: DeliveryJob): Promise<void> {
  const summary = await stub.getContactImport({
    importId: job.jobId,
    organizationId: job.organizationId,
  });
  if (
    summary.status === "completed" ||
    summary.status === "failed" ||
    summary.status === "cancelled"
  ) {
    return;
  }
  for (let iteration = 0; iteration < CONTACT_IMPORT_DELIVERY_MAX_ITERATIONS; iteration += 1) {
    const result = await stub.processContactImportBatch({
      actorUserId: summary.actorUserId,
      batchSize: CONTACT_IMPORT_DELIVERY_BATCH_SIZE,
      importId: job.jobId,
      organizationId: job.organizationId,
      requestId: job.jobId,
    });
    if (
      result.completed ||
      result.summary.status === "completed" ||
      result.summary.status === "failed" ||
      result.summary.status === "cancelled"
    ) {
      return;
    }
  }
  throw new Error("The contact import did not finish within its bounded delivery budget.");
}
