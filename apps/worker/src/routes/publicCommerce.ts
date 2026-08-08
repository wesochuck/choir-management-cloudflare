import {
  publicQuickRsvpRequestSchema,
  publicPollSubmitRequestSchema,
  publicTicketDiscountAvailabilityRequestSchema,
  ticketCheckoutQuoteRequestSchema,
  ticketCheckoutRequestSchema,
  donationCheckoutRequestSchema,
  donationSettingsSchema,
  ticketConfirmationSettingsSchema,
  transactionFeeSettingsSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import {
  assertEmailProviderRecipientAvailable,
  assertEmailProviderRecipientsAvailable,
  EmailRecipientSuppressedError,
} from "../communications/emailFeedback";
import { validateStartupConfig } from "../env";
import {
  readPublishedOrganization,
  readPublishedOrganizationMedia,
} from "../publication/publishOrganization";
import { verifySignedLinkScope } from "../security/signedLinks";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import {
  createPublicTicketCheckout,
  quotePublicTicketCheckout,
  readPublicTicketDiscountAvailability,
  readPublicTicketPurchase,
  TicketingError,
} from "../organization/organizationTicketing";
import {
  createDonationCheckoutSession,
  DonationError,
  readPublicDonationReceipt,
} from "../organization/organizationDonations";
import { resolveRsvpDetails, submitQuickRsvp } from "../organization/organizationRsvpLinks";
import { queueRsvpDeclineNotice } from "../organization/rsvpDeclineNotifications";
import { resolvePollDetails, submitPollResponse } from "../organization/organizationPollLinks";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { isErrorResponse } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/public/projection", async (context) => {
    validateStartupConfig(context.env);
    const resolvedOrganization = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolvedOrganization.ok) {
      return context.json(
        {
          code: "not_found",
          message: "No published Organization website is available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const published = await readPublishedOrganization(
      context.env,
      resolvedOrganization.value.organizationId,
    );
    if (!published) {
      return context.json(
        {
          code: "not_found",
          message: "No published Organization website is available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    context.header("etag", published.httpEtag);
    context.header("vary", "Host");
    if (context.req.header("if-none-match") === published.httpEtag) {
      return context.body(null, 304);
    }
    return context.json(published.projection);
  });

  router.get("/api/public/commerce-projection", async (context) => {
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
    const url = new URL("https://organization.internal/internal/website/commerce-projection");
    url.searchParams.set("organizationId", resolvedOrganization.value.organizationId);
    const response = await context.env.ORGANIZATION_STORE.get(
      context.env.ORGANIZATION_STORE.idFromName(resolvedOrganization.value.organizationId),
    ).fetch(url);
    if (!response.ok) {
      return context.json(
        {
          code: "service_unavailable",
          message: "Ticketing is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    return context.json(await response.json());
  });

  router.get("/api/public/transaction-fee-settings", async (context) => {
    validateStartupConfig(context.env);
    const resolvedOrganization = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolvedOrganization.ok) {
      return context.json(
        {
          code: "not_found",
          message: "No published Organization website is available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/transaction-fee-settings");
      url.searchParams.set("organizationId", resolvedOrganization.value.organizationId);
      const response = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(resolvedOrganization.value.organizationId),
      ).fetch(url);
      const settings = transactionFeeSettingsSchema.safeParse(await response.json());
      if (!response.ok || !settings.success) throw new Error("invalid_settings");
      return context.json({ ...settings.data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Transaction fee settings are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

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
      const response = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(resolvedOrganization.value.organizationId),
      ).fetch(url);
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

  router.get("/api/public/media/:version/:fileId", async (context) => {
    validateStartupConfig(context.env);
    const version = z.coerce.number().int().positive().safeParse(context.req.param("version"));
    const fileId = z.uuid().safeParse(context.req.param("fileId"));
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!version.success || !fileId.success || !resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "The published Organization image was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const object = await readPublishedOrganizationMedia(
      context.env,
      resolved.value.organizationId,
      version.data,
      fileId.data,
    );
    if (!object) {
      return context.json(
        {
          code: "not_found",
          message: "The published Organization image was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    context.header("etag", object.httpEtag);
    context.header("vary", "Host");
    if (context.req.header("if-none-match") === object.httpEtag) return context.body(null, 304);
    context.header("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
    return context.body(object.body);
  });

  router.post("/api/public/donations/checkout", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const checkout = donationCheckoutRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Donations are not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    if (!checkout.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid donation details are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      await assertEmailProviderRecipientsAvailable(context.env.CONTROL_DB, [
        checkout.data.buyerEmail,
        checkout.data.tributeNotifyEmail,
      ]);
      return context.json(
        await createDonationCheckoutSession(
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
          code: error instanceof DonationError ? error.code : "donation_checkout_unavailable",
          message:
            error instanceof DonationError
              ? error.message
              : "Online donation checkout is not available right now.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof DonationError && (error.status === 409 || error.status === 501)
          ? error.status
          : 503,
      );
    }
  });

  router.get("/api/public/donation-settings", async (context) => {
    const requestIdValue = context.get("requestId");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Donations are not available for this hostname.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/donations/settings");
      url.searchParams.set("organizationId", resolved.value.organizationId);
      const response = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(resolved.value.organizationId),
      ).fetch(url);
      const settings = donationSettingsSchema.safeParse(await response.json());
      if (!response.ok || !settings.success) throw new Error("invalid_settings");
      return context.json({ ...settings.data, requestId: requestIdValue });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Donation settings are temporarily unavailable.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/public/donation-receipt", async (context) => {
    const requestIdValue = context.get("requestId");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const token = context.req.query("token")?.trim() ?? "";
    if (!resolved.ok || !token) {
      return context.json(
        {
          code: "donation_receipt_not_found",
          message: "Donation receipt not found.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const receipt = await readPublicDonationReceipt(
        context.env,
        resolved.value.organizationId,
        token,
      );
      return context.json({ ...receipt, requestId: requestIdValue });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof DonationError ? error.code : "donation_receipt_unavailable",
          message: "Donation receipt not found.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        error instanceof DonationError && error.status === 404 ? 404 : 503,
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
    } catch {
      return context.json(
        {
          code: "not_found",
          message: "Ticket order not found.",
          requestId: context.get("requestId"),
        },
        404,
      );
    }
  });

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
