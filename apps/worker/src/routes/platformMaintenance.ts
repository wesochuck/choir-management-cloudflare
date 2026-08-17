import { type ProblemDetails } from "@choir/contracts";
import { z } from "zod";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, setupFailureStatus } from "./helpers";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";

const statusAutomationFixtureRequestSchema = z.object({ profileId: z.uuid() });

function stagingStatusAutomationFixtureEnabled(env: {
  readonly APP_ENV: string;
  readonly STATUS_AUTOMATION_FIXTURE_MODE?: string | undefined;
}): boolean {
  return env.APP_ENV === "staging" && env.STATUS_AUTOMATION_FIXTURE_MODE === "enabled";
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/maintenance/run", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        "https://organization.internal/internal/scheduler/run-now",
        {
          body: JSON.stringify({ force: true, organizationId: authorization.organizationId }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return context.json(
          {
            code: "maintenance_unavailable",
            message: "Organization maintenance could not be run.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }
      const result = z
        .object({
          enqueuedJobCount: z.number().int().nonnegative(),
          organizationId: z.string().min(1),
          ranAt: z.string(),
        })
        .safeParse(body);
      if (!result.success) throw new Error("maintenance_result_invalid");
      return context.json({ ...result.data, requestId: context.get("requestId"), success: true });
    } catch {
      return context.json(
        {
          code: "maintenance_unavailable",
          message: "Organization maintenance could not be run.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/platform/maintenance/status-automation-fixture", async (context) => {
    if (!stagingStatusAutomationFixtureEnabled(context.env)) {
      return context.json({ code: "not_found" }, 404);
    }
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const parsed = statusAutomationFixtureRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          code: "invalid_status_automation_fixture",
          message: "A valid staging Status automation fixture Profile is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        "https://organization.internal/internal/roster/status-automation-fixture",
        {
          body: JSON.stringify({
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            profileId: parsed.data.profileId,
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return context.json(
          {
            code:
              typeof body === "object" &&
              body !== null &&
              "code" in body &&
              typeof body.code === "string"
                ? body.code
                : "status_automation_fixture_unavailable",
            message: "The staging Status automation fixture could not be prepared.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          setupFailureStatus(response.status),
        );
      }
      const result = z
        .object({
          fixture: z.literal(true),
          onBreakInactiveAt: z.iso.datetime(),
          profileId: z.uuid(),
          statusChangedAt: z.iso.datetime(),
          timeoutDays: z.number().int().positive(),
        })
        .safeParse(body);
      if (!result.success || result.data.profileId !== parsed.data.profileId) {
        throw new Error("status_automation_fixture_result_invalid");
      }
      return context.json({ ...result.data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "status_automation_fixture_unavailable",
          message: "The staging Status automation fixture could not be prepared.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
