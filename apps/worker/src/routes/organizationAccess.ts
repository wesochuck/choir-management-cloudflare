import {
  organizationMemberRoleUpdateRequestSchema,
  organizationMfaPolicyRequestSchema,
  organizationMfaVerificationRequestSchema,
  organizationProfileLinkRequestSchema,
  type OrganizationInvitationActionResponse,
  type OrganizationMemberRoleUpdateResponse,
  type OrganizationMembershipsResponse,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import { createAuth } from "../auth/config";
import {
  getOrganizationMfaStatus,
  recordOrganizationMfaAssertion,
  setOrganizationMfaPolicy,
} from "../auth/organizationMfa";
import { validateStartupConfig } from "../env";
import { authorizeOrganizationMember } from "../tenancy/authorizeOrganization";
import { linkOrganizationProfile } from "../tenancy/linkOrganizationProfile";
import { listPublicDomains } from "../tenancy/registerPublicDomain";
import { updateOrganizationMemberRole } from "../tenancy/updateOrganizationMemberRole";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import {
  authorizeCalendarRoute,
  normalizeInvitationRole,
  findInvitationForOrganization,
  recordInvitationAudit,
  requireOrganizationInvitationScope,
  resolveCanonicalOrganizationId,
  verifySecondFactor,
} from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/invitations/:invitationId/reject", async (context) => {
    const scope = await requireOrganizationInvitationScope(context);
    if (scope instanceof Response) return scope;
    const { invitationId, organizationId, requestUrl } = scope;
    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) {
      return context.json(
        {
          code: "unauthorized",
          message: "Sign in is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        401,
      );
    }
    const invitation = await findInvitationForOrganization(
      context.env.CONTROL_DB,
      invitationId,
      organizationId,
    );
    if (invitation?.status !== "pending") {
      return context.json(
        {
          code: "not_found",
          message: "The pending Organization invitation was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      await auth.api.rejectInvitation({
        body: { invitationId },
        headers: context.req.raw.headers,
      });
    } catch {
      return context.json(
        {
          code: "conflict",
          message: "The Organization invitation could not be declined.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
    await recordInvitationAudit(context.env.CONTROL_DB, {
      action: "organization.invitation.rejected",
      actorUserId: session.user.id,
      changeSummary: {
        from: "pending",
        role: normalizeInvitationRole(invitation.role) ?? "unknown",
        to: "rejected",
      },
      invitationId,
      organizationId,
      requestId: context.get("requestId"),
    });
    const response: OrganizationInvitationActionResponse = {
      id: invitationId,
      requestId: context.get("requestId"),
      status: "rejected",
    };
    return context.json(response);
  });

  router.get("/api/organization/auth-status", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Organization authentication status requires a registered canonical hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
      { enforceMfa: false, scope: "shell" },
    );
    if (!authorization.ok || !session) {
      const code = authorization.ok ? "unauthorized" : authorization.error.code;
      const message = authorization.ok ? "Sign in is required." : authorization.error.message;
      return context.json(
        { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
        code === "unauthorized" ? 401 : 403,
      );
    }

    const status = await getOrganizationMfaStatus(context.env.CONTROL_DB, {
      organizationId,
      sessionId: session.session.id,
      userId: authorization.value.userId,
    });
    if (!status.ok) {
      return context.json(
        {
          code: status.error.code,
          message: status.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    return context.json({
      mfaRequired: status.value.mfaRequired,
      mfaSatisfied: status.value.mfaSatisfied,
      mfaSatisfiedBy: status.value.mfaSatisfiedBy,
      mfaVerifiedUntil: status.value.mfaVerifiedUntil
        ? new Date(status.value.mfaVerifiedUntil).toISOString()
        : null,
      organizationId,
      profileLinked: authorization.value.profileLinked,
      requestId: context.get("requestId"),
      role: authorization.value.role,
      twoFactorEnabled: status.value.twoFactorEnabled,
      twoFactorVerified: status.value.twoFactorVerified,
      ...(authorization.value.websiteEditor ? { websiteEditor: true } : {}),
      ...(authorization.value.websiteOnly ? { websiteOnly: true } : {}),
    });
  });

  router.patch("/api/organization/auth-policy", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Organization authentication policy requires a registered canonical hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const parsedBody = organizationMfaPolicyRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Organization MFA policy is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    if (authorization.value.role !== "owner") {
      return context.json(
        {
          code: "forbidden",
          message: "Only an Organization Owner may change the Organization MFA policy.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const updated = await setOrganizationMfaPolicy(context.env.CONTROL_DB, {
      actorUserId: authorization.value.userId,
      mfaRequired: parsedBody.data.mfaRequired,
      organizationId,
      requestId: context.get("requestId"),
    });
    if (!updated.ok) {
      return context.json(
        {
          code: updated.error.code,
          message: updated.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({
      mfaRequired: updated.value.mfaRequired,
      organizationId,
      requestId: context.get("requestId"),
    });
  });

  router.post("/api/organization/mfa/verify", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Organization MFA requires a registered canonical hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const parsedBody = organizationMfaVerificationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Organization MFA code and method are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
      { enforceMfa: false, scope: "shell" },
    );
    if (!authorization.ok || !session) {
      const code = authorization.ok ? "unauthorized" : authorization.error.code;
      const message = authorization.ok ? "Sign in is required." : authorization.error.message;
      return context.json(
        { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
        code === "unauthorized" ? 401 : 403,
      );
    }
    if (!authorization.value.mfaRequired) {
      return context.json(
        {
          code: "conflict",
          message: "This Organization does not currently require MFA.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }

    if (!(await verifySecondFactor(auth, context.req.raw.headers, parsedBody.data))) {
      return context.json(
        {
          code: "unauthorized",
          message: "Organization MFA verification failed.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        401,
      );
    }

    const assertion = await recordOrganizationMfaAssertion(context.env.CONTROL_DB, {
      method: parsedBody.data.method,
      organizationId,
      sessionId: session.session.id,
      userId: authorization.value.userId,
    });
    if (!assertion.ok) {
      return context.json(
        {
          code: assertion.error.code,
          message: assertion.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        assertion.error.code === "conflict" ? 409 : 403,
      );
    }
    return context.json({
      expiresAt: new Date(assertion.value.expiresAt).toISOString(),
      organizationId,
      requestId: context.get("requestId"),
      status: "verified" as const,
    });
  });

  router.get("/api/organization/members", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Organization Memberships require a registered canonical hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    if (authorization.value.role === "member") {
      return context.json(
        {
          code: "forbidden",
          message: "Only Organization Owners and Administrators may list Memberships.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    const rows = await context.env.CONTROL_DB.prepare(
      `SELECT m.id, m.userId, u.email, u.name, m.profileId, m.role, m.websiteEditor
     FROM member m
     INNER JOIN user u ON u.id = m.userId
     WHERE m.organizationId = ?
     ORDER BY lower(u.name), lower(u.email), m.id
     LIMIT 501`,
    )
      .bind(organizationId)
      .all<{
        email: string;
        id: string;
        name: string;
        profileId: string | null;
        role: "admin" | "member" | "owner" | "website_editor";
        userId: string;
        websiteEditor: number;
      }>();
    const response: OrganizationMembershipsResponse = {
      memberships: rows.results.slice(0, 500).map((row) => ({
        email: row.email,
        id: row.id,
        name: row.name,
        profileId: row.profileId,
        role: row.role === "admin" ? "administrator" : row.role === "owner" ? "owner" : "member",
        userId: row.userId,
        ...(row.websiteEditor === 1 || row.role === "website_editor"
          ? { websiteEditor: true }
          : {}),
        ...(row.role === "website_editor" ? { websiteOnly: true } : {}),
      })),
      requestId: context.get("requestId"),
      truncated: rows.results.length > 500,
    };
    return context.json(response);
  });

  router.put("/api/organization/members/:membershipId/website-access", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    const requestId = context.get("requestId");
    if (!authorization.ok) {
      return context.json({ ...authorization, requestId }, authorization.status);
    }
    const target = z.string().min(1).max(128).safeParse(context.req.param("membershipId"));
    const body = z
      .object({ enabled: z.boolean() })
      .safeParse(await context.req.json<unknown>().catch(() => null));
    if (!target.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Choose a Membership and access setting.",
          requestId,
        },
        400,
      );
    }
    const { organizationId, userId } = authorization;
    const actorCheck = `EXISTS (
      SELECT 1 FROM member WHERE organizationId = ? AND userId = ? AND role IN ('admin', 'owner')
    )`;
    const db = context.env.CONTROL_DB;
    const update = db
      .prepare(
        `UPDATE member SET websiteEditor = ? WHERE id = ? AND organizationId = ? AND role = 'member'
       AND ${actorCheck}`,
      )
      .bind(body.data.enabled ? 1 : 0, target.data, organizationId, organizationId, userId);
    const change = body.data.enabled
      ? update
      : db
          .prepare(
            `DELETE FROM member WHERE id = ? AND organizationId = ? AND role = 'website_editor'
       AND ${actorCheck}`,
          )
          .bind(target.data, organizationId, organizationId, userId);
    const audit = db
      .prepare(
        `INSERT INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       SELECT ?, ?, ?, 'organization.website_access.updated', 'organization_membership', ?, ?, ?, ?
       WHERE changes() > 0`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        organizationId,
        target.data,
        requestId,
        JSON.stringify({ enabled: body.data.enabled }),
        new Date().toISOString(),
      );
    const [result] = await db.batch(
      body.data.enabled ? [change, audit] : [change, audit, update, audit],
    );
    if (result?.meta.changes === 0 && body.data.enabled) {
      return context.json(
        {
          code: "not_found",
          message: "The editable Organization Membership was not found.",
          requestId,
        },
        404,
      );
    }
    return context.json({ requestId });
  });

  router.put("/api/organization/members/:membershipId/profile", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    const membershipId = z.string().min(1).max(128).safeParse(context.req.param("membershipId"));
    if (!organizationId || !membershipId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The Organization Membership was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const parsedBody = organizationProfileLinkRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Organization Profile ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    if (authorization.value.role === "member") {
      return context.json(
        {
          code: "forbidden",
          message: "Only Organization Owners and Administrators may link Profiles.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    try {
      const linked = await linkOrganizationProfile(context.env, {
        actorUserId: authorization.value.userId,
        membershipId: membershipId.data,
        organizationId,
        profileId: parsedBody.data.profileId,
        requestId: context.get("requestId"),
      });
      if (!linked.ok) {
        return context.json(
          {
            code: linked.error.code,
            message: linked.error.message,
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          linked.error.code === "conflict" ? 409 : 404,
        );
      }
      return context.json({ ...linked.value, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization Profile verification is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/members/:membershipId/role", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    const membershipId = z.string().min(1).max(128).safeParse(context.req.param("membershipId"));
    if (!organizationId || !membershipId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The Organization Membership was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const parsedBody = organizationMemberRoleUpdateRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid expected role and new role are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    if (authorization.value.role === "member") {
      return context.json(
        {
          code: "forbidden",
          message: "Only Organization Owners and Administrators may change Membership roles.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const updated = await updateOrganizationMemberRole(context.env, {
      actorRole: authorization.value.role,
      actorUserId: authorization.value.userId,
      expectedRole: parsedBody.data.expectedRole,
      membershipId: membershipId.data,
      newRole: parsedBody.data.role,
      organizationId,
      requestId: context.get("requestId"),
    });

    if (!updated.ok) {
      const status =
        updated.error.code === "not_found" ? 404 : updated.error.code === "forbidden" ? 403 : 409;
      return context.json(
        {
          code: updated.error.code,
          message: updated.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }

    const response: OrganizationMemberRoleUpdateResponse = {
      membershipId: updated.value.membershipId,
      organizationId: updated.value.organizationId,
      previousRole: updated.value.previousRole,
      requestId: context.get("requestId"),
      role: updated.value.role,
    };
    return context.json(response);
  });

  router.get("/api/organization/public-domains", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Public Website Domain settings require a registered canonical hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    if (authorization.value.role === "member") {
      return context.json(
        {
          code: "forbidden",
          message: "Only Organization Owners and Administrators may view Public Website Domains.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    return context.json({
      domains: await listPublicDomains(context.env.CONTROL_DB, organizationId),
    });
  });
}
