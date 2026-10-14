import { type ProblemDetails } from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import { isProductBaseHost } from "../../auth/config";
import { sendPlatformEmail } from "../../auth/platformEmail";
import {
  assertEmailProviderRecipientAvailable,
  EmailRecipientSuppressedError,
} from "../../communications/emailFeedback";
import { validateStartupConfig } from "../../env";
import type { WorkerHonoEnvironment } from "../helpers";
import { authorizePlatformRead } from "./shared";

export function registerPlatformDiagnosticRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/test-smtp", async (context) => {
    const requestUrl = new URL(context.req.url);
    const config = validateStartupConfig(context.env);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Platform test endpoints are available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const authorization = await authorizePlatformRead(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Invalid request body" }, 400);
    }
    const parsed = z.object({ to: z.string().min(3).max(320) }).safeParse(body);
    if (!parsed.success || !parsed.data.to.includes("@"))
      return context.json({ error: "Invalid email address" }, 400);
    try {
      await assertEmailProviderRecipientAvailable(context.env.CONTROL_DB, parsed.data.to);
    } catch (error: unknown) {
      if (error instanceof EmailRecipientSuppressedError) {
        return context.json(
          { code: error.code, message: error.message, requestId: context.get("requestId") },
          error.status,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The email suppression list could not be checked.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    const mode: string = context.env.EXTERNAL_EFFECTS_MODE;
    if (mode === "fake") {
      return context.json({
        sent: true,
        mode: "fake",
        to: parsed.data.to,
        requestId: context.get("requestId"),
      });
    }
    try {
      await sendPlatformEmail(
        {
          CONTROL_DB: context.env.CONTROL_DB,
          PLATFORM_EMAIL: context.env.PLATFORM_EMAIL,
          PLATFORM_EMAIL_ALLOWED_RECIPIENTS: context.env.PLATFORM_EMAIL_ALLOWED_RECIPIENTS,
          PLATFORM_EMAIL_FROM: context.env.PLATFORM_EMAIL_FROM,
          PLATFORM_EMAIL_MODE: context.env.PLATFORM_EMAIL_MODE,
        },
        {
          kind: "communication-test",
          recipient: parsed.data.to,
          subject: "Platform Email Delivery Test",
          text: "This is an operator test message from the platform operations console.",
        },
      );
      return context.json({
        sent: true,
        mode: context.env.PLATFORM_EMAIL_MODE,
        to: parsed.data.to,
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("not allowlisted")) {
        return context.json(
          {
            code: "recipient_not_allowlisted",
            message: "The email recipient is not allowlisted for sandbox sending.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          403,
        );
      }
      return context.json(
        {
          code: "email_delivery_failed",
          message: "The platform test email could not be sent.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        500,
      );
    }
  });

  router.post("/api/test-sms", async (context) => {
    const requestUrl = new URL(context.req.url);
    const config = validateStartupConfig(context.env);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Platform test endpoints are available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const authorization = await authorizePlatformRead(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Invalid request body" }, 400);
    }
    const parsed = z.object({ to: z.string().min(1).max(20) }).safeParse(body);
    if (!parsed.success) return context.json({ error: "Invalid phone number" }, 400);
    const mode: string = context.env.EXTERNAL_EFFECTS_MODE;
    if (mode === "fake") {
      return context.json({
        sent: true,
        mode: "fake",
        to: parsed.data.to,
        requestId: context.get("requestId"),
      });
    }
    return context.json({ error: "Real SMS sending not configured" }, 501);
  });
}
