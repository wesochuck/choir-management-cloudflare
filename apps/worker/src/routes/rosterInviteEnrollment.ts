import {
  rosterInviteOptionsRequestSchema,
  rosterInvitePreviewRequestSchema,
  rosterInviteRedeemRequestSchema,
  rosterInviteStartRequestSchema,
  type ProblemDetails,
  type RosterInviteEnrollmentStatusResponse,
  type RosterInviteOptionsResponse,
  type RosterInvitePreviewResponse,
  type RosterInviteRedeemResponse,
  type RosterInviteStartResponse,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import { createAuth, isCanonicalAuthHost } from "../auth/config";
import {
  assertEmailProviderRecipientAvailable,
  EmailRecipientSuppressedError,
} from "../communications/emailFeedback";
import {
  getRosterInviteEnrollmentStatus,
  redeemRosterInvite,
  validateRosterInviteToken,
} from "../control/rosterInviteEnrollmentService";
import { validateStartupConfig } from "../env";
import { organizationStoreStub } from "../organization/rpc/client";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import type { WorkerHonoEnvironment } from "./helpers";
import { ensurePendingIdentity } from "./helpers/invitationHelpers";

const enrollmentIdParamSchema = z.string().min(1).max(128);

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/roster-invites/preview", async (context) => {
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
          message: "Roster invitations require a canonical product hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const body = rosterInvitePreviewRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid roster invite token is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const validated = await validateRosterInviteToken(
      context.env,
      body.data.token,
      resolvedOrganization.value.organizationId,
    );
    if (!validated.ok) {
      return context.json(
        {
          code: validated.code,
          message: validated.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const orgRow = await context.env.CONTROL_DB.prepare(
      `SELECT name, slug FROM organizations WHERE id = ? LIMIT 1`,
    )
      .bind(resolvedOrganization.value.organizationId)
      .first<{ name: string; slug: string }>();

    if (!orgRow) {
      return context.json(
        {
          code: "not_found",
          message: "Organization not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const response: RosterInvitePreviewResponse = {
      expiresAt: new Date(validated.value.link.expires_at).toISOString(),
      logoFileId: null,
      organizationName: orgRow.name,
      organizationSlug: orgRow.slug,
      requestId: context.get("requestId"),
    };
    return context.json(response);
  });

  router.post("/api/roster-invites/start", async (context) => {
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
          message: "Roster invitations require a canonical product hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const body = rosterInviteStartRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid email address and roster invite token are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const validated = await validateRosterInviteToken(
      context.env,
      body.data.token,
      resolvedOrganization.value.organizationId,
    );
    if (!validated.ok) {
      return context.json(
        {
          code: validated.code,
          message: validated.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const normalizedEmail = body.data.email.toLowerCase().trim();
    try {
      await assertEmailProviderRecipientAvailable(context.env.CONTROL_DB, normalizedEmail);
    } catch (error: unknown) {
      if (error instanceof EmailRecipientSuppressedError) {
        return context.json(
          {
            code: "email_recipient_suppressed",
            message: error.message,
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      throw error;
    }

    // Bootstrap unverified identity in user table if new
    await ensurePendingIdentity(context.env.CONTROL_DB, normalizedEmail);

    // Send sign-in verification OTP via Better Auth
    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });

    try {
      await auth.api.sendVerificationOTP({
        body: { email: normalizedEmail, type: "sign-in" },
        headers: context.req.raw.headers,
      });
    } catch {
      return context.json(
        {
          code: "otp_send_failed",
          message: "Could not send verification code to this email address.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        500,
      );
    }

    const response: RosterInviteStartResponse = {
      requestId: context.get("requestId"),
      status: "code_sent",
    };
    return context.json(response);
  });

  router.post("/api/roster-invites/options", async (context) => {
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
          message: "Roster invitations require a canonical product hostname.",
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

    const body = rosterInviteOptionsRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid roster invite token is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const validated = await validateRosterInviteToken(
      context.env,
      body.data.token,
      resolvedOrganization.value.organizationId,
    );
    if (!validated.ok) {
      return context.json(
        {
          code: validated.code,
          message: validated.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const store = organizationStoreStub(context.env, resolvedOrganization.value.organizationId);
    const options = await store.getRosterInviteOptions({
      organizationId: resolvedOrganization.value.organizationId,
      userId: session.user.id,
    });

    if (!options) {
      return context.json(
        {
          code: "not_found",
          message: "Organization not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const response: RosterInviteOptionsResponse = {
      alreadyEnrolled: options.alreadyEnrolled,
      existingProfile: options.existingProfile ? { ...options.existingProfile } : null,
      organizationName: options.organizationName,
      performerLabel: options.performerLabel,
      requestId: context.get("requestId"),
      sections: options.sections.map((s) => ({ ...s })),
      voiceParts: options.voiceParts.map((v) => ({ ...v })),
    };
    return context.json(response);
  });

  router.post("/api/roster-invites/redeem", async (context) => {
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
          message: "Roster invitations require a canonical product hostname.",
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

    const body = rosterInviteRedeemRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message:
            "Display name, configured voice part, directory preference, and a valid token are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const result = await redeemRosterInvite(context.env, {
      actorUserId: session.user.id,
      displayName: body.data.displayName,
      idempotencyKey: body.data.idempotencyKey,
      organizationId: resolvedOrganization.value.organizationId,
      phone: body.data.phone,
      requestId: context.get("requestId"),
      showInDirectory: body.data.showInDirectory,
      token: body.data.token,
      voicePart: body.data.voicePart,
    });

    if (!result.ok) {
      return context.json(
        {
          code: result.code,
          message: result.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        result.status,
      );
    }

    const response: RosterInviteRedeemResponse = {
      enrollmentId: result.value.enrollmentId,
      membershipId: result.value.membershipId,
      profileId: result.value.profileId,
      requestId: context.get("requestId"),
      status: result.value.status,
    };
    return context.json(response, result.value.status === "completed" ? 201 : 200);
  });

  router.get("/api/roster-invites/enrollments/:id", async (context) => {
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
          message: "Roster invitations require a canonical product hostname.",
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

    const param = enrollmentIdParamSchema.safeParse(context.req.param("id"));
    if (!param.success) {
      return context.json(
        {
          code: "invalid_enrollment_id",
          message: "A valid enrollment ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const enrollment = await getRosterInviteEnrollmentStatus(context.env.CONTROL_DB, {
      actorUserId: session.user.id,
      enrollmentId: param.data,
      organizationId: resolvedOrganization.value.organizationId,
    });

    if (!enrollment) {
      return context.json(
        {
          code: "not_found",
          message: "Enrollment not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const response: RosterInviteEnrollmentStatusResponse = {
      enrollmentId: enrollment.id,
      membershipId: enrollment.membership_id,
      profileId: enrollment.profile_id,
      requestId: context.get("requestId"),
      status: enrollment.state,
    };
    return context.json(response);
  });
}
