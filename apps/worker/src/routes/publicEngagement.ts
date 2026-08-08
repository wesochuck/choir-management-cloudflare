import {
  communicationUnsubscribeRequestSchema,
  publicAuditionInquiryRequestSchema,
  publicAuditionSubmitRequestSchema,
  publicAuditionSettingsSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import { validateStartupConfig } from "../env";
import { unsubscribeOrganizationProfile } from "../organization/organizationCommunications";
import { verifySignedLinkScope } from "../security/signedLinks";
import { privateFileIdSchema, readPrivateOrganizationFile } from "../storage/privateFiles";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import {
  resolvePlayerDetails,
  resolvePublicPlayerPlaylist,
} from "../organization/organizationPlayerLinks";
import {
  resolveAuditionDetails,
  submitAuditionUpdate,
} from "../organization/organizationAuditions";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { isErrorResponse, submitPublicAuditionInquiry } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/public/player-details", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Player is not available for this hostname.",
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
          message: "A valid player link is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const details = await resolvePlayerDetails(
      context.env,
      resolved.value.organizationId,
      body.data.token,
    );
    if (isErrorResponse(details)) {
      const status: number = typeof details.status === "number" ? details.status : 404;
      return context.json(
        {
          code: details.code,
          message:
            details.code === "invalid_link"
              ? "This player link is invalid or expired."
              : "Player details not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        status as Parameters<typeof context.json>[1],
      );
    }
    return context.json({ ...details, requestId: context.get("requestId") });
  });

  router.get("/api/public/player/media/:fileId", async (context) => {
    const requestIdValue = context.get("requestId");
    const token = context.req.query("token");
    if (!token) {
      return context.json(
        {
          code: "missing_token",
          message: "A player link is required.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Player is not available for this hostname.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    const fileId = privateFileIdSchema.safeParse(context.req.param("fileId"));
    if (!fileId.success) {
      return context.json(
        {
          code: "file_not_found",
          message: "The requested file was not found.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    const envelope =
      (await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, token, {
        expectedOrganizationId: resolved.value.organizationId,
        expectedPurpose: "player",
      })) ??
      (await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, token, {
        expectedOrganizationId: resolved.value.organizationId,
        expectedPurpose: "player_public",
      }));
    if (!envelope?.resourceId) {
      return context.json(
        {
          code: "invalid_link",
          message: "This player link is invalid or expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    const playerDetails =
      envelope.purpose === "player_public"
        ? await resolvePublicPlayerPlaylist(context.env, resolved.value.organizationId, token)
        : await resolvePlayerDetails(context.env, resolved.value.organizationId, token);
    const mediaScope = z
      .object({
        items: z.array(
          z.object({
            trackFileIds: z.record(z.string(), z.string()),
          }),
        ),
      })
      .safeParse(playerDetails);
    if (
      !mediaScope.success ||
      !mediaScope.data.items.some(({ trackFileIds }) =>
        Object.values(trackFileIds).includes(fileId.data),
      )
    ) {
      return context.json(
        {
          code: "file_not_found",
          message: "The requested file was not found.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const file = await readPrivateOrganizationFile(
        context.env,
        resolved.value.organizationId,
        fileId.data,
      );
      if (!file) {
        return context.json(
          {
            code: "file_not_found",
            message: "The requested file was not found.",
            requestId: requestIdValue,
          } satisfies ProblemDetails,
          404,
        );
      }
      return new Response(file.object.body, {
        headers: {
          "cache-control": "private, max-age=3600",
          "content-type": file.metadata.contentType,
          "content-length": String(file.metadata.sizeBytes),
        },
      });
    } catch {
      return context.json(
        {
          code: "file_not_found",
          message: "The requested file was not found.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
  });

  router.get("/api/public/audition-settings", async (context) => {
    const requestIdValue = context.get("requestId");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Auditions are not available for this hostname.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/audition/public-settings");
      url.searchParams.set("organizationId", resolved.value.organizationId);
      const response = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(resolved.value.organizationId),
      ).fetch(url);
      const settings = publicAuditionSettingsSchema.safeParse(await response.json());
      if (!response.ok || !settings.success) throw new Error("invalid_settings");
      return context.json({ ...settings.data, requestId: requestIdValue });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Audition settings are temporarily unavailable.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/public/audition-inquiry", async (context) => {
    const requestIdValue = context.get("requestId");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Auditions are not available for this hostname.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    const body = publicAuditionInquiryRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid name and email are required.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }
    return submitPublicAuditionInquiry(
      context.env,
      resolved.value.organizationId,
      body.data,
      requestIdValue,
      context.req.header("cf-connecting-ip") ?? "unknown",
    );
  });

  router.post("/api/public/audition-details", async (context) => {
    const requestIdValue = context.get("requestId");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Auditions are not available for this hostname.",
          requestId: requestIdValue,
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
          message: "A valid audition link is required.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }
    const details = await resolveAuditionDetails(
      context.env,
      resolved.value.organizationId,
      body.data.token,
    );
    if (isErrorResponse(details)) {
      return context.json(
        {
          code: "not_found",
          message: "This audition link is invalid or expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json(details);
  });

  router.post("/api/public/audition-submit", async (context) => {
    const requestIdValue = context.get("requestId");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Auditions are not available for this hostname.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    const body = publicAuditionSubmitRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid audition link is required.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    }
    const result = await submitAuditionUpdate(
      context.env,
      resolved.value.organizationId,
      body.data.token,
      body.data.availabilityNotes,
      body.data.voicePart,
    );
    if (isErrorResponse(result)) {
      return context.json(
        {
          code: "not_found",
          message: "This audition link is invalid or expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json(result);
  });

  router.post("/api/public/unsubscribe", async (context) => {
    const requestIdValue = context.get("requestId");
    const body = communicationUnsubscribeRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success)
      return context.json(
        {
          code: "invalid_unsubscribe_link",
          message: "This unsubscribe link is invalid or expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok)
      return context.json(
        {
          code: "not_found",
          message: "This unsubscribe link is invalid or expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    const envelope = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, body.data.token, {
      expectedOrganizationId: resolved.value.organizationId,
      expectedPurpose: "unsubscribe",
    });
    const profileId = z.uuid().safeParse(envelope?.subjectId);
    if (envelope?.revocation !== "email-v1" || !profileId.success)
      return context.json(
        {
          code: "invalid_unsubscribe_link",
          message: "This unsubscribe link is invalid or expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        400,
      );
    try {
      await unsubscribeOrganizationProfile(
        context.env,
        resolved.value.organizationId,
        profileId.data,
        requestIdValue,
      );
      return context.json({ requestId: requestIdValue, success: true as const });
    } catch {
      return context.json(
        {
          code: "not_found",
          message: "This unsubscribe link is invalid or expired.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
  });

  router.get("/api/public/player/playlist", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const token = context.req.query("token") ?? "";
    if (!resolved.ok || token.length === 0 || token.length > 4_096) {
      return context.json(
        {
          code: "invalid_link",
          message: "This player link is invalid or expired.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const details = await resolvePublicPlayerPlaylist(
      context.env,
      resolved.value.organizationId,
      token,
    );
    if (isErrorResponse(details)) {
      return context.json(
        {
          code: details.code,
          message: "This player link is invalid or expired.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const playlist = z
      .object({
        eventId: z.uuid(),
        eventStartsAt: z.iso.datetime(),
        eventTitle: z.string().min(1).max(500),
        items: z.array(z.record(z.string(), z.unknown())).max(500),
        performerLabel: z.string().trim().min(1).max(50).default("Performer"),
      })
      .safeParse(details);
    if (!playlist.success) {
      return context.json(
        {
          code: "player_playlist_unavailable",
          message: "Practice tracks are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    return context.json({
      allPieces: playlist.data.items,
      event: {
        date: playlist.data.eventStartsAt,
        id: playlist.data.eventId,
        title: playlist.data.eventTitle,
      },
      pieces: playlist.data.items,
      performerLabel: playlist.data.performerLabel,
      requestId: context.get("requestId"),
      setList: playlist.data.items,
      voiceParts: [],
    });
  });
}
