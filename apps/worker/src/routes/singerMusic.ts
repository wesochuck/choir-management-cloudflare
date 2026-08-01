import { singerLearningTrackPieceSchema, type ProblemDetails } from "@choir/contracts";
import { listOrganizationMusicPieces } from "../organization/organizationMusic";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/singer/music", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const pieces = await listOrganizationMusicPieces(context.env, authorization.organizationId);
      return context.json({
        pieces: pieces.map((piece) => singerLearningTrackPieceSchema.parse(piece)),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization practice library is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
