import {
  memberProfileUpdateRequestSchema,
  transactionFeeSettingsSchema,
  memberDuesCheckoutRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import {
  listOrganizationProfileEmails,
  readOrganizationMemberProfile,
  updateOrganizationMemberProfile,
} from "../organization/profiles";
import { linkedOrganizationProfileId } from "../tenancy/linkedOrganizationProfile";
import {
  createDuesCheckoutSession,
  listSeasons,
  listDues,
  SeasonError,
} from "../organization/organizationSeasons";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/singer/profile", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    );
    if (!profileId) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for self-service.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const [profile, emails] = await Promise.all([
        readOrganizationMemberProfile(context.env, authorization.organizationId, profileId),
        listOrganizationProfileEmails(context.env.CONTROL_DB, authorization.organizationId),
      ]);
      const email = emails.get(profileId);
      if (!email) throw new Error("The linked Profile email is missing.");
      return context.json({
        displayName: profile.displayName,
        email,
        globalStatus: profile.globalStatus,
        id: profile.id,
        photoFileId: profile.photoFileId,
        phone: profile.phone,
        requestId: context.get("requestId"),
        showInDirectory: profile.showInDirectory,
        voicePart: profile.voicePart,
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Your Organization Profile is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/singer/dues", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    );
    if (!profileId) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for self-service.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const [seasons, dues, feeResponse] = await Promise.all([
        listSeasons(context.env, authorization.organizationId),
        listDues(context.env, authorization.organizationId),
        context.env.ORGANIZATION_STORE.get(
          context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
        ).fetch(
          `https://organization.internal/internal/transaction-fee-settings?organizationId=${encodeURIComponent(authorization.organizationId)}`,
        ),
      ]);
      const transactionFeeSettings = transactionFeeSettingsSchema.parse(await feeResponse.json());
      return context.json({
        dues: dues.filter((record) => record.profileId === profileId),
        requestId: context.get("requestId"),
        seasons,
        transactionFeeSettings,
      });
    } catch {
      return context.json(
        {
          code: "dues_unavailable",
          message: "Your season dues are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/singer/dues/checkout", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = memberDuesCheckoutRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Choose a valid season before starting checkout.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const profileId = await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    );
    if (!profileId) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for self-service.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      return context.json(
        await createDuesCheckoutSession(
          context.env,
          authorization.organizationId,
          new URL(context.req.url).origin,
          {
            checkoutRequestId: body.data.checkoutRequestId,
            profileIds: [profileId],
            seasonId: body.data.seasonId,
          },
          authorization.email || undefined,
        ),
        201,
      );
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof SeasonError ? error.code : "dues_checkout_unavailable",
          message:
            error instanceof SeasonError
              ? error.message
              : "Online dues checkout is not available right now.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof SeasonError && error.status === 409 ? 409 : 503,
      );
    }
  });

  router.put("/api/singer/profile", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = memberProfileUpdateRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid display name, phone, and directory preference are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const profileId = await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    );
    if (!profileId) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for self-service.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const [profile, emails] = await Promise.all([
        updateOrganizationMemberProfile(context.env, {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          profile: body.data,
          profileId,
          requestId: context.get("requestId"),
        }),
        listOrganizationProfileEmails(context.env.CONTROL_DB, authorization.organizationId),
      ]);
      const email = emails.get(profileId);
      if (!email) throw new Error("The linked Profile email is missing.");
      return context.json({
        displayName: profile.displayName,
        email,
        globalStatus: profile.globalStatus,
        id: profile.id,
        photoFileId: profile.photoFileId,
        phone: profile.phone,
        requestId: context.get("requestId"),
        showInDirectory: profile.showInDirectory,
        voicePart: profile.voicePart,
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Your Organization Profile could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
