import { type CalendarFeedUrlsResponse, type ProblemDetails } from "@choir/contracts";
import { createAuth } from "../auth/config";
import { createCalendarFeedUrls } from "../calendar/calendarFeed";
import { validateStartupConfig } from "../env";
import { authorizeOrganizationMember } from "../tenancy/authorizeOrganization";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { resolveCanonicalOrganizationId } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/singer/calendar-feed-url", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Calendar subscriptions require a canonical Organization hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    const urls = await createCalendarFeedUrls(context.env, {
      action: "read",
      actorUserId: authorization.value.userId,
      canonicalOrigin: requestUrl.origin,
      organizationId,
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
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Calendar subscriptions require a canonical Organization hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    const urls = await createCalendarFeedUrls(context.env, {
      action: "reset",
      actorUserId: authorization.value.userId,
      canonicalOrigin: requestUrl.origin,
      organizationId,
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
