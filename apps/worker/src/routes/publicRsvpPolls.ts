import {
  publicPollSubmitRequestSchema,
  publicQuickRsvpRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import { validateStartupConfig } from "../env";
import { resolvePollDetails, submitPollResponse } from "../organization/organizationPollLinks";
import { resolveRsvpDetails, submitQuickRsvp } from "../organization/organizationRsvpLinks";
import { queueRsvpDeclineNotice } from "../organization/rsvpDeclineNotifications";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import type { WorkerHonoEnvironment } from "./helpers";
import { isErrorResponse } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/public/rsvp-details", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "RSVP is not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const body = z
      .object({ token: z.string().min(1).max(4_096) })
      .safeParse(await context.req.json<unknown>().catch(() => null));
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid RSVP link is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const details = await resolveRsvpDetails(
      context.env,
      resolved.value.organizationId,
      body.data.token,
    );
    if (isErrorResponse(details)) {
      return context.json(
        {
          code: details.code,
          message:
            details.code === "invalid_link"
              ? "This RSVP link is invalid or expired."
              : "RSVP details not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({ ...details, requestId: context.get("requestId") });
  });

  router.post("/api/public/quick-rsvp", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "RSVP is not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const body = publicQuickRsvpRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid RSVP and link are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const result = await submitQuickRsvp(
      context.env,
      resolved.value.organizationId,
      body.data.token,
      body.data.rsvp,
      body.data.rsvpNote,
    );
    if ("code" in result) {
      const status = result.code === "invalid_link" ? 404 : result.status;
      return context.json(
        {
          code: result.code,
          message:
            result.code === "invalid_link"
              ? "This RSVP link is invalid or expired."
              : result.code === "rsvp_decline_note_required"
                ? "A note is required when declining a rehearsal."
                : "RSVP could not be submitted.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        status as Parameters<typeof context.json>[1],
      );
    }
    if (result.rsvp.rsvp === "No") {
      context.executionCtx.waitUntil(
        queueRsvpDeclineNotice(context.env, {
          actorUserId: `public:${result.rsvp.profileId}`,
          eventId: result.rsvp.eventId,
          organizationId: resolved.value.organizationId,
          organizationOrigin: new URL(context.req.url).origin,
          profileId: result.rsvp.profileId,
          requestId: context.get("requestId"),
          updatedAt: result.rsvp.updatedAt,
        }).catch(() => {
          console.error(
            JSON.stringify({
              event: "rsvp_decline_notice_queue_failed",
              eventId: result.rsvp.eventId,
              organizationId: resolved.value.organizationId,
              profileId: result.rsvp.profileId,
              requestId: context.get("requestId"),
            }),
          );
        }),
      );
    }
    return context.json({ rsvp: body.data.rsvp, requestId: context.get("requestId") });
  });

  router.post("/api/public/poll-details", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Poll is not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const body = z
      .object({ token: z.string().min(1).max(4_096) })
      .safeParse(await context.req.json<unknown>().catch(() => null));
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid poll link is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const details = await resolvePollDetails(
      context.env,
      resolved.value.organizationId,
      body.data.token,
    );
    if ("code" in details) {
      return context.json(
        {
          code: details.code,
          message:
            details.code === "invalid_link"
              ? "This poll link is invalid or expired."
              : "Poll details not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({ ...details, requestId: context.get("requestId") });
  });

  router.post("/api/public/poll-vote", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Poll is not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const body = publicPollSubmitRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid poll response and link are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const result = await submitPollResponse(
      context.env,
      resolved.value.organizationId,
      body.data.token,
      body.data.optionIds,
    );
    if ("code" in result) {
      const status =
        result.status === 400
          ? 400
          : result.status === 404
            ? 404
            : result.status === 409
              ? 409
              : result.status === 410
                ? 410
                : result.status === 429
                  ? 429
                  : 503;
      return context.json(
        {
          code: result.code,
          message: "Poll response could not be submitted.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
    return context.json({ submitted: true, requestId: context.get("requestId") });
  });
}
