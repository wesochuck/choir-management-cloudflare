import { type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import { eventRsvpExportFilename, renderEventRsvpCsv } from "@choir/domain";
import { readOrganizationEventRsvpExport } from "../calendar/organizationCalendar";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/events/:eventId/rsvp-export.csv", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const sort = context.req.query("sort") ?? "lastName";
    if (!eventId.success || (sort !== "lastName" && sort !== "section")) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid event and RSVP export sort are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const data = await readOrganizationEventRsvpExport(
        context.env,
        authorization.organizationId,
        eventId.data,
      );
      if (!data) {
        return context.json(
          {
            code: "not_found",
            message: "The Organization event was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const csv = renderEventRsvpCsv({ ...data, sort });
      return context.body(csv, 200, {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${eventRsvpExportFilename(data.eventTitle, data.eventType)}"`,
        "content-type": "text/csv; charset=utf-8",
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The event RSVP export could not be generated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
