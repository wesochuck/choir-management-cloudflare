import {
  organizationAttendanceBulkRequestSchema,
  organizationEventRsvpHistoryResponseSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import {
  listOrganizationEventAttendance,
  listOrganizationEventRsvpHistory,
  updateOrganizationEventAttendance,
} from "../calendar/organizationCalendar";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/events/:eventId/attendance", async (context) => {
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
          message: "A valid event is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      return context.json({
        eventId: eventId.data,
        requestId: context.get("requestId"),
        rows: await listOrganizationEventAttendance(
          context.env,
          authorization.organizationId,
          eventId.data,
        ),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization attendance is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/events/:eventId/rsvp-history", async (context) => {
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
          message: "A valid event is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const history = organizationEventRsvpHistoryResponseSchema.parse(
        await listOrganizationEventRsvpHistory(
          context.env,
          authorization.organizationId,
          eventId.data,
        ),
      );
      return context.json({ ...history, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Event RSVP history is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/events/:eventId/attendance", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const body = organizationAttendanceBulkRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!eventId.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid event and attendance updates are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      return context.json({
        eventId: eventId.data,
        requestId: context.get("requestId"),
        rows: await updateOrganizationEventAttendance(
          context.env,
          {
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          },
          eventId.data,
          body.data.updates,
        ),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization attendance could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
