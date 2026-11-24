import { mutateOrganizationStore } from "../../organization/rpc/repository";
import { reclaimExpiredSponsorUploadClaims } from "../../storage/sponsorArtworkCleanup";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";

const LEGACY_ABANDONED_SPONSOR_FILE_AGE_MS = 24 * 60 * 60 * 1_000;

export async function cleanupStaleCheckout(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  const response = await mutateOrganizationStore(
    env,
    job.organizationId,
    "/internal/payments/cleanup",
    { organizationId: job.organizationId },
  );
  if (!response.ok) throw new Error("Stale payment cleanup was rejected.");

  const now = new Date();
  await reclaimExpiredSponsorUploadClaims(env, job.organizationId, {
    legacyCutoffIso: new Date(now.getTime() - LEGACY_ABANDONED_SPONSOR_FILE_AGE_MS).toISOString(),
    nowIso: now.toISOString(),
  });
}
