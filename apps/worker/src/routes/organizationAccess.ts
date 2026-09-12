import {
  organizationMfaPolicyRequestSchema,
  organizationMfaVerificationRequestSchema,
  organizationProfileLinkRequestSchema,
  type OrganizationInvitationActionResponse,
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

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import {
  invitationIdSchema,
  normalizeInvitationRole,
  findInvitationForOrganization,
  recordInvitationAudit,
  resolveCanonicalOrganizationId,
  verifySecondFactor,
} from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/invitations/:invitationId/reject", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    const invitationId = invitationIdSchema.safeParse(context.req.param("invitationId"));
    if (!organizationId || !invitationId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The pending Organization invitation was not found.",
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
      invitationId.data,
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
        body: { invitationId: invitationId.data },
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
      invitationId: invitationId.data,
      organizationId,
      requestId: context.get("requestId"),
    });
    const response: OrganizationInvitationActionResponse = {
      id: invitationId.data,
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
      { enforceMfa: false },
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
      requestId: context.get("requestId"),
      role: authorization.value.role,
      twoFactorEnabled: status.value.twoFactorEnabled,
      twoFactorVerified: status.value.twoFactorVerified,
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
      { enforceMfa: false },
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
      `SELECT m.id, u.email, u.name, m.profileId, m.role
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
        role: "admin" | "member" | "owner";
      }>();
    const response: OrganizationMembershipsResponse = {
      memberships: rows.results.slice(0, 500).map((row) => ({
        email: row.email,
        id: row.id,
        name: row.name,
        profileId: row.profileId,
        role: row.role === "admin" ? "administrator" : row.role,
      })),
      requestId: context.get("requestId"),
      truncated: rows.results.length > 500,
    };
    return context.json(response);
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
