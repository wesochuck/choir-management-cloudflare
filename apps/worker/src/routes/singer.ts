import { type CalendarFeedUrlsResponse, type ProblemDetails } from "@choir/contracts";
import { createCalendarFeedUrls } from "../calendar/calendarFeed";
import { validateStartupConfig } from "../env";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, resolveEffectiveMemberProfileId } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/singer/calendar-feed-url", async (context) => {
    validateStartupConfig(context.env);
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const { profileId } = await resolveEffectiveMemberProfileId(context, authorization);
    if (!profileId) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for calendar subscriptions.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const urls = await createCalendarFeedUrls(context.env, {
      action: "read",
      actorUserId: authorization.userId,
      canonicalOrigin: new URL(context.req.url).origin,
      organizationId: authorization.organizationId,
      profileId,
      requestId: context.get("requestId"),
    });
    if (!urls) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for calendar subscriptions.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({
      ...urls,
      requestId: context.get("requestId"),
    } satisfies CalendarFeedUrlsResponse);
  });

  router.post("/api/singer/calendar-feed-url/reset", async (context) => {
    validateStartupConfig(context.env);
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const { profileId } = await resolveEffectiveMemberProfileId(context, authorization);
    if (!profileId) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for calendar subscriptions.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const urls = await createCalendarFeedUrls(context.env, {
      action: "reset",
      actorUserId: authorization.userId,
      canonicalOrigin: new URL(context.req.url).origin,
      organizationId: authorization.organizationId,
      profileId,
      requestId: context.get("requestId"),
    });
    if (!urls) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for calendar subscriptions.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({
      ...urls,
      requestId: context.get("requestId"),
    } satisfies CalendarFeedUrlsResponse);
  });
}
