import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "../helpers";
import { authorizePlatformRead } from "./shared";

export function registerPlatformQueueSettingRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/queue-settings", async (context) => {
    const authorization = await authorizePlatformRead(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    return context.json({
      queue: "choir-management-jobs-local",
      deadLetterQueue: "choir-management-jobs-dlq-local",
      mode: context.env.EXTERNAL_EFFECTS_MODE,
      requestId: context.get("requestId"),
    });
  });

  router.post("/api/platform/queue-settings/generate", async (context) => {
    const authorization = await authorizePlatformRead(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    return context.json({ generated: true, requestId: context.get("requestId") });
  });
}
