import {
  donationThankYouUpdateRequestSchema,
  manualDonationCreateRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import {
  DonationError,
  listOrganizationDonations,
  recordManualOrganizationDonation,
  updateOrganizationDonationThankYou,
} from "../organization/organizationDonations";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/donations", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const donations = await listOrganizationDonations(context.env, authorization.organizationId);
      return context.json({ donations, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Donations are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/donations/manual", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = manualDonationCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Invalid manual donation payload.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const donation = await recordManualOrganizationDonation(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        parsed.data,
      );
      return context.json({ donation, requestId: context.get("requestId") }, 201);
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof DonationError ? error.code : "manual_donation_failed",
          message:
            error instanceof DonationError
              ? error.message
              : "The manual donation could not be recorded.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof DonationError && error.status === 400
          ? 400
          : error instanceof DonationError && error.status === 404
            ? 404
            : error instanceof DonationError && error.status === 409
              ? 409
              : 503,
      );
    }
  });

  router.post("/api/organization/donations/thank-you", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = donationThankYouUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Invalid thank-you update payload.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const donation = await updateOrganizationDonationThankYou(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        parsed.data,
      );
      return context.json({ donation, requestId: context.get("requestId") });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof DonationError ? error.code : "thank_you_update_failed",
          message:
            error instanceof DonationError
              ? error.message
              : "The thank-you letter status could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof DonationError && error.status === 404 ? 404 : 503,
      );
    }
  });
}
