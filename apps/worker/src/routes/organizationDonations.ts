import {
  donationAttachArtworkRequestSchema,
  donationThankYouUpdateRequestSchema,
  manualDonationCreateRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import {
  attachOrganizationDonationArtwork,
  DonationError,
  listOrganizationDonations,
  readOrganizationDonationById,
  recordManualOrganizationDonation,
  updateOrganizationDonationThankYou,
} from "../organization/organizationDonations";
import { issueSignedLink } from "../security/signedLinks";

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
          organizationOrigin: new URL(context.req.url).origin,
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
        error instanceof DonationError && error.status === 404
          ? 404
          : error instanceof DonationError && error.status === 409
            ? 409
            : 503,
      );
    }
  });

  router.post("/api/organization/donations/:donationId/sponsor-link", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const donationId = context.req.param("donationId");
    if (!donationId || !z.uuid().safeParse(donationId).success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid donation ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const donation = await readOrganizationDonationById(
      context.env,
      authorization.organizationId,
      donationId,
    );
    if (!donation) {
      return context.json(
        {
          code: "donation_not_found",
          message: "Donation not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    if (!donation.includesProgramAd) {
      return context.json(
        {
          code: "donation_not_eligible_for_ad",
          message: "This donation does not include a program advertisement.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await issueSignedLink(context.env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: issuedAt + 30 * 24 * 60 * 60,
      issuedAt,
      nonce: crypto.randomUUID(),
      organizationId: authorization.organizationId,
      purpose: "donation_sponsor_artwork",
      resourceId: donation.id,
      version: 1,
    });
    const requestUrl = new URL(context.req.url);
    const link = `${requestUrl.origin}/donate/sponsor?token=${encodeURIComponent(token)}`;
    return context.json({
      link,
      requestId: context.get("requestId"),
      token,
    });
  });

  router.post("/api/organization/donations/:donationId/artwork", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const donationId = context.req.param("donationId");
    if (!donationId || !z.uuid().safeParse(donationId).success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid donation ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = donationAttachArtworkRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid artworkFileId is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const donation = await attachOrganizationDonationArtwork(context.env, {
        actorType: "organization_member",
        actorUserId: authorization.userId,
        donationId,
        fileId: parsed.data.artworkFileId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({ donation, requestId: context.get("requestId") });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof DonationError ? error.code : "artwork_attach_failed",
          message:
            error instanceof DonationError
              ? error.message
              : "The artwork could not be attached to the donation.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof DonationError && error.status === 404
          ? 404
          : error instanceof DonationError && error.status === 400
            ? 400
            : 503,
      );
    }
  });
}
