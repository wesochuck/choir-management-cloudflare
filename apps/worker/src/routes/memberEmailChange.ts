import {
  memberEmailChangeConfirmationRequestSchema,
  memberEmailChangeRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";

import { beginEmailChange, confirmEmailChange, EmailChangeError } from "../auth/emailChange";
import { validateStartupConfig } from "../env";
import { linkedOrganizationProfileId } from "../tenancy/linkedOrganizationProfile";

import type { Context, Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, resolveCanonicalOrganizationId } from "./helpers";

function emailChangeFailure(
  context: Context<WorkerHonoEnvironment>,
  error: unknown,
  fallbackMessage: string,
): Response {
  if (error instanceof EmailChangeError) {
    return context.json(
      { code: error.code, message: error.message, requestId: context.get("requestId") },
      error.status,
    );
  }
  console.error(
    JSON.stringify({
      errorType: error instanceof Error ? error.name : "UnknownError",
      event: "member_email_change_route_error",
      requestId: context.get("requestId"),
    }),
  );
  return context.json(
    {
      code: "service_unavailable",
      message: fallbackMessage,
      requestId: context.get("requestId"),
    } satisfies ProblemDetails,
    503,
  );
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/singer/profile/email-change", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = memberEmailChangeRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Enter a valid new email address.",
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
          message: "A linked Organization Profile is required for self-service.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    try {
      const result = await beginEmailChange(context.env, {
        confirmationOrigin: new URL(context.req.url).origin,
        httpRequestId: context.get("requestId"),
        newEmail: body.data.email,
        organizationId: authorization.organizationId,
        userId: authorization.userId,
      });
      return context.json({ ...result, status: "pending" as const });
    } catch (error: unknown) {
      return emailChangeFailure(
        context,
        error,
        "The email change could not be started. Try again shortly.",
      );
    }
  });

  router.post("/api/account/email-change/confirm", async (context) => {
    validateStartupConfig(context.env);
    const organizationId = await resolveCanonicalOrganizationId(
      new URL(context.req.url),
      context.env,
    );
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "This email change link is no longer available on this host.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const body = memberEmailChangeConfirmationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid email change link is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const result = await confirmEmailChange(context.env, {
        httpRequestId: context.get("requestId"),
        organizationId,
        token: body.data.token,
      });
      return context.json({ ...result, status: "confirmed" as const });
    } catch (error: unknown) {
      return emailChangeFailure(
        context,
        error,
        "The email change could not be confirmed. Request a new link if needed.",
      );
    }
  });
}
