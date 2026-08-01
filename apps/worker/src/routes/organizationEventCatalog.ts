import { organizationVenueRequestSchema, type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import {
  CalendarMutationError,
  createOrganizationVenue,
  deleteOrganizationVenue,
  listOrganizationEvents,
  updateOrganizationVenue,
} from "../calendar/organizationCalendar";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/venues", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationVenueRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid venue name and address are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const venue = await createOrganizationVenue(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ ...venue, requestId: context.get("requestId") }, 201);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization venue could not be created.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/venues/:venueId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const venueId = z.uuid().safeParse(context.req.param("venueId"));
    const body = organizationVenueRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!venueId.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid venue name and address are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const venue = await updateOrganizationVenue(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        { ...body.data, id: venueId.data },
      );
      return context.json({ ...venue, requestId: context.get("requestId") });
    } catch (caught: unknown) {
      if (caught instanceof CalendarMutationError && caught.code === "venue_not_found") {
        return context.json(
          {
            code: "venue_not_found",
            message: "The venue was not found in this Organization.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization venue could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.delete("/api/organization/venues/:venueId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const venueId = z.uuid().safeParse(context.req.param("venueId"));
    if (!venueId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid venue is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const status = await deleteOrganizationVenue(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        venueId.data,
      );
      if (status === "in_use") {
        return context.json(
          {
            code: "venue_in_use",
            message: "This venue is linked to an event and cannot be deleted.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      if (status === "not_found") {
        return context.json(
          {
            code: "venue_not_found",
            message: "The venue was not found in this Organization.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      return context.json({ requestId: context.get("requestId"), status, venueId: venueId.data });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization venue could not be deleted.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/events", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      return context.json({
        events: await listOrganizationEvents(context.env, authorization.organizationId),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization events are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
