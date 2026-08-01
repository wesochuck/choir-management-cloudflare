import { singerRsvpRequestSchema, type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import {
  CalendarMutationError,
  listMemberSchedule,
  readOrganizationCalendarSettings,
  setOrganizationEventRsvp,
} from "../calendar/organizationCalendar";
import { linkedOrganizationProfileId } from "../tenancy/linkedOrganizationProfile";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { setupFailureStatus, authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/singer/events", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    );
    if (!profileId) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for a personal schedule.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const [events, settings] = await Promise.all([
        listMemberSchedule(context.env, authorization.organizationId, profileId),
        readOrganizationCalendarSettings(context.env, authorization.organizationId),
      ]);
      return context.json({
        events,
        profileId,
        requestId: context.get("requestId"),
        timezone: settings.timezone,
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The personal Organization schedule is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/singer/events/:eventId/rsvp", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const body = singerRsvpRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!eventId.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid event and RSVP are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const profileId = await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    );
    if (!profileId) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required to RSVP.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
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
        { profileId, rsvp: body.data.rsvp, rsvpNote: body.data.rsvpNote },
        true,
      );
      return context.json({ ...rsvp, requestId: context.get("requestId") });
    } catch (error: unknown) {
      if (error instanceof CalendarMutationError) {
        return context.json(
          {
            code: error.code,
            message:
              error.code === "rsvp_closed"
                ? "The RSVP deadline has passed."
                : "The RSVP could not be updated.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          setupFailureStatus(error.status),
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The RSVP could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
