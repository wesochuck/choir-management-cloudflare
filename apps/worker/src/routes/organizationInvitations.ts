import {
  organizationInvitationRequestSchema,
  type OrganizationInvitationActionResponse,
  type OrganizationInvitationDetails,
  type OrganizationInvitationsResponse,
  type OrganizationInvitationSummary,
  type ProblemDetails,
} from "@choir/contracts";
import { createAuth, isCanonicalAuthHost } from "../auth/config";
import {
  assertEmailProviderRecipientAvailable,
  EmailRecipientSuppressedError,
} from "../communications/emailFeedback";
import { validateStartupConfig } from "../env";
import { authorizeOrganizationMember } from "../tenancy/authorizeOrganization";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import { organizationStoreStub } from "../organization/rpc/client";
import { linkOrganizationProfile } from "../tenancy/linkOrganizationProfile";

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
  requireOrganizationInvitationScope,
  resolveCanonicalOrganizationId,
} from "./helpers";
import type { InvitationControlRow } from "./helpers";

type InvitationProfileMatchStatus = "will_link" | "no_match" | "review_required";

function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function invitationProfileMatchStatus(
  env: WorkerHonoEnvironment["Bindings"],
  organizationId: string,
  email: string,
  userId: string,
): Promise<{ readonly profileId: string | null; readonly status: InvitationProfileMatchStatus }> {
  const existingMembership = await env.CONTROL_DB.prepare(
    `SELECT profileId FROM member WHERE organizationId = ? AND userId = ? LIMIT 1`,
  )
    .bind(organizationId, userId)
    .first<{ profileId: string | null }>();
  if (existingMembership?.profileId) return { profileId: null, status: "no_match" };

  const match = await organizationStoreStub(env, organizationId).resolveRosterInviteProfileMatch({
    email,
    organizationId,
    userId,
  });
  if (match.status === "no_match") return { profileId: null, status: "no_match" };
  if (match.status !== "match" || !match.profileId) {
    return { profileId: null, status: "review_required" };
  }
  const [linked, activeReconciliation] = await Promise.all([
    env.CONTROL_DB.prepare(
      `SELECT userId FROM member WHERE organizationId = ? AND profileId = ? LIMIT 1`,
    )
      .bind(organizationId, match.profileId)
      .first<{ userId: string }>(),
    env.CONTROL_DB.prepare(
      `SELECT id FROM organization_profile_reconciliations
       WHERE organization_id = ?
         AND (source_profile_id = ? OR target_profile_id = ?)
         AND state IN ('reserved', 'prepared', 'relinked', 'needs_repair')
       LIMIT 1`,
    )
      .bind(organizationId, match.profileId, match.profileId)
      .first<{ id: string }>(),
  ]);
  return (linked && linked.userId !== userId) || activeReconciliation
    ? { profileId: null, status: "review_required" }
    : { profileId: match.profileId, status: "will_link" };
}

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
      await assertEmailProviderRecipientAvailable(context.env.CONTROL_DB, email);
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
    } catch (error: unknown) {
      if (error instanceof EmailRecipientSuppressedError) {
        return context.json(
          { code: error.code, message: error.message, requestId: context.get("requestId") },
          error.status,
        );
      }
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

    const now = Date.now();
    // Better Auth's SQLite adapter stores ISO dates; older rows/tests may use milliseconds.
    // Compare within each representation instead of relying on SQLite's text/number ordering.
    const rows = await context.env.CONTROL_DB.prepare(
      `SELECT id, organizationId, email, role, status, expiresAt, createdAt, inviterId
     FROM invitation
     WHERE organizationId = ? AND status = 'pending'
       AND CASE WHEN typeof(expiresAt) IN ('integer', 'real')
         THEN expiresAt > ?
         ELSE julianday(expiresAt) > julianday(?)
       END
     ORDER BY createdAt DESC, id DESC
     LIMIT ?`,
    )
      .bind(organizationId, now, new Date(now).toISOString(), ORGANIZATION_INVITATION_PAGE_SIZE + 1)
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
        body: { invitationId },
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
      invitationId,
      organizationId,
      requestId: context.get("requestId"),
    });
    const response: OrganizationInvitationActionResponse = {
      id: invitationId,
      requestId: context.get("requestId"),
      status: "canceled",
    };
    return context.json(response);
  });

  // eslint-disable-next-line complexity -- returns pending and accepted invitation states with scoped Profile-link status
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
    if (!session.user.emailVerified) {
      return context.json(
        {
          code: "forbidden",
          message: "Verify the invited email address before opening this invitation.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
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
    if (invitationRow.status === "accepted") {
      if (
        normalizeInvitationEmail(invitationRow.email) !==
        normalizeInvitationEmail(session.user.email)
      ) {
        return context.json(
          {
            code: "not_found",
            message: "The accepted invitation is not available for this signed-in email.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const [membership, inviter, organization] = await Promise.all([
        context.env.CONTROL_DB.prepare(
          `SELECT id, profileId FROM member WHERE organizationId = ? AND userId = ? LIMIT 1`,
        )
          .bind(organizationId, session.user.id)
          .first<{ id: string; profileId: string | null }>(),
        context.env.CONTROL_DB.prepare("SELECT email FROM user WHERE id = ? LIMIT 1")
          .bind(invitationRow.inviterId)
          .first<{ email: string }>(),
        context.env.CONTROL_DB.prepare("SELECT name, slug FROM organizations WHERE id = ? LIMIT 1")
          .bind(organizationId)
          .first<{ name: string; slug: string }>(),
      ]);
      if (!membership || !inviter || !organization) {
        return context.json(
          {
            code: "not_found",
            message: "The accepted Organization invitation could not be found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const match = await invitationProfileMatchStatus(
        context.env,
        organizationId,
        invitationRow.email,
        session.user.id,
      );
      const response: OrganizationInvitationDetails = {
        email: invitationRow.email,
        expiresAt: invitationDate(invitationRow.expiresAt),
        id: invitationRow.id,
        inviterEmail: inviter.email,
        organizationId,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        profileLinkStatus: membership.profileId
          ? "linked"
          : match.status === "will_link"
            ? "pending"
            : match.status,
        profileMatchStatus: match.status,
        role: normalizeInvitationRole(invitationRow.role) ?? "member",
        status: "accepted",
      };
      return context.json(response);
    }
    let invitation: Awaited<ReturnType<typeof auth.api.getInvitation>>;
    try {
      invitation = await auth.api.getInvitation({
        headers: context.req.raw.headers,
        query: { id: invitationId.data },
      });
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
    const role = normalizeInvitationRole(invitation.role);
    if (!role) {
      throw new Error("Unsupported Organization invitation role.");
    }
    const profileMatch = await invitationProfileMatchStatus(
      context.env,
      organizationId,
      invitation.email,
      session.user.id,
    );
    const response: OrganizationInvitationDetails = {
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      id: invitation.id,
      inviterEmail: invitation.inviterEmail,
      organizationId: invitation.organizationId,
      organizationName: invitation.organizationName,
      organizationSlug: invitation.organizationSlug,
      profileMatchStatus: profileMatch.status,
      role,
      status: "pending",
    };
    return context.json(response);
  });

  // eslint-disable-next-line complexity -- accepts idempotently, links a match, and reports retry or review state
  router.post("/api/organization/invitations/:invitationId/accept", async (context) => {
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
    if (!session.user.emailVerified) {
      return context.json(
        {
          code: "forbidden",
          message: "Verify the invited email address before accepting this invitation.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    const invitation = await findInvitationForOrganization(
      context.env.CONTROL_DB,
      invitationId,
      organizationId,
    );
    if (!invitation || !["pending", "accepted"].includes(invitation.status)) {
      return context.json(
        {
          code: "not_found",
          message: "The pending Organization invitation was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    if (
      normalizeInvitationEmail(invitation.email) !== normalizeInvitationEmail(session.user.email)
    ) {
      return context.json(
        {
          code: "forbidden",
          message: "Sign in with the email address that received this invitation.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    if (invitation.status === "pending") {
      try {
        await auth.api.acceptInvitation({
          body: { invitationId },
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
        invitationId,
        organizationId,
        requestId: context.get("requestId"),
      });
    }

    let profileLinkStatus: "linked" | "no_match" | "review_required" | "pending" = "no_match";
    const profileMatch = await invitationProfileMatchStatus(
      context.env,
      organizationId,
      invitation.email,
      session.user.id,
    );
    const membership = await context.env.CONTROL_DB.prepare(
      `SELECT id, profileId FROM member WHERE organizationId = ? AND userId = ? LIMIT 1`,
    )
      .bind(organizationId, session.user.id)
      .first<{ id: string; profileId: string | null }>();
    if (membership?.profileId) {
      profileLinkStatus = "linked";
    } else if (profileMatch.status === "review_required") {
      profileLinkStatus = "review_required";
    } else if (profileMatch.status === "will_link" && profileMatch.profileId && membership) {
      if (membership.profileId === profileMatch.profileId) {
        profileLinkStatus = "linked";
      } else if (membership.profileId !== null) {
        profileLinkStatus = "review_required";
      } else {
        try {
          const linked = await linkOrganizationProfile(context.env, {
            actorUserId: session.user.id,
            membershipId: membership.id,
            organizationId,
            profileId: profileMatch.profileId,
            requestId: context.get("requestId"),
            requireUnlinked: true,
            source: "organization_invitation",
          });
          profileLinkStatus = linked.ok ? "linked" : "review_required";
        } catch {
          profileLinkStatus = "pending";
        }
      }
    }
    const response: OrganizationInvitationActionResponse = {
      id: invitationId,
      profileLinkStatus,
      requestId: context.get("requestId"),
      status: "accepted",
    };
    return context.json(response);
  });
}
