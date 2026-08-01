import {
  organizationInvitationRequestSchema,
  type OrganizationInvitationActionResponse,
  type OrganizationInvitationDetails,
  type OrganizationInvitationsResponse,
  type OrganizationInvitationSummary,
  type ProblemDetails,
} from "@choir/contracts";
import { createAuth, isCanonicalAuthHost } from "../auth/config";
import { validateStartupConfig } from "../env";
import { authorizeOrganizationMember } from "../tenancy/authorizeOrganization";
import { resolveOrganization } from "../tenancy/resolveOrganization";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import {
  ORGANIZATION_INVITATION_PAGE_SIZE,
  invitationIdSchema,
  normalizeInvitationRole,
  invitationDate,
  findInvitationForOrganization,
  recordInvitationAudit,
  ensurePendingInvitationIdentity,
  resolveCanonicalOrganizationId,
} from "./helpers";
import type { InvitationControlRow } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/invitations", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const resolvedOrganization = await resolveOrganization(requestUrl, context.env);
    if (
      !resolvedOrganization.ok ||
      resolvedOrganization.value.routeKind !== "canonical" ||
      !isCanonicalAuthHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)
    ) {
      return context.json(
        {
          code: "not_found",
          message: "Organization invitations require a canonical product hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const parsedBody = organizationInvitationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid invitation email and Organization role are required.",
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
      resolvedOrganization.value.organizationId,
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
          message: "Only Organization Owners and Administrators may invite members.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    if (parsedBody.data.role === "owner" && authorization.value.role !== "owner") {
      return context.json(
        {
          code: "forbidden",
          message: "Only an Organization Owner may invite another Owner.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const email = parsedBody.data.email.toLowerCase();
    const betterAuthRole =
      parsedBody.data.role === "administrator" ? "admin" : parsedBody.data.role;
    try {
      const invitation = await auth.api.createInvitation({
        body: {
          email,
          organizationId: resolvedOrganization.value.organizationId,
          role: betterAuthRole,
        },
        headers: context.req.raw.headers,
      });
      await ensurePendingInvitationIdentity(
        context.env.CONTROL_DB,
        auth,
        context.req.raw.headers,
        invitation.id,
        email,
      );
      await recordInvitationAudit(context.env.CONTROL_DB, {
        action: "organization.invitation.created",
        actorUserId: authorization.value.userId,
        changeSummary: { role: parsedBody.data.role, status: "pending" },
        invitationId: invitation.id,
        organizationId: resolvedOrganization.value.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json(
        {
          expiresAt: invitation.expiresAt.toISOString(),
          id: invitation.id,
          requestId: context.get("requestId"),
          status: invitation.status,
        },
        201,
      );
    } catch {
      return context.json(
        {
          code: "conflict",
          message: "The Organization invitation could not be created.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
  });

  router.get("/api/organization/invitations", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Organization invitations require a registered canonical hostname.",
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
          message: "Only Organization Owners and Administrators may view invitations.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const rows = await context.env.CONTROL_DB.prepare(
      `SELECT id, organizationId, email, role, status, expiresAt, createdAt, inviterId
     FROM invitation
     WHERE organizationId = ? AND status = 'pending' AND expiresAt > ?
     ORDER BY createdAt DESC, id DESC
     LIMIT ?`,
    )
      .bind(organizationId, Date.now(), ORGANIZATION_INVITATION_PAGE_SIZE + 1)
      .all<InvitationControlRow>();
    const invitations = rows.results
      .slice(0, ORGANIZATION_INVITATION_PAGE_SIZE)
      .flatMap((row): OrganizationInvitationSummary[] => {
        const role = normalizeInvitationRole(row.role);
        return role
          ? [
              {
                createdAt: invitationDate(row.createdAt),
                email: row.email,
                expiresAt: invitationDate(row.expiresAt),
                id: row.id,
                role,
                status: "pending",
              },
            ]
          : [];
      });
    const response: OrganizationInvitationsResponse = {
      invitations,
      requestId: context.get("requestId"),
      truncated: rows.results.length > ORGANIZATION_INVITATION_PAGE_SIZE,
    };
    return context.json(response);
  });

  router.delete("/api/organization/invitations/:invitationId", async (context) => {
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
          message: "Only Organization Owners and Administrators may cancel invitations.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
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
    if (invitation.role === "owner" && authorization.value.role !== "owner") {
      return context.json(
        {
          code: "forbidden",
          message: "Only an Organization Owner may cancel an Owner invitation.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    try {
      await auth.api.cancelInvitation({
        body: { invitationId: invitationId.data },
        headers: context.req.raw.headers,
      });
    } catch {
      return context.json(
        {
          code: "conflict",
          message: "The Organization invitation could not be canceled.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
    await recordInvitationAudit(context.env.CONTROL_DB, {
      action: "organization.invitation.canceled",
      actorUserId: authorization.value.userId,
      changeSummary: {
        from: "pending",
        role: normalizeInvitationRole(invitation.role) ?? "unknown",
        to: "canceled",
      },
      invitationId: invitationId.data,
      organizationId,
      requestId: context.get("requestId"),
    });
    const response: OrganizationInvitationActionResponse = {
      id: invitationId.data,
      requestId: context.get("requestId"),
      status: "canceled",
    };
    return context.json(response);
  });

  router.get("/api/organization/invitations/:invitationId", async (context) => {
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
    const invitationRow = await findInvitationForOrganization(
      context.env.CONTROL_DB,
      invitationId.data,
      organizationId,
    );
    if (!invitationRow) {
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
      const invitation = await auth.api.getInvitation({
        headers: context.req.raw.headers,
        query: { id: invitationId.data },
      });
      const role = normalizeInvitationRole(invitation.role);
      if (!role) {
        throw new Error("Unsupported Organization invitation role.");
      }
      const response: OrganizationInvitationDetails = {
        email: invitation.email,
        expiresAt: invitation.expiresAt.toISOString(),
        id: invitation.id,
        inviterEmail: invitation.inviterEmail,
        organizationId: invitation.organizationId,
        organizationName: invitation.organizationName,
        organizationSlug: invitation.organizationSlug,
        role,
        status: "pending",
      };
      return context.json(response);
    } catch {
      return context.json(
        {
          code: "not_found",
          message: "The pending Organization invitation was not found for this signed-in email.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
  });

  router.post("/api/organization/invitations/:invitationId/accept", async (context) => {
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
      await auth.api.acceptInvitation({
        body: { invitationId: invitationId.data },
        headers: context.req.raw.headers,
      });
    } catch {
      return context.json(
        {
          code: "conflict",
          message: "The Organization invitation could not be accepted.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
    await recordInvitationAudit(context.env.CONTROL_DB, {
      action: "organization.invitation.accepted",
      actorUserId: session.user.id,
      changeSummary: {
        from: "pending",
        role: normalizeInvitationRole(invitation.role) ?? "unknown",
        to: "accepted",
      },
      invitationId: invitationId.data,
      organizationId,
      requestId: context.get("requestId"),
    });
    const response: OrganizationInvitationActionResponse = {
      id: invitationId.data,
      requestId: context.get("requestId"),
      status: "accepted",
    };
    return context.json(response);
  });
}
