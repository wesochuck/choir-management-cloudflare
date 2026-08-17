import {
  organizationMusicBulkUpdateRequestSchema,
  organizationMusicCreditRenameRequestSchema,
  organizationMusicPieceRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import { MusicCsvError, parseMusicCsv } from "@choir/domain";
import {
  createOrganizationMusicPiece,
  bulkUpdateOrganizationMusicPieces,
  deleteOrganizationMusicPiece,
  importOrganizationMusicPieces,
  MusicRepositoryError,
  renameOrganizationMusicCredit,
  updateOrganizationMusicPiece,
} from "../organization/organizationMusic";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, musicImportProblem } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/music/import", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const declaredLength = Number(context.req.header("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > 2_000_000) {
      return context.json(
        {
          code: "validation_failed",
          message: "Music CSV files may not exceed 2 MB.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        413,
      );
    }
    const csv = await context.req.text();
    if (new TextEncoder().encode(csv).byteLength > 2_000_000) {
      return context.json(
        {
          code: "validation_failed",
          message: "Music CSV files may not exceed 2 MB.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        413,
      );
    }
    try {
      const parsed = parseMusicCsv(csv).map((piece) =>
        organizationMusicPieceRequestSchema.parse({
          ...piece,
          parentId: null,
          trackFileIds: {},
        }),
      );
      if (parsed.length === 0) throw new MusicCsvError("The CSV contains no music pieces.");
      const imported = await importOrganizationMusicPieces(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        parsed,
      );
      return context.json({ imported, requestId: context.get("requestId") }, 201);
    } catch (error: unknown) {
      const failure = musicImportProblem(error, context.get("requestId"));
      return context.json(failure.problem, failure.status);
    }
  });

  router.post("/api/organization/music", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationMusicPieceRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid music-piece details are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const piece = await createOrganizationMusicPiece(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ ...piece, requestId: context.get("requestId") }, 201);
    } catch (error: unknown) {
      const status = error instanceof MusicRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof MusicRepositoryError ? error.code : "service_unavailable",
          message: "The music piece could not be created.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.post("/api/organization/music/bulk-update", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationMusicBulkUpdateRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Select at least one music field and one or more pieces.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const pieces = await bulkUpdateOrganizationMusicPieces(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ pieces, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const status = error instanceof MusicRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof MusicRepositoryError ? error.code : "service_unavailable",
          message: "The music pieces could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.post("/api/organization/music/credits/rename", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationMusicCreditRenameRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Provide different current and new credit names.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const pieces = await renameOrganizationMusicCredit(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ pieces, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const status = error instanceof MusicRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof MusicRepositoryError ? error.code : "service_unavailable",
          message: "The music credit could not be renamed.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.put("/api/organization/music/:pieceId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const pieceId = z.uuid().safeParse(context.req.param("pieceId"));
    const body = organizationMusicPieceRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!pieceId.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid music piece and details are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const piece = await updateOrganizationMusicPiece(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        pieceId.data,
        body.data,
      );
      return context.json({ ...piece, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const status = error instanceof MusicRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof MusicRepositoryError ? error.code : "service_unavailable",
          message: "The music piece could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.delete("/api/organization/music/:pieceId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const pieceId = z.uuid().safeParse(context.req.param("pieceId"));
    if (!pieceId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid music piece is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      await deleteOrganizationMusicPiece(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        pieceId.data,
        context.req.query("unlinkChildren") === "true",
      );
      return context.json({
        pieceId: pieceId.data,
        requestId: context.get("requestId"),
        status: "deleted" as const,
      });
    } catch (error: unknown) {
      const status = error instanceof MusicRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof MusicRepositoryError ? error.code : "service_unavailable",
          message: "The music piece could not be deleted.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });
}
