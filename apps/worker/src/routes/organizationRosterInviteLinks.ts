import {
  createRosterInviteLinkRequestSchema,
  type CreateRosterInviteLinkResponse,
  type ProblemDetails,
  type RevokeRosterInviteLinkResponse,
  type RosterInviteLinkShareResponse,
  type RosterInviteLinksResponse,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import {
  createRosterInviteLink,
  generateRosterInviteShareUrl,
  listRosterInviteLinks,
  revokeRosterInviteLink,
} from "../control/rosterInviteEnrollmentService";
import type { WorkerHonoEnvironment } from "./helpers";
import { authorizeCalendarRoute } from "./helpers";

const linkIdParamSchema = z.string().min(1).max(128);

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/roster-invite-links", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const body = createRosterInviteLinkRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message:
            "A valid label (up to 100 characters) and supported expiration days (1, 7, or 30) are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const requestUrl = new URL(context.req.url);
    const created = await createRosterInviteLink(context.env, {
      actorUserId: authorization.userId,
      canonicalHost: requestUrl.host,
      organizationId: authorization.organizationId,
      request: body.data,
    });

    const response: CreateRosterInviteLinkResponse = {
      expiresAt: created.expiresAt,
      id: created.id,
      requestId: context.get("requestId"),
      shareUrl: created.shareUrl,
    };
    return context.json(response, 201);
  });

  router.get("/api/organization/roster-invite-links", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const links = await listRosterInviteLinks(context.env.CONTROL_DB, authorization.organizationId);

    const response: RosterInviteLinksResponse = {
      links: [...links],
      requestId: context.get("requestId"),
    };
    return context.json(response);
  });

  router.post("/api/organization/roster-invite-links/:id/share", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const param = linkIdParamSchema.safeParse(context.req.param("id"));
    if (!param.success) {
      return context.json(
        {
          code: "invalid_link_id",
          message: "A valid link ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const requestUrl = new URL(context.req.url);
    const shareResult = await generateRosterInviteShareUrl(context.env, {
      canonicalHost: requestUrl.host,
      linkId: param.data,
      organizationId: authorization.organizationId,
    });

    if (!shareResult) {
      return context.json(
        {
          code: "not_found",
          message: "The requested roster invite link was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    context.header("cache-control", "no-store");
    const response: RosterInviteLinkShareResponse = {
      expiresAt: shareResult.expiresAt,
      id: shareResult.id,
      requestId: context.get("requestId"),
      shareUrl: shareResult.shareUrl,
    };
    return context.json(response);
  });

  router.post("/api/organization/roster-invite-links/:id/revoke", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const param = linkIdParamSchema.safeParse(context.req.param("id"));
    if (!param.success) {
      return context.json(
        {
          code: "invalid_link_id",
          message: "A valid link ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const revokedAt = await revokeRosterInviteLink(context.env.CONTROL_DB, {
      actorUserId: authorization.userId,
      linkId: param.data,
      organizationId: authorization.organizationId,
    });

    if (!revokedAt) {
      return context.json(
        {
          code: "not_found",
          message: "The requested roster invite link was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const response: RevokeRosterInviteLinkResponse = {
      id: param.data,
      requestId: context.get("requestId"),
      revokedAt,
    };
    return context.json(response);
  });
}
