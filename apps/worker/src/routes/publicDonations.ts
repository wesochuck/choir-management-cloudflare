import {
  donationCheckoutRequestSchema,
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
import { verifySignedLinkScope } from "../security/signedLinks";
import {
  MAX_PRIVATE_FILE_BYTES,
  readPrivateOrganizationFile,
  uploadPrivateOrganizationFile,
} from "../storage/privateFiles";
import {
  ALLOWED_ARTWORK_MIME_TYPES,
  decodePrivateFileName,
  privateFileDownloadResponse,
  sniffArtworkMimeType,
} from "./helpers";
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

  // eslint-disable-next-line complexity -- Validates file size, MIME sniffing, and tenant storage for pre-checkout artwork.
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

    const levelId = context.req.header("x-donation-level-id")?.trim() ?? "";
    const fileName = decodePrivateFileName(context.req.header("x-file-name") ?? undefined);
    const declaredContentType = context.req
      .header("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();

    if (
      !levelId ||
      !fileName ||
      !declaredContentType ||
      !ALLOWED_ARTWORK_MIME_TYPES.has(declaredContentType)
    ) {
      return context.json(
        {
          code: "validation_failed",
          message:
            "A qualifying donation level ID, valid filename, and supported image or PDF format are required.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }

    // Verify level exists and includes program ad
    try {
      const url = new URL("https://organization.internal/internal/donations/settings");
      url.searchParams.set("organizationId", resolved.value.organizationId);
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, resolved.value.organizationId),
        url,
      );
      const settings = donationSettingsSchema.safeParse(await response.json());
      const level = settings.success ? settings.data.levels.find((l) => l.id === levelId) : null;
      if (!level?.includesProgramAd) {
        return context.json(
          {
            code: "level_not_eligible_for_ad",
            message: "The selected donation level does not include a program advertisement.",
            requestId: requestIdValue,
          } satisfies ProblemDetails,
          400,
        );
      }
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Donation verification is temporarily unavailable.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }

    const bodyBuffer = await context.req.raw.arrayBuffer().catch(() => null);
    if (
      !bodyBuffer ||
      bodyBuffer.byteLength === 0 ||
      bodyBuffer.byteLength > MAX_PRIVATE_FILE_BYTES
    ) {
      return context.json(
        {
          code: "validation_failed",
          message: "The artwork file must be non-empty and at most 20 MB.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }

    const sniffedType = sniffArtworkMimeType(new Uint8Array(bodyBuffer.slice(0, 16)));
    if (!sniffedType || sniffedType !== declaredContentType) {
      return context.json(
        {
          code: "validation_failed",
          message: "The artwork file contents do not match the expected PDF, PNG, or JPEG format.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }

    const fileId = crypto.randomUUID();
    try {
      const uploaded = await uploadPrivateOrganizationFile(context.env, {
        actorUserId: "public_sponsor",
        body: bodyBuffer,
        contentType: sniffedType,
        fileId,
        fileName,
        organizationId: resolved.value.organizationId,
        requestId: requestIdValue,
        sizeBytes: bodyBuffer.byteLength,
      });

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

    const bodyBuffer = await context.req.raw.arrayBuffer().catch(() => null);
    if (
      !bodyBuffer ||
      bodyBuffer.byteLength === 0 ||
      bodyBuffer.byteLength > MAX_PRIVATE_FILE_BYTES
    ) {
      return context.json(
        {
          code: "validation_failed",
          message: "The artwork file must be non-empty and at most 20 MB.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }

    const sniffedType = sniffArtworkMimeType(new Uint8Array(bodyBuffer.slice(0, 16)));
    if (!sniffedType || sniffedType !== declaredContentType) {
      return context.json(
        {
          code: "validation_failed",
          message: "The artwork file contents do not match the expected PDF, PNG, or JPEG format.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }

    const fileId = crypto.randomUUID();
    try {
      const uploaded = await uploadPrivateOrganizationFile(context.env, {
        actorUserId: "public_sponsor",
        body: bodyBuffer,
        contentType: sniffedType,
        fileId,
        fileName,
        organizationId: resolved.value.organizationId,
        requestId: requestIdValue,
        sizeBytes: bodyBuffer.byteLength,
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
