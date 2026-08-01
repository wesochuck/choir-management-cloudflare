import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { updateProfilePhotoRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.put("/api/organization/profiles/:profileId/photo/:fileId", (context) =>
    updateProfilePhotoRoute(context, context.req.param("fileId")),
  );

  router.delete("/api/organization/profiles/:profileId/photo", (context) =>
    updateProfilePhotoRoute(context, null),
  );
}
