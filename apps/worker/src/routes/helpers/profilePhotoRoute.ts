import type { ProblemDetails } from "@choir/contracts";
import type { Context } from "hono";
import { z } from "zod";

import { setOrganizationProfilePhoto } from "../../organization/profiles";
import { privateFileIdSchema, reclaimPrivateOrganizationFile } from "../../storage/privateFiles";
import { linkedOrganizationProfileId } from "../../tenancy/linkedOrganizationProfile";
import {
  authorizeCalendarRoute,
  type CalendarAuthorization,
  type WorkerHonoEnvironment,
} from "./routeContracts";

async function profilePhotoTargetAllowed(
  context: Context<WorkerHonoEnvironment>,
  authorization: Extract<CalendarAuthorization, { readonly ok: true }>,
  profileId: string,
): Promise<boolean> {
  if (authorization.role !== "member") return true;
  return (
    (await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    )) === profileId
  );
}

export async function updateProfilePhotoRoute(
  context: Context<WorkerHonoEnvironment>,
  fileId: string | null,
): Promise<Response> {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const profileId = z.uuid().safeParse(context.req.param("profileId"));
  const parsedFileId = fileId === null ? null : privateFileIdSchema.safeParse(fileId);
  if (!profileId.success || (parsedFileId !== null && !parsedFileId.success)) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Profile and private image file are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  if (!(await profilePhotoTargetAllowed(context, authorization, profileId.data))) {
    return context.json(
      {
        code: "forbidden",
        message: "Members may update only their own linked Organization Profile photo.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  try {
    const result = await setOrganizationProfilePhoto(context.env, {
      actorUserId: authorization.userId,
      fileId: parsedFileId?.data ?? null,
      organizationId: authorization.organizationId,
      profileId: profileId.data,
      requestId: context.get("requestId"),
    });
    if (result.previousFileId && result.previousFileId !== result.profile.photoFileId) {
      await reclaimPrivateOrganizationFile(context.env, {
        actorUserId: authorization.userId,
        fileId: result.previousFileId,
        organizationId: authorization.organizationId,
        requestId: crypto.randomUUID(),
      });
    }
    return context.json({
      photoFileId: result.profile.photoFileId,
      profileId: result.profile.id,
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Profile photo could not be updated safely.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
}
