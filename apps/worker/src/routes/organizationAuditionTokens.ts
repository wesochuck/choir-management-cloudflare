import { generateAuditionTokensRequestSchema, type ProblemDetails } from "@choir/contracts";
import { generateAuditionTokens } from "../organization/organizationAuditions";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/audition-tokens", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = generateAuditionTokensRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid audition IDs are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const generated = await generateAuditionTokens(
        context.env,
        authorization.organizationId,
        body.data.auditionIds,
      );
      if (Object.keys(generated.tokens).length !== body.data.auditionIds.length) {
        return context.json(
          {
            code: "audition_not_found",
            message: "One or more audition requests were not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      return context.json({
        ...generated,
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Audition tokens could not be generated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
