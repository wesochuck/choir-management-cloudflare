import type { Env } from "../env";
import { organizationStoreStub } from "../organization/rpc/client";
import { reclaimPrivateOrganizationFile } from "./privateFiles";

type SponsorArtworkCleanupEnv = Pick<Env, "ORGANIZATION_FILES" | "ORGANIZATION_STORE">;

export async function reclaimExpiredSponsorUploadClaims(
  env: SponsorArtworkCleanupEnv,
  organizationId: string,
  options: {
    readonly legacyCutoffIso?: string | undefined;
    readonly limit?: number | undefined;
    readonly nowIso?: string | undefined;
    readonly requestId?: string | undefined;
  } = {},
): Promise<{ readonly reclaimedCount: number }> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const stub = organizationStoreStub(env, organizationId);
  const { fileIds } = await stub.listExpiredUnclaimedSponsorUploads({
    legacyCutoffIso: options.legacyCutoffIso,
    limit: options.limit ?? 50,
    nowIso,
    organizationId,
  });

  let reclaimedCount = 0;
  for (const fileId of fileIds) {
    try {
      const reclaimed = await reclaimPrivateOrganizationFile(env, {
        actorUserId: "system_cleanup",
        fileId,
        organizationId,
        requestId: options.requestId ?? crypto.randomUUID(),
      });
      await stub.deleteExpiredSponsorUploadClaim({
        fileId,
        nowIso,
        organizationId,
      });
      if (reclaimed) {
        reclaimedCount += 1;
      }
    } catch {
      // Best-effort cleanup per file; continue reclaiming other expired files.
    }
  }

  return { reclaimedCount };
}
