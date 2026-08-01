import { duesCashPaymentRequestSchema, type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import {
  activateSeason,
  deleteSeason,
  listSeasons,
  listDues,
  markOrganizationDuesPaidInCash,
  refundDues,
  SeasonError,
} from "../organization/organizationSeasons";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, seasonMutationFailure, saveSeasonRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/seasons", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const seasons = await listSeasons(context.env, authorization.organizationId);
      return context.json({ seasons, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Seasons are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/seasons", (context) => saveSeasonRoute(context, null));

  router.put("/api/organization/seasons/:seasonId", (context) =>
    saveSeasonRoute(context, context.req.param("seasonId")),
  );

  router.post("/api/organization/seasons/:seasonId/activate", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const seasonId = z.uuid().safeParse(context.req.param("seasonId"));
    if (!seasonId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid season is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const season = await activateSeason(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        seasonId.data,
      );
      return context.json({ ...season, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const failure = seasonMutationFailure(
        error,
        context.get("requestId"),
        "The season could not be activated.",
      );
      return context.json(failure.problem, failure.status);
    }
  });

  router.delete("/api/organization/seasons/:seasonId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const seasonId = z.uuid().safeParse(context.req.param("seasonId"));
    if (!seasonId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid season is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      await deleteSeason(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        seasonId.data,
      );
      return context.json({
        deleted: true,
        seasonId: seasonId.data,
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const failure = seasonMutationFailure(
        error,
        context.get("requestId"),
        "The season could not be deleted.",
      );
      return context.json(failure.problem, failure.status);
    }
  });

  router.get("/api/organization/dues", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const dues = await listDues(context.env, authorization.organizationId);
      return context.json({ dues, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Dues are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/dues/cash", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = duesCashPaymentRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Profile and season are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const duesRecord = await markOrganizationDuesPaidInCash(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ ...duesRecord, requestId: context.get("requestId") });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof SeasonError ? error.code : "dues_cash_payment_unavailable",
          message:
            error instanceof SeasonError
              ? error.message
              : "The cash dues payment could not be recorded.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof SeasonError &&
          (error.status === 404 || error.status === 409 || error.status === 400)
          ? error.status
          : 503,
      );
    }
  });

  router.post("/api/organization/dues/:duesId/refund", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const duesId = z.uuid().safeParse(context.req.param("duesId"));
    if (!duesId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid dues record is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const duesRecord = await refundDues(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        duesId.data,
      );
      return context.json({ ...duesRecord, requestId: context.get("requestId") });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof SeasonError ? error.code : "dues_refund_unavailable",
          message: error instanceof SeasonError ? error.message : "The dues could not be refunded.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof SeasonError && error.status === 404
          ? 404
          : error instanceof SeasonError && error.status === 409
            ? 409
            : 503,
      );
    }
  });
}
