import {
  generateRsvpTokensRequestSchema,
  generatePollTokensRequestSchema,
  generatePlayerTokensRequestSchema,
  organizationAuditionSettingsSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { generateRsvpTokens } from "../organization/organizationRsvpLinks";
import { generatePollTokens } from "../organization/organizationPollLinks";
import { generatePlayerTokens } from "../organization/organizationPlayerLinks";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import {
  auditionSettingsValidationMessage,
  auditionSettingsStoreMessage,
  authorizeCalendarRoute,
} from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/rsvp-tokens", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = generateRsvpTokensRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid event and profile IDs are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      return context.json({
        ...(await generateRsvpTokens(
          context.env,
          authorization.organizationId,
          body.data.eventId,
          body.data.profileIds,
        )),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "RSVP tokens could not be generated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/poll-tokens", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = generatePollTokensRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid poll and profile IDs are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      return context.json({
        ...(await generatePollTokens(
          context.env,
          authorization.organizationId,
          body.data.pollId,
          body.data.profileIds,
        )),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Poll tokens could not be generated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/player-tokens", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = generatePlayerTokensRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid event and profile IDs are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      return context.json({
        ...(await generatePlayerTokens(
          context.env,
          authorization.organizationId,
          body.data.eventId,
          body.data.profileIds,
        )),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Player tokens could not be generated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/audition-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/audition/settings");
      url.searchParams.set("organizationId", authorization.organizationId);
      const response = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      ).fetch(url);
      const settings = organizationAuditionSettingsSchema.safeParse(await response.json());
      if (!response.ok || !settings.success) throw new Error("invalid_settings");
      return context.json({ ...settings.data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Audition settings could not be retrieved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/audition-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationAuditionSettingsSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: auditionSettingsValidationMessage(body.error),
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      );
      const response = await stub.fetch(
        "https://organization.internal/internal/audition/settings",
        {
          body: JSON.stringify({
            ...body.data,
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const code =
          typeof payload === "object" &&
          payload !== null &&
          "code" in payload &&
          typeof payload.code === "string"
            ? payload.code
            : "audition_settings_update_failed";
        const status = response.status === 400 || response.status === 409 ? response.status : 503;
        return context.json(
          {
            code,
            message: auditionSettingsStoreMessage(code, response.status),
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          status,
        );
      }
      const settings = organizationAuditionSettingsSchema.safeParse(await response.json());
      if (!settings.success) throw new Error("invalid_settings");
      return context.json({ ...settings.data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message:
            "The Organization could not confirm the saved audition settings. Refresh and try again.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
