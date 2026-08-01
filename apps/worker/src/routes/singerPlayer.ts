import { type ProblemDetails } from "@choir/contracts";
import { createAuth } from "../auth/config";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { resolveCanonicalOrganizationId } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/singer/resolve-placeholders", async (context) => {
    const auth = createAuth({
      env: context.env,
      requestUrl: new URL(context.req.url),
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) {
      return context.json(
        {
          code: "unauthorized",
          message: "Authentication required.",
          requestId: context.get("requestId"),
        },
        401,
      );
    }
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "No Organization is registered for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({ resolved: [], requestId: context.get("requestId") });
  });

  router.get("/api/singer/player-playlist", async (context) => {
    const auth = createAuth({
      env: context.env,
      requestUrl: new URL(context.req.url),
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) {
      return context.json(
        {
          code: "unauthorized",
          message: "Authentication required.",
          requestId: context.get("requestId"),
        },
        401,
      );
    }
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "No Organization is registered for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({ playlist: [], requestId: context.get("requestId") });
  });
}
