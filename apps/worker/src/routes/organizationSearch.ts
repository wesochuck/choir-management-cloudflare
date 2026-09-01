import {
  adminSearchQueryResponseSchema,
  searchCategorySchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/search", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const query = context.req.query("q") ?? "";
    const categoryParsed = searchCategorySchema.optional().safeParse(context.req.query("category"));
    const category = categoryParsed.success ? categoryParsed.data : undefined;
    const limitParam = context.req.query("limit");
    const limit = limitParam ? Number(limitParam) : 20;

    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const url = new URL("https://organization.internal/internal/search");
      url.searchParams.set("organizationId", authorization.organizationId);
      url.searchParams.set("q", query);
      if (category) url.searchParams.set("category", category);
      if (limit) url.searchParams.set("limit", String(limit));

      const response = await invokeOrganizationRpc(stub, url.toString());
      if (!response.ok) {
        return context.json(
          {
            code: "search_failed",
            message: "Unable to complete search request.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          500,
        );
      }

      const body: unknown = await response.json();
      const results =
        typeof body === "object" &&
        body !== null &&
        "results" in body &&
        Array.isArray(body.results)
          ? body.results
          : [];

      const parsedResponse = adminSearchQueryResponseSchema.parse({
        requestId: context.get("requestId"),
        results,
      });

      return context.json(parsedResponse);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization search is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
