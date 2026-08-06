import { type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import {
  assertEmailProviderRecipientAvailable,
  EmailRecipientSuppressedError,
} from "../communications/emailFeedback";
import {
  resendOrganizationTicketConfirmation,
  refundFakeTicketPurchase,
  TicketingError,
} from "../organization/organizationTicketing";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/tickets/:purchaseId/refund", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const purchaseId = z.uuid().safeParse(context.req.param("purchaseId"));
    if (!purchaseId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid ticket order is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const order = await refundFakeTicketPurchase(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        purchaseId.data,
      );
      return context.json({ ...order, requestId: context.get("requestId") });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof TicketingError ? error.code : "ticket_refund_unavailable",
          message:
            error instanceof TicketingError
              ? error.message
              : "The ticket order could not be refunded.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof TicketingError && error.status === 404
          ? 404
          : error instanceof TicketingError && error.status === 409
            ? 409
            : 503,
      );
    }
  });

  router.post("/api/organization/tickets/:purchaseId/confirmation", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const purchaseId = z.uuid().safeParse(context.req.param("purchaseId"));
    if (!purchaseId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid ticket order is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const body = z
      .object({ recipientEmail: z.email().optional() })
      .safeParse(await context.req.json<unknown>().catch(() => ({})));
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid recipient email is required when overriding the ticket destination.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      if (body.data.recipientEmail) {
        await assertEmailProviderRecipientAvailable(
          context.env.CONTROL_DB,
          body.data.recipientEmail,
        );
      }
      await resendOrganizationTicketConfirmation(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        purchaseId.data,
        body.data.recipientEmail,
      );
      return context.json({ queued: true, requestId: context.get("requestId") });
    } catch (error: unknown) {
      if (error instanceof EmailRecipientSuppressedError) {
        return context.json(
          { code: error.code, message: error.message, requestId: context.get("requestId") },
          error.status,
        );
      }
      return context.json(
        {
          code: error instanceof TicketingError ? error.code : "ticket_confirmation_unavailable",
          message:
            error instanceof TicketingError
              ? error.message
              : "The ticket confirmation could not be queued.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof TicketingError && error.status === 404
          ? 404
          : error instanceof TicketingError && error.status === 409
            ? 409
            : 503,
      );
    }
  });
}
