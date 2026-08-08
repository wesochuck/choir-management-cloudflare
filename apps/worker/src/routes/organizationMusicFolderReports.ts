import {
  musicFolderNumberBatchRequestSchema,
  musicFolderReportProfileDetailResponseSchema,
  musicFolderReportQueryResponseSchema,
  musicFolderReportSelectionSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";

import {
  exportMusicFolderReport,
  MusicFolderReportError,
  queryMusicFolderReport,
  readMusicFolderProfileDetail,
  updateMusicFolderNumbers,
  updateMusicFolderReturnStatus,
} from "../organization/organizationMusicFolderReports";

import type { Context, Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

type ReportContext = Context<WorkerHonoEnvironment>;

function problem(
  context: ReportContext,
  code: string,
  message: string,
  status: 400 | 404 | 409 | 413 | 503,
) {
  return context.json(
    { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
    status,
  );
}

function errorResponse(context: ReportContext, error: unknown, fallback: string) {
  if (error instanceof MusicFolderReportError) {
    const status =
      error.status === 400 || error.status === 404 || error.status === 409 || error.status === 413
        ? error.status
        : 503;
    const messages: Readonly<Record<string, string>> = {
      folder_number_conflict: "That Folder Number is already used for this Performance.",
      not_applicable: "This Profile has no roster record for the selected Performance.",
      not_assigned: "A folder must have a Folder Number before it can be marked Returned.",
      performance_not_found: "One or more selected Performances no longer exist.",
      profile_not_found: "The selected Profile no longer exists.",
      stale_folder_row: "This folder row changed elsewhere. Refresh and try again.",
    };
    return problem(context, error.code, messages[error.code] ?? fallback, status);
  }
  return problem(context, "service_unavailable", fallback, 503);
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/reports/music-folders/query", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const selection = musicFolderReportSelectionSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!selection.success) {
      return problem(context, "validation_failed", "Select valid Performances to continue.", 400);
    }
    try {
      const result = musicFolderReportQueryResponseSchema.parse(
        await queryMusicFolderReport(
          context.env,
          {
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          },
          selection.data.eventIds,
        ),
      );
      return context.json(result);
    } catch (error: unknown) {
      return errorResponse(context, error, "The Music Folder Report could not be loaded.");
    }
  });

  router.post("/api/organization/reports/music-folders/profiles/:profileId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = z.uuid().safeParse(context.req.param("profileId"));
    const selection = musicFolderReportSelectionSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!profileId.success || !selection.success) {
      return problem(
        context,
        "validation_failed",
        "A valid Profile and Performances are required.",
        400,
      );
    }
    try {
      const result = musicFolderReportProfileDetailResponseSchema.parse(
        await readMusicFolderProfileDetail(
          context.env,
          {
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          },
          profileId.data,
          selection.data.eventIds,
        ),
      );
      return context.json(result);
    } catch (error: unknown) {
      return errorResponse(context, error, "The Profile folder details could not be loaded.");
    }
  });

  router.put("/api/organization/reports/music-folders/folder-numbers", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const updates = musicFolderNumberBatchRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!updates.success) {
      return problem(
        context,
        "validation_failed",
        "Valid Folder Number changes are required.",
        400,
      );
    }
    try {
      return context.json(
        await updateMusicFolderNumbers(
          context.env,
          {
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          },
          updates.data.updates,
        ),
      );
    } catch (error: unknown) {
      return errorResponse(context, error, "The Folder Number changes could not be saved.");
    }
  });

  router.put(
    "/api/organization/profiles/:profileId/folder-numbers/:eventId/return-status",
    async (context) => {
      const authorization = await authorizeCalendarRoute(context, true);
      if (!authorization.ok) {
        return context.json(
          { ...authorization, requestId: context.get("requestId") },
          authorization.status,
        );
      }
      const profileId = z.uuid().safeParse(context.req.param("profileId"));
      const eventId = z.uuid().safeParse(context.req.param("eventId"));
      const folder = z
        .object({
          expectedUpdatedAt: z.iso.datetime().nullable(),
          folderReturned: z.boolean(),
        })
        .safeParse(await context.req.json<unknown>().catch(() => null));
      if (!profileId.success || !eventId.success || !folder.success) {
        return problem(
          context,
          "validation_failed",
          "Valid folder return details are required.",
          400,
        );
      }
      try {
        return context.json(
          await updateMusicFolderReturnStatus(
            context.env,
            {
              actorUserId: authorization.userId,
              organizationId: authorization.organizationId,
              requestId: context.get("requestId"),
            },
            profileId.data,
            eventId.data,
            folder.data.folderReturned,
            folder.data.expectedUpdatedAt,
          ),
        );
      } catch (error: unknown) {
        return errorResponse(context, error, "The folder return status could not be updated.");
      }
    },
  );

  router.post("/api/organization/reports/music-folders/export.csv", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const selection = musicFolderReportSelectionSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!selection.success) {
      return problem(context, "validation_failed", "Select valid Performances to export.", 400);
    }
    try {
      const csv = await exportMusicFolderReport(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        selection.data.eventIds,
      );
      return context.body(csv, 200, {
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="music_folder_report.csv"',
        "content-type": "text/csv; charset=utf-8",
      });
    } catch (error: unknown) {
      return errorResponse(
        context,
        error,
        "The Music Folder Report export could not be generated.",
      );
    }
  });
}
