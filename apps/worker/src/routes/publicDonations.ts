import {
  donationCheckoutRequestSchema,
  donationCheckoutResponseSchema,
  donationSettingsSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import {
  assertEmailProviderRecipientsAvailable,
  EmailRecipientSuppressedError,
} from "../communications/emailFeedback";
import { validateStartupConfig } from "../env";
import {
  attachOrganizationDonationArtwork,
  createDonationCheckoutSession,
  DonationError,
  readOrganizationDonationById,
  readPublicDonationReceipt,
} from "../organization/organizationDonations";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { evaluateEdgeRateLimit } from "../security/edgeRateLimit";
import { verifySignedLinkScope } from "../security/signedLinks";
import {
  MAX_PRIVATE_FILE_BYTES,
  readPrivateOrganizationFile,
  reclaimPrivateOrganizationFile,
  uploadPrivateOrganizationFile,
} from "../storage/privateFiles";
import { reclaimExpiredSponsorUploadClaims } from "../storage/sponsorArtworkCleanup";
import {
  ALLOWED_ARTWORK_MIME_TYPES,
  decodePrivateFileName,
  privateFileDownloadResponse,
} from "./helpers";
import { preflightCheckoutRequest } from "./helpers/checkoutPreflight";
import { readBoundedArtworkUpload } from "./helpers/donationArtworkUpload";
import type { WorkerHonoEnvironment } from "./helpers";

export interface PublicDonationRouteOptions {
  readonly claimTtlMs?: number | undefined;
  readonly maxArtworkBytes?: number | undefined;
  readonly maxPendingArtworkBytes?: number | undefined;
  readonly maxPendingArtworkCount?: number | undefined;
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  registerPublicDonationsRoutesWithOptions(router);
}

export function registerPublicDonationsRoutesWithOptions(
  router: Hono<WorkerHonoEnvironment>,
  options: PublicDonationRouteOptions = {},
): void {
  const maxArtworkBytes = options.maxArtworkBytes ?? MAX_PRIVATE_FILE_BYTES;
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
        donationCheckoutResponseSchema.parse(
          await createDonationCheckoutSession(
            context.env,
            resolved.value.organizationId,
            new URL(context.req.url).origin,
            checkout.data,
          ),
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
        error instanceof DonationError &&
          (error.status === 400 || error.status === 409 || error.status === 501)
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

  // eslint-disable-next-line complexity -- Enforces edge throttling, bounded streaming, MIME sniffing, and pending upload quota/claims.
  router.post("/api/public/donations/artwork/upload", async (context) => {
    validateStartupConfig(context.env);
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

    const clientIp =
      context.req.header("cf-connecting-ip") ??
      context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const rateLimited = await evaluateEdgeRateLimit({
      clientIp,
      env: context.env,
      limiterName: "PUBLIC_MUTATION_RATE_LIMITER",
      operation: "donation_artwork_upload",
      organizationId: resolved.value.organizationId,
      requestId: requestIdValue,
    });
    if (rateLimited) return rateLimited;

    const levelId = context.req.header("x-donation-level-id")?.trim() ?? "";
    const checkoutRequestId = z
      .uuid()
      .safeParse(context.req.header("x-checkout-request-id")?.trim() ?? "");
    const fileName = decodePrivateFileName(context.req.header("x-file-name") ?? undefined);
    const declaredContentType = context.req
      .header("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();

    if (
      !levelId ||
      !checkoutRequestId.success ||
      !fileName ||
      !declaredContentType ||
      !ALLOWED_ARTWORK_MIME_TYPES.has(declaredContentType)
    ) {
      return context.json(
        {
          code: "validation_failed",
          message:
            "A qualifying donation level ID, checkout request ID, valid filename, and supported image or PDF format are required.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }

    const artwork = await readBoundedArtworkUpload(
      context.req.raw,
      declaredContentType,
      maxArtworkBytes,
    );
    if (!artwork.ok) {
      return context.json(
        {
          code: artwork.code,
          message: artwork.message,
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        artwork.status,
      );
    }

    const stub = organizationStoreStub(context.env, resolved.value.organizationId);
    const fileId = crypto.randomUUID();
    let reservation: Awaited<ReturnType<typeof stub.reservePendingSponsorArtwork>>;
    try {
      reservation = await stub.reservePendingSponsorArtwork({
        checkoutRequestId: checkoutRequestId.data,
        contentHash: artwork.contentHash,
        contentType: artwork.contentType,
        fileId,
        fileName,
        levelId,
        maxPendingBytes: options.maxPendingArtworkBytes,
        maxPendingCount: options.maxPendingArtworkCount,
        organizationId: resolved.value.organizationId,
        sizeBytes: artwork.sizeBytes,
        ttlMs: options.claimTtlMs,
      });
      if (!reservation.ok && reservation.reason === "quota_exceeded") {
        await reclaimExpiredSponsorUploadClaims(context.env, resolved.value.organizationId, {
          requestId: requestIdValue,
        });
        reservation = await stub.reservePendingSponsorArtwork({
          checkoutRequestId: checkoutRequestId.data,
          contentHash: artwork.contentHash,
          contentType: artwork.contentType,
          fileId,
          fileName,
          levelId,
          maxPendingBytes: options.maxPendingArtworkBytes,
          maxPendingCount: options.maxPendingArtworkCount,
          organizationId: resolved.value.organizationId,
          sizeBytes: artwork.sizeBytes,
          ttlMs: options.claimTtlMs,
        });
      }
    } catch {
      if (artwork.body instanceof ReadableStream) {
        await artwork.body.cancel("reservation_error").catch(() => undefined);
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "Donation verification is temporarily unavailable.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }

    if (!reservation.ok) {
      if (artwork.body instanceof ReadableStream) {
        await artwork.body.cancel("reservation_rejected").catch(() => undefined);
      }
      if (reservation.reason === "level_not_eligible_for_ad") {
        return context.json(
          {
            code: "level_not_eligible_for_ad",
            message: "The selected donation level does not include a program advertisement.",
            requestId: requestIdValue,
          } satisfies ProblemDetails,
          400,
        );
      }
      if (reservation.reason === "quota_exceeded") {
        return context.json(
          {
            code: "pending_artwork_quota_exceeded",
            message: "Too many pending artwork uploads. Please try again later.",
            requestId: requestIdValue,
          } satisfies ProblemDetails,
          429,
        );
      }
      return context.json(
        {
          code: "validation_failed",
          message: "The artwork upload could not be accepted.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }

    if (reservation.reused) {
      if (artwork.body instanceof ReadableStream) {
        await artwork.body.cancel("reused_existing_claim").catch(() => undefined);
      }
      return context.json(
        {
          contentType: reservation.contentType,
          fileId: reservation.fileId,
          fileName: reservation.fileName,
          requestId: requestIdValue,
          sizeBytes: reservation.sizeBytes,
        },
        201,
      );
    }

    try {
      const uploaded = await uploadPrivateOrganizationFile(context.env, {
        actorUserId: "public_sponsor",
        body: artwork.body,
        contentType: artwork.contentType,
        fileId: reservation.fileId,
        fileName,
        organizationId: resolved.value.organizationId,
        requestId: requestIdValue,
        sizeBytes: artwork.sizeBytes,
      });

      for (const supersededFileId of reservation.supersededFileIds) {
        await reclaimPrivateOrganizationFile(context.env, {
          actorUserId: "public_sponsor",
          fileId: supersededFileId,
          organizationId: resolved.value.organizationId,
          requestId: requestIdValue,
        }).catch(() => undefined);
      }

      return context.json(
        {
          contentType: uploaded.contentType,
          fileId: uploaded.id,
          fileName: uploaded.fileName,
          requestId: requestIdValue,
          sizeBytes: uploaded.sizeBytes,
        },
        201,
      );
    } catch {
      await stub
        .releasePendingSponsorArtwork({
          checkoutRequestId: checkoutRequestId.data,
          fileId: reservation.fileId,
          organizationId: resolved.value.organizationId,
        })
        .catch(() => undefined);
      return context.json(
        {
          code: "service_unavailable",
          message: "The artwork file could not be saved safely.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/public/donations/sponsor-info", async (context) => {
    validateStartupConfig(context.env);
    const requestIdValue = context.get("requestId");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const token = context.req.query("token")?.trim() ?? "";
    if (!resolved.ok || !token) {
      return context.json(
        {
          code: "sponsor_not_found",
          message: "Sponsorship information not found.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }

    const envelope = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, token, {
      expectedOrganizationId: resolved.value.organizationId,
      expectedPurpose: "donation_sponsor_artwork",
    });
    if (!envelope?.resourceId || !z.uuid().safeParse(envelope.resourceId).success) {
      return context.json(
        {
          code: "sponsor_token_invalid",
          message: "This sponsor link is invalid or has expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }

    try {
      const donation = await readOrganizationDonationById(
        context.env,
        resolved.value.organizationId,
        envelope.resourceId,
      );
      if (!donation?.includesProgramAd) {
        return context.json(
          {
            code: "sponsor_not_found",
            message: "Sponsorship information not found.",
            requestId: requestIdValue,
          } satisfies ProblemDetails,
          404,
        );
      }
      return context.json({
        amountCents: donation.amountCents,
        artworkFileId: donation.artworkFileId,
        artworkFileName: donation.artworkFileName,
        publicationContext: donation.publicationContext,
        artworkInstructions: donation.artworkInstructions,
        artworkStatus: donation.artworkStatus,
        artworkUploadedAt: donation.artworkUploadedAt,
        buyerName: donation.buyerName,
        donationId: donation.id,
        requestId: requestIdValue,
        selectedLevelName: donation.selectedLevelName,
        sponsorName: donation.sponsorName,
        status: donation.status,
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Sponsorship information is temporarily unavailable.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  // eslint-disable-next-line complexity -- Authenticates sponsor token, validates file format, and attaches artwork to donation.
  router.post("/api/public/donations/sponsor-artwork", async (context) => {
    validateStartupConfig(context.env);
    const requestIdValue = context.get("requestId");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const token = context.req.query("token")?.trim() ?? "";
    if (!resolved.ok || !token) {
      return context.json(
        {
          code: "sponsor_not_found",
          message: "Sponsorship information not found.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }

    const envelope = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, token, {
      expectedOrganizationId: resolved.value.organizationId,
      expectedPurpose: "donation_sponsor_artwork",
    });
    if (!envelope?.resourceId || !z.uuid().safeParse(envelope.resourceId).success) {
      return context.json(
        {
          code: "sponsor_token_invalid",
          message: "This sponsor link is invalid or has expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }

    let donation;
    try {
      donation = await readOrganizationDonationById(
        context.env,
        resolved.value.organizationId,
        envelope.resourceId,
      );
      if (!donation?.includesProgramAd) {
        return context.json(
          {
            code: "sponsor_not_found",
            message: "Sponsorship information not found.",
            requestId: requestIdValue,
          } satisfies ProblemDetails,
          404,
        );
      }
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Sponsorship information is temporarily unavailable.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }

    const clientIp =
      context.req.header("cf-connecting-ip") ??
      context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const rateLimited = await evaluateEdgeRateLimit({
      clientIp,
      env: context.env,
      limiterName: "PUBLIC_MUTATION_RATE_LIMITER",
      operation: "sponsor_artwork_upload",
      organizationId: resolved.value.organizationId,
      requestId: requestIdValue,
    });
    if (rateLimited) return rateLimited;

    const fileName = decodePrivateFileName(context.req.header("x-file-name") ?? undefined);
    const declaredContentType = context.req
      .header("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();

    if (!fileName || !declaredContentType || !ALLOWED_ARTWORK_MIME_TYPES.has(declaredContentType)) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid filename and supported image or PDF format are required.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }

    const artwork = await readBoundedArtworkUpload(
      context.req.raw,
      declaredContentType,
      maxArtworkBytes,
    );
    if (!artwork.ok) {
      return context.json(
        {
          code: artwork.code,
          message: artwork.message,
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        artwork.status,
      );
    }

    const fileId = crypto.randomUUID();
    try {
      const uploaded = await uploadPrivateOrganizationFile(context.env, {
        actorUserId: "public_sponsor",
        body: artwork.body,
        contentType: artwork.contentType,
        fileId,
        fileName,
        organizationId: resolved.value.organizationId,
        requestId: requestIdValue,
        sizeBytes: artwork.sizeBytes,
      });

      const updatedDonation = await attachOrganizationDonationArtwork(context.env, {
        actorType: "public_sponsor",
        actorUserId: "public_sponsor",
        donationId: donation.id,
        fileId: uploaded.id,
        organizationId: resolved.value.organizationId,
        requestId: requestIdValue,
      });

      return context.json(
        {
          amountCents: updatedDonation.amountCents,
          artworkFileId: updatedDonation.artworkFileId,
          artworkFileName: uploaded.fileName,
          publicationContext: updatedDonation.publicationContext,
          artworkInstructions: updatedDonation.artworkInstructions,
          artworkStatus: updatedDonation.artworkStatus,
          artworkUploadedAt: updatedDonation.artworkUploadedAt,
          buyerName: updatedDonation.buyerName,
          donationId: updatedDonation.id,
          requestId: requestIdValue,
          selectedLevelName: updatedDonation.selectedLevelName,
          sponsorName: updatedDonation.sponsorName,
          status: updatedDonation.status,
        },
        200,
      );
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The artwork file could not be attached safely.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/public/donations/artwork/:fileId", async (context) => {
    validateStartupConfig(context.env);
    const requestIdValue = context.get("requestId");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const token = context.req.query("token")?.trim() ?? "";
    const fileId = context.req.param("fileId");

    if (!resolved.ok || !token || !fileId || !z.uuid().safeParse(fileId).success) {
      return context.json(
        {
          code: "artwork_not_found",
          message: "Artwork file not found.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }

    const envelope = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, token, {
      expectedOrganizationId: resolved.value.organizationId,
      expectedPurpose: "donation_sponsor_artwork",
    });
    if (!envelope?.resourceId || !z.uuid().safeParse(envelope.resourceId).success) {
      return context.json(
        {
          code: "sponsor_token_invalid",
          message: "This sponsor link is invalid or has expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }

    try {
      const donation = await readOrganizationDonationById(
        context.env,
        resolved.value.organizationId,
        envelope.resourceId,
      );
      if (donation?.artworkFileId !== fileId) {
        return context.json(
          {
            code: "artwork_not_found",
            message: "Artwork file not found.",
            requestId: requestIdValue,
          } satisfies ProblemDetails,
          404,
        );
      }

      const file = await readPrivateOrganizationFile(
        context.env,
        resolved.value.organizationId,
        fileId,
        context.req.header("range") ?? null,
      );
      if (!file) {
        return context.json(
          {
            code: "artwork_not_found",
            message: "Artwork file not found.",
            requestId: requestIdValue,
          } satisfies ProblemDetails,
          404,
        );
      }
      return privateFileDownloadResponse(file);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Artwork file is temporarily unavailable.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
