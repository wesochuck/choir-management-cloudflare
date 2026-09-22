import {
  publicTicketDiscountAvailabilityRequestSchema,
  ticketCheckoutQuoteRequestSchema,
  ticketCheckoutRequestSchema,
  ticketConfirmationSettingsSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import {
  assertEmailProviderRecipientAvailable,
  EmailRecipientSuppressedError,
} from "../communications/emailFeedback";
import { validateStartupConfig } from "../env";
import {
  createPublicTicketCheckout,
  quotePublicTicketCheckout,
  readPublicTicketDiscountAvailability,
  readPublicTicketPurchase,
  TicketingError,
} from "../organization/organizationTicketing";
import { preflightCheckoutRequest, preflightTicketQuoteRequest } from "./helpers/checkoutPreflight";
import { verifySignedLinkScope } from "../security/signedLinks";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import type { WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/public/ticket-confirmation-settings", async (context) => {
    validateStartupConfig(context.env);
    const resolvedOrganization = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolvedOrganization.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Ticketing is not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/ticket-confirmation-settings");
      url.searchParams.set("organizationId", resolvedOrganization.value.organizationId);
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, resolvedOrganization.value.organizationId),
        url,
      );
      const settings = ticketConfirmationSettingsSchema.safeParse(await response.json());
      if (!response.ok || !settings.success) throw new Error("invalid_settings");
      return context.json({ ...settings.data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Ticket confirmation wording is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/public/tickets/checkout", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const checkout = ticketCheckoutRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Ticket sales are not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    if (!checkout.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid ticket order details are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const preflightError = await preflightCheckoutRequest(
      context.env,
      resolved.value.organizationId,
      "ticket_checkout",
      checkout.data.checkoutRequestId,
      checkout.data.buyerEmail,
      context.req.header("cf-connecting-ip")?.trim() ?? "unknown",
      checkout.data.turnstileToken,
      context.get("requestId"),
    );
    if (preflightError) return preflightError;
    try {
      await assertEmailProviderRecipientAvailable(context.env.CONTROL_DB, checkout.data.buyerEmail);
      return context.json(
        await createPublicTicketCheckout(
          context.env,
          resolved.value.organizationId,
          new URL(context.req.url).origin,
          checkout.data,
        ),
        201,
      );
    } catch (error: unknown) {
      if (error instanceof EmailRecipientSuppressedError) {
        return context.json(
          { code: error.code, message: error.message, requestId: context.get("requestId") },
          error.status,
        );
      }
      return context.json(
        {
          code: error instanceof TicketingError ? error.code : "ticket_checkout_unavailable",
          message:
            error instanceof TicketingError
              ? error.message
              : "Online ticket checkout is not available right now.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof TicketingError && (error.status === 409 || error.status === 422)
          ? error.status
          : 503,
      );
    }
  });

  router.get("/api/public/tickets/discount-availability", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const target = publicTicketDiscountAvailabilityRequestSchema.safeParse({
      bundleId: context.req.query("bundleId") ?? null,
      eventId: context.req.query("eventId") ?? null,
    });
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Ticket sales are not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    if (!target.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid ticket item is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const available = await readPublicTicketDiscountAvailability(
        context.env,
        resolved.value.organizationId,
        target.data,
      );
      return context.json({ hasRedeemableCode: available });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof TicketingError ? error.code : "discount_availability_unavailable",
          message:
            error instanceof TicketingError
              ? error.message
              : "Discount availability is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof TicketingError && error.status === 404 ? 404 : 503,
      );
    }
  });

  router.post("/api/public/tickets/quote", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const quote = ticketCheckoutQuoteRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Ticket sales are not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    if (!quote.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid ticket price request is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const preflightError = await preflightTicketQuoteRequest(
      context.env,
      resolved.value.organizationId,
      context.req.header("cf-connecting-ip")?.trim() ?? "unknown",
      context.get("requestId"),
    );
    if (preflightError) return preflightError;
    try {
      return context.json(
        await quotePublicTicketCheckout(context.env, resolved.value.organizationId, quote.data),
      );
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof TicketingError ? error.code : "ticket_quote_unavailable",
          message:
            error instanceof TicketingError
              ? error.message
              : "The ticket price could not be calculated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof TicketingError &&
          (error.status === 400 || error.status === 409 || error.status === 422)
          ? error.status
          : 503,
      );
    }
  });

  router.get("/api/public/tickets/order", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const token = context.req.query("token") ?? "";
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Ticket order not found.",
          requestId: context.get("requestId"),
        },
        404,
      );
    }
    const envelope = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, token, {
      expectedOrganizationId: resolved.value.organizationId,
      expectedPurpose: "ticket_receipt",
    });
    if (!envelope?.resourceId) {
      return context.json(
        {
          code: "not_found",
          message: "Ticket order not found.",
          requestId: context.get("requestId"),
        },
        404,
      );
    }
    try {
      const purchase = await readPublicTicketPurchase(
        context.env,
        resolved.value.organizationId,
        envelope.resourceId,
      );
      return context.json({ ...purchase, requestId: context.get("requestId") });
    } catch (error) {
      if (error instanceof TicketingError && error.status === 404) {
        return context.json(
          {
            code: "not_found",
            message: "Ticket order not found.",
            requestId: context.get("requestId"),
          },
          404,
        );
      }
      const status = error instanceof TicketingError && error.status === 429 ? 429 : 503;
      return context.json(
        {
          code: error instanceof TicketingError ? error.code : "ticket_order_unavailable",
          message:
            error instanceof TicketingError
              ? error.message
              : "Ticket order details are currently unavailable.",
          requestId: context.get("requestId"),
        },
        status,
      );
    }
  });
}
