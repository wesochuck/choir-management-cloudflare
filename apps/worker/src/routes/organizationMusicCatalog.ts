import { type ProblemDetails } from "@choir/contracts";
import { renderMusicCsv } from "@choir/domain";
import { listOrganizationMusicPieces } from "../organization/organizationMusic";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/music", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      return context.json({
        pieces: await listOrganizationMusicPieces(context.env, authorization.organizationId),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization music catalog is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/music/export", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const pieces = await listOrganizationMusicPieces(context.env, authorization.organizationId);
      return context.body(renderMusicCsv(pieces), 200, {
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="music_library.csv"',
        "content-type": "text/csv; charset=utf-8",
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The music catalog export is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
