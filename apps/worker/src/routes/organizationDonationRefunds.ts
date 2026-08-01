import { type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import { DonationError, refundOrganizationDonation } from "../organization/organizationDonations";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/donations/:donationId/refund", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const donationId = z.uuid().safeParse(context.req.param("donationId"));
    if (!donationId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid donation is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const donation = await refundOrganizationDonation(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        donationId.data,
      );
      return context.json({ ...donation, requestId: context.get("requestId") });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof DonationError ? error.code : "donation_refund_unavailable",
          message:
            error instanceof DonationError ? error.message : "The donation could not be refunded.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof DonationError && error.status === 404
          ? 404
          : error instanceof DonationError && error.status === 409
            ? 409
            : 503,
      );
    }
  });
}
