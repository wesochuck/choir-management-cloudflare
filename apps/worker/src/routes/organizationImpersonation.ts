import {
  organizationImpersonationStartRequestSchema,
  type OrganizationImpersonationStatusResponse,
  type ProblemDetails,
} from "@choir/contracts";
import {
  createImpersonationToken,
  formatImpersonationClearCookie,
  formatImpersonationSetCookie,
  verifyImpersonationCookie,
} from "../auth/impersonation";
import { readOrganizationMemberProfile } from "../organization/profiles";
import { validateStartupConfig } from "../env";

import type { Hono } from "hono";
import type { WorkerHonoEnvironment } from "./helpers";
import { authorizeCalendarRoute } from "./helpers";

interface TargetRoleRow {
  readonly role: string;
}

function isSecureRequest(requestUrl: URL, appEnv: string): boolean {
  return requestUrl.protocol === "https:" || appEnv !== "local";
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/impersonation/status", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    validateStartupConfig(context.env);
    const verified = await verifyImpersonationCookie(
      context.env.SIGNED_LINK_SECRET,
      authorization.organizationId,
      authorization.userId,
      authorization.sessionId,
      context.req.raw.headers.get("cookie") ?? undefined,
    );
    if (!verified.active || !verified.impersonatedProfileId) {
      return context.json({
        active: false,
        requestId: context.get("requestId"),
      } satisfies OrganizationImpersonationStatusResponse);
    }
    try {
      const profile = await readOrganizationMemberProfile(
        context.env,
        authorization.organizationId,
        verified.impersonatedProfileId,
      );
      return context.json({
        active: true,
        expiresAt: verified.expiresAt ?? undefined,
        impersonatedProfile: {
          displayName: profile.displayName,
          id: profile.id,
          voicePart: profile.voicePart,
        },
        requestId: context.get("requestId"),
      } satisfies OrganizationImpersonationStatusResponse);
    } catch {
      return context.json({
        active: false,
        requestId: context.get("requestId"),
      } satisfies OrganizationImpersonationStatusResponse);
    }
  });

  router.post("/api/organization/impersonation", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    if (!authorization.sessionId) {
      return context.json(
        {
          code: "unauthorized",
          message: "An active authenticated session is required to begin impersonation.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        401,
      );
    }
    const body = organizationImpersonationStartRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid member profile ID is required to begin impersonation.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const config = validateStartupConfig(context.env);
    let targetProfile;
    try {
      targetProfile = await readOrganizationMemberProfile(
        context.env,
        authorization.organizationId,
        body.data.profileId,
      );
    } catch {
      return context.json(
        {
          code: "not_found",
          message: "The requested member profile could not be found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const targetMembership = await context.env.CONTROL_DB.prepare(
      `SELECT role FROM member WHERE organizationId = ? AND profileId = ? LIMIT 1`,
    )
      .bind(authorization.organizationId, body.data.profileId)
      .first<TargetRoleRow>();

    if (
      targetMembership &&
      (targetMembership.role === "admin" || targetMembership.role === "owner")
    ) {
      return context.json(
        {
          code: "forbidden",
          message: "Administrators cannot impersonate other Administrators or Owners.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const { expiresAt, token } = await createImpersonationToken(
      context.env.SIGNED_LINK_SECRET,
      authorization.organizationId,
      body.data.profileId,
      authorization.userId,
      authorization.sessionId,
    );

    await context.env.CONTROL_DB.prepare(
      `INSERT INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, 'organization.impersonation.started', 'organization_member_profile', ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        authorization.userId,
        authorization.organizationId,
        body.data.profileId,
        context.get("requestId"),
        JSON.stringify({ expiresAt, profileId: body.data.profileId }),
        new Date().toISOString(),
      )
      .run();

    const requestUrl = new URL(context.req.url);
    const secure = isSecureRequest(requestUrl, config.APP_ENV);
    const cookieHeader = formatImpersonationSetCookie(token, secure);

    return context.json(
      {
        active: true,
        expiresAt,
        impersonatedProfile: {
          displayName: targetProfile.displayName,
          id: targetProfile.id,
          voicePart: targetProfile.voicePart,
        },
        requestId: context.get("requestId"),
      } satisfies OrganizationImpersonationStatusResponse,
      200,
      { "Set-Cookie": cookieHeader },
    );
  });

  router.post("/api/organization/impersonation/stop", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (authorization.ok && authorization.sessionId) {
      const verified = await verifyImpersonationCookie(
        context.env.SIGNED_LINK_SECRET,
        authorization.organizationId,
        authorization.userId,
        authorization.sessionId,
        context.req.raw.headers.get("cookie") ?? undefined,
      );
      if (verified.active && verified.impersonatedProfileId) {
        await context.env.CONTROL_DB.prepare(
          `INSERT INTO platform_audit_events
            (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
           VALUES (?, ?, ?, 'organization.impersonation.stopped', 'organization_member_profile', ?, ?, ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            authorization.userId,
            authorization.organizationId,
            verified.impersonatedProfileId,
            context.get("requestId"),
            JSON.stringify({
              profileId: verified.impersonatedProfileId,
              stoppedAt: new Date().toISOString(),
            }),
            new Date().toISOString(),
          )
          .run();
      }
    }

    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const secure = isSecureRequest(requestUrl, config.APP_ENV);
    const clearCookie = formatImpersonationClearCookie(secure);

    return context.json(
      {
        active: false,
        requestId: context.get("requestId"),
      } satisfies OrganizationImpersonationStatusResponse,
      200,
      { "Set-Cookie": clearCookie },
    );
  });
}
