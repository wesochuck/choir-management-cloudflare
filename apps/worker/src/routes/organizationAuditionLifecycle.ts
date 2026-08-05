import {
  organizationProfileRequestSchema,
  organizationAuditionSchema,
  organizationAuditionUpdateRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import {
  createOrganizationProfile,
  OrganizationProfileMutationError,
} from "../organization/profiles";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.put("/api/organization/auditions/:auditionId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const auditionId = z.uuid().safeParse(context.req.param("auditionId"));
    if (!auditionId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid audition ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const body = organizationAuditionUpdateRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid audition update fields are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      );
      const url = new URL("https://organization.internal/internal/audition/update");
      url.searchParams.set("auditionId", auditionId.data);
      const response = await stub.fetch(url, {
        body: JSON.stringify({
          ...body.data,
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        return context.json(
          {
            code:
              response.status === 404
                ? "audition_not_found"
                : response.status === 400
                  ? "validation_failed"
                  : "audition_update_failed",
            message:
              response.status === 404
                ? "The audition was not found."
                : response.status === 400
                  ? "The audition update is not valid."
                  : "Audition could not be updated.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          response.status === 404 || response.status === 400 ? response.status : 503,
        );
      }
      const updated = organizationAuditionSchema.safeParse(await response.json());
      if (!updated.success) throw new Error("invalid_audition");
      return context.json({ requestId: context.get("requestId"), ...updated.data });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Audition could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.delete("/api/organization/auditions/:auditionId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const auditionId = z.uuid().safeParse(context.req.param("auditionId"));
    if (!auditionId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid audition ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const response = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      ).fetch("https://organization.internal/internal/audition/delete", {
        body: JSON.stringify({
          actorUserId: authorization.userId,
          auditionId: auditionId.data,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        return context.json(
          {
            code: response.status === 404 ? "audition_not_found" : "audition_delete_failed",
            message:
              response.status === 404
                ? "The audition was not found."
                : "The audition could not be deleted.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          response.status === 404 ? 404 : 503,
        );
      }
      const resultRecord =
        typeof result === "object" && result !== null && !Array.isArray(result) ? result : {};
      return context.json({ ...resultRecord, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The audition could not be deleted.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/auditions/:auditionId/convert", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const auditionId = z.uuid().safeParse(context.req.param("auditionId"));
    if (!auditionId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid audition ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      );
      const detailUrl = new URL("https://organization.internal/internal/audition/details");
      detailUrl.searchParams.set("auditionId", auditionId.data);
      const detailResponse = await stub.fetch(detailUrl);
      const audition = organizationAuditionSchema.safeParse(await detailResponse.json());
      if (!detailResponse.ok || !audition.success) {
        return context.json(
          {
            code: "audition_not_found",
            message: "The audition was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      if (audition.data.status === "completed") {
        return context.json(
          {
            code: "audition_already_converted",
            message: "This audition has already been converted to an Organization Profile.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      const profile = await createOrganizationProfile(context.env, {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        profile: organizationProfileRequestSchema.parse({
          displayName: audition.data.name,
          phone: audition.data.phone ?? "",
          voicePart: audition.data.voicePart ?? "",
        }),
        requestId: context.get("requestId"),
      });
      const updateResponse = await stub.fetch(
        `https://organization.internal/internal/audition/update?auditionId=${encodeURIComponent(auditionId.data)}`,
        {
          body: JSON.stringify({
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
            status: "completed",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!updateResponse.ok) throw new Error("audition_update_failed");
      return context.json(
        { auditionId: auditionId.data, profile, requestId: context.get("requestId") },
        201,
      );
    } catch (error: unknown) {
      if (error instanceof OrganizationProfileMutationError) {
        return context.json(
          {
            code: error.code,
            message: error.message,
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The audition could not be converted to an Organization Profile.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
