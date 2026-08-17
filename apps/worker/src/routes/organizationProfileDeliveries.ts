import { organizationProfileDeliveriesResponseSchema, type ProblemDetails } from "@choir/contracts";
import { z } from "zod";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/profiles/:profileId/deliveries", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = z.uuid().safeParse(context.req.param("profileId"));
    if (!profileId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Profile is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const url = new URL("https://organization.internal/internal/communications/deliveries");
    url.searchParams.set("organizationId", authorization.organizationId);
    url.searchParams.set("profileId", profileId.data);
    const response = await invokeOrganizationRpc(
      organizationStoreStub(context.env, authorization.organizationId),
      url,
    );
    if (!response.ok) {
      return context.json(
        {
          code: "deliveries_unavailable",
          message: "Profile delivery history could not be loaded.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    const deliveries = organizationProfileDeliveriesResponseSchema
      .omit({ requestId: true })
      .parse(await response.json());
    return context.json({ ...deliveries, requestId: context.get("requestId") });
  });
}
