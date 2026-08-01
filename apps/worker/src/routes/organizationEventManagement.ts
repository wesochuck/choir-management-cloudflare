import {
  organizationEventRequestSchema,
  organizationRsvpRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import {
  CalendarMutationError,
  cancelOrganizationEvent,
  createOrganizationEvent,
  archiveOrganizationEvent,
  setOrganizationEventRsvp,
  updateOrganizationEvent,
} from "../calendar/organizationCalendar";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { setupFailureStatus, calendarMutationMessage, authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/events", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationEventRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid event details are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const event = await createOrganizationEvent(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ ...event, requestId: context.get("requestId") }, 201);
    } catch (error: unknown) {
      if (error instanceof CalendarMutationError && error.status === 409) {
        return context.json(
          {
            code: error.code,
            message: calendarMutationMessage(error.code),
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      if (error instanceof CalendarMutationError && error.status === 404) {
        return context.json(
          {
            code: error.code,
            message: calendarMutationMessage(error.code),
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization event could not be created.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/events/:eventId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const body = organizationEventRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!eventId.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid event and event details are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const event = await updateOrganizationEvent(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        eventId.data,
        body.data,
      );
      return context.json({ ...event, requestId: context.get("requestId") });
    } catch (error: unknown) {
      if (error instanceof CalendarMutationError && error.status === 409) {
        return context.json(
          {
            code: error.code,
            message: calendarMutationMessage(error.code),
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      if (error instanceof CalendarMutationError && error.status === 404) {
        return context.json(
          {
            code: error.code,
            message: calendarMutationMessage(error.code),
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization event could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.delete("/api/organization/events/:eventId", async (context) => {
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
      const result = await archiveOrganizationEvent(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        eventId.data,
      );
      return context.json({ ...result, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization event could not be archived.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/events/:eventId/cancel", async (context) => {
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
      const result = await cancelOrganizationEvent(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        eventId.data,
      );
      return context.json({ ...result, requestId: context.get("requestId") });
    } catch (error: unknown) {
      if (error instanceof CalendarMutationError && error.status === 404) {
        return context.json(
          {
            code: error.code,
            message: calendarMutationMessage(error.code),
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization event could not be canceled.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/events/:eventId/rsvp", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const body = organizationRsvpRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!eventId.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid event, Profile, and RSVP are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const rsvp = await setOrganizationEventRsvp(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        eventId.data,
        body.data,
      );
      return context.json({ ...rsvp, requestId: context.get("requestId") });
    } catch (error: unknown) {
      if (error instanceof CalendarMutationError) {
        return context.json(
          {
            code: error.code,
            message: "The Organization RSVP could not be updated.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          setupFailureStatus(error.status),
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization RSVP could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
