import { readPrivateOrganizationFileMetadata } from "../storage/privateFiles";
import { loudnessStartSchema, loudnessSubmitSchema } from "@choir/contracts";
import { z } from "zod";
import type { Hono } from "hono";
import { authorizeCalendarRoute, type WorkerHonoEnvironment } from "./helpers";
import { organizationStoreStub } from "../organization/rpc/client";

const renewSchema = z.object({ claimId: z.uuid(), release: z.boolean().default(false) });
export function registerAudioLoudnessRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/music/loudness", async (context) => {
    const auth = await authorizeCalendarRoute(context, true);
    if (!auth.ok)
      return context.json({ ...auth, requestId: context.get("requestId") }, auth.status);
    const statuses = await organizationStoreStub(
      context.env,
      auth.organizationId,
    ).audioLoudnessStatus({ organizationId: auth.organizationId });
    return context.json({ statuses }, 200, { "cache-control": "private, no-store" });
  });
  router.post("/api/organization/music/loudness/start", async (context) => {
    const auth = await authorizeCalendarRoute(context, true);
    if (!auth.ok)
      return context.json({ ...auth, requestId: context.get("requestId") }, auth.status);
    const parsed = loudnessStartSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ code: "validation_failed" }, 400);
    return context.json(
      await organizationStoreStub(context.env, auth.organizationId).startAudioLoudness({
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        requestId: context.get("requestId"),
        options: parsed.data,
      }),
    );
  });
  router.post("/api/organization/music/loudness/claim", async (context) => {
    const auth = await authorizeCalendarRoute(context, true);
    if (!auth.ok)
      return context.json({ ...auth, requestId: context.get("requestId") }, auth.status);
    const parsed = z.object({ fileId: z.uuid().optional() }).safeParse(await context.req.json());
    if (!parsed.success) return context.json({ code: "validation_failed" }, 400);
    const scope = {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      requestId: context.get("requestId"),
      fileId: parsed.data.fileId,
    };
    const stub = organizationStoreStub(context.env, auth.organizationId);
    const claim = await stub.claimAudioLoudness(scope);
    if (!claim) return context.json({ claim: null });
    try {
      const object = await context.env.ORGANIZATION_FILES.head(claim.storageKey);
      if (
        !object ||
        object.customMetadata?.organizationId !== auth.organizationId ||
        object.customMetadata.fileId !== claim.fileId ||
        object.size !== claim.sizeBytes ||
        (claim.contentVersion && claim.contentVersion !== object.version)
      )
        throw new Error("invalid_asset_identity");
      if (
        !(await stub.bindAudioLoudnessVersion({
          ...scope,
          fileId: claim.fileId,
          claimId: claim.claimId,
          contentVersion: object.version,
        }))
      )
        throw new Error("stale_claim");
      return context.json({
        claim: {
          fileId: claim.fileId,
          claimId: claim.claimId,
          contentVersion: object.version,
          sizeBytes: claim.sizeBytes,
        },
      });
    } catch {
      await stub.renewAudioLoudness({ ...scope, claimId: claim.claimId, release: true });
      return context.json({ code: "asset_unavailable" }, 409);
    }
  });
  router.post("/api/organization/music/loudness/renew", async (context) => {
    const auth = await authorizeCalendarRoute(context, true);
    if (!auth.ok)
      return context.json({ ...auth, requestId: context.get("requestId") }, auth.status);
    const parsed = renewSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ code: "validation_failed" }, 400);
    const ok = await organizationStoreStub(context.env, auth.organizationId).renewAudioLoudness({
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      requestId: context.get("requestId"),
      ...parsed.data,
    });
    return ok ? context.json({ ok }) : context.json({ code: "stale_claim" }, 409);
  });
  router.post("/api/organization/music/loudness/result", async (context) => {
    const auth = await authorizeCalendarRoute(context, true);
    if (!auth.ok)
      return context.json({ ...auth, requestId: context.get("requestId") }, auth.status);
    const parsed = loudnessSubmitSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ code: "validation_failed" }, 400);
    const metadata = await readPrivateOrganizationFileMetadata(
      context.env,
      auth.organizationId,
      parsed.data.fileId,
    );
    if (!metadata) return context.json({ code: "stale_asset" }, 409);
    const object = await context.env.ORGANIZATION_FILES.head(metadata.storageKey);
    if (
      object?.version !== parsed.data.result.contentVersion ||
      object.size !== metadata.sizeBytes ||
      object.customMetadata?.organizationId !== auth.organizationId ||
      object.customMetadata.fileId !== parsed.data.fileId
    )
      return context.json({ code: "stale_asset" }, 409);
    const ok = await organizationStoreStub(context.env, auth.organizationId).submitAudioLoudness({
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      requestId: context.get("requestId"),
      submission: parsed.data,
    });
    return ok ? context.json({ ok }) : context.json({ code: "stale_claim" }, 409);
  });
}
