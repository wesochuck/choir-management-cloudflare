import {
  organizationSeatingChartRequestSchema,
  organizationSeatingChartOrderRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import {
  createOrganizationSeatingChart,
  deleteOrganizationSeatingChart,
  listOrganizationSeatingCharts,
  reorderOrganizationSeatingCharts,
  SeatingRepositoryError,
  updateOrganizationSeatingChart,
} from "../organization/organizationSeating";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/events/:eventId/seating-charts", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    if (!eventId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid performance is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      return context.json({
        charts: await listOrganizationSeatingCharts(
          context.env,
          authorization.organizationId,
          eventId.data,
        ),
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const status = error instanceof SeatingRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
          message:
            status === 404 ? "The performance was not found." : "Seating charts are unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.post("/api/organization/events/:eventId/seating-charts", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const chart = organizationSeatingChartRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!eventId.success || !chart.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid performance and seating chart are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const created = await createOrganizationSeatingChart(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        eventId.data,
        chart.data,
      );
      return context.json({ ...created, requestId: context.get("requestId") }, 201);
    } catch (error: unknown) {
      const status = error instanceof SeatingRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
          message:
            status === 409
              ? "The chart contains an invalid formation, venue, seat, or performer assignment."
              : "The seating chart could not be created.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.put("/api/organization/events/:eventId/seating-charts/order", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const body = organizationSeatingChartOrderRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!eventId.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid performance and chart order are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const charts = await reorderOrganizationSeatingCharts(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        eventId.data,
        body.data.chartIds,
      );
      return context.json({ charts, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const status = error instanceof SeatingRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
          message:
            status === 404
              ? "The performance was not found."
              : status === 409
                ? "The chart order is stale. Refresh and try again."
                : "The seating charts could not be reordered.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.put("/api/organization/events/:eventId/seating-charts/:chartId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const chartId = z.uuid().safeParse(context.req.param("chartId"));
    const chart = organizationSeatingChartRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!eventId.success || !chartId.success || !chart.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid performance and seating chart are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const updated = await updateOrganizationSeatingChart(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        eventId.data,
        chartId.data,
        chart.data,
      );
      return context.json({ ...updated, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const status = error instanceof SeatingRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
          message:
            status === 409
              ? "The chart contains an invalid formation, venue, seat, or performer assignment."
              : status === 404
                ? "The seating chart was not found."
                : "The seating chart could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.delete("/api/organization/events/:eventId/seating-charts/:chartId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const chartId = z.uuid().safeParse(context.req.param("chartId"));
    if (!eventId.success || !chartId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid performance and seating chart are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      await deleteOrganizationSeatingChart(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        eventId.data,
        chartId.data,
      );
      return context.json({
        chartId: chartId.data,
        requestId: context.get("requestId"),
        status: "deleted",
      });
    } catch (error: unknown) {
      const status = error instanceof SeatingRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
          message:
            status === 404
              ? "The seating chart was not found."
              : "The seating chart could not be deleted.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });
}
