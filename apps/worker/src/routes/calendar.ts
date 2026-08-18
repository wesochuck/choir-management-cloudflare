import type { ProblemDetails } from "@choir/contracts";
import { readCalendarFeed } from "../calendar/calendarFeed";
import { validateStartupConfig } from "../env";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";
import { resolveCanonicalOrganizationId } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/calendar/feed", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    const token = requestUrl.searchParams.get("token") ?? "";
    if (!organizationId || token.length === 0 || token.length > 4096) {
      return context.json(
        {
          code: "not_found",
          message: "The calendar feed is unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const feed = await readCalendarFeed(context.env, organizationId, token).catch(() => null);
    if (!feed) {
      return context.json(
        {
          code: "not_found",
          message: "The calendar feed is unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    context.header("content-disposition", `inline; filename="${feed.filename}"`);
    context.header("content-type", "text/calendar; charset=utf-8");
    return context.body(feed.body);
  });
}
