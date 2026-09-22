import {
  donationCheckoutRequestSchema,
  donationSettingsSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import {
  assertEmailProviderRecipientsAvailable,
  EmailRecipientSuppressedError,
} from "../communications/emailFeedback";
import { validateStartupConfig } from "../env";
import {
  createDonationCheckoutSession,
  DonationError,
  readPublicDonationReceipt,
} from "../organization/organizationDonations";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { preflightCheckoutRequest } from "./helpers/checkoutPreflight";
import type { WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
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
    const preflightError = await preflightCheckoutRequest(
      context.env,
      resolved.value.organizationId,
      "donation_checkout",
      checkout.data.checkoutRequestId,
      checkout.data.buyerEmail,
      context.req.header("cf-connecting-ip")?.trim() ?? "unknown",
      checkout.data.turnstileToken,
      context.get("requestId"),
    );
    if (preflightError) return preflightError;
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
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, resolved.value.organizationId),
        url,
      );
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
}
