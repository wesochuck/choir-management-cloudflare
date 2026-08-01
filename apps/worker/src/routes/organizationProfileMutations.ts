import { organizationProfileRequestSchema, type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import { parseRosterCsv, RosterCsvError } from "@choir/domain";
import { createAuth } from "../auth/config";
import { validateStartupConfig } from "../env";
import {
  createOrganizationProfile,
  importOrganizationProfiles,
  OrganizationProfileMutationError,
  updateOrganizationProfile,
} from "../organization/profiles";
import { authorizeOrganizationMember } from "../tenancy/authorizeOrganization";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, resolveCanonicalOrganizationId } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/profiles/import", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const declaredLength = Number(context.req.header("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > 2_000_000) {
      return context.json(
        {
          code: "validation_failed",
          message: "Roster CSV files may not exceed 2 MB.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        413,
      );
    }
    try {
      const csv = await context.req.text();
      if (new TextEncoder().encode(csv).byteLength > 2_000_000) {
        return context.json(
          {
            code: "validation_failed",
            message: "Roster CSV files may not exceed 2 MB.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          413,
        );
      }
      const parsed = parseRosterCsv(csv);
      if (parsed.length === 0) throw new RosterCsvError("The CSV contains no Profiles.");
      const imported = await importOrganizationProfiles(context.env, {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        profiles: parsed.map((profile) => organizationProfileRequestSchema.parse(profile)),
        requestId: context.get("requestId"),
      });
      return context.json(
        {
          imported,
          invitationCandidates: parsed.filter(({ email }) => email !== "").length,
          requestId: context.get("requestId"),
        },
        201,
      );
    } catch (error: unknown) {
      if (error instanceof RosterCsvError) {
        const row = error.row === null ? "" : ` (row ${String(error.row)})`;
        return context.json(
          {
            code: "validation_failed",
            message: `${error.message}${row}`,
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      if (error instanceof OrganizationProfileMutationError) {
        return context.json(
          { code: error.code, message: error.message, requestId: context.get("requestId") },
          400,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The roster CSV could not be imported.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/profiles", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Organization Profiles require a registered canonical hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const parsedBody = organizationProfileRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A Profile display name is required.",
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
          message: "Only Organization Owners and Administrators may create Profiles.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    try {
      const profile = await createOrganizationProfile(context.env, {
        actorUserId: authorization.value.userId,
        organizationId,
        profile: parsedBody.data,
        requestId: context.get("requestId"),
      });
      return context.json({ ...profile, requestId: context.get("requestId") }, 201);
    } catch (error: unknown) {
      if (error instanceof OrganizationProfileMutationError) {
        return context.json(
          { code: error.code, message: error.message, requestId: context.get("requestId") },
          400,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization Profile could not be created.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/profiles/:profileId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = z.uuid().safeParse(context.req.param("profileId"));
    const profile = organizationProfileRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!profileId.success || !profile.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Profile and Profile details are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const updated = await updateOrganizationProfile(context.env, {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        profile: profile.data,
        profileId: profileId.data,
        requestId: context.get("requestId"),
      });
      return context.json({ ...updated, requestId: context.get("requestId") });
    } catch (error: unknown) {
      if (error instanceof OrganizationProfileMutationError) {
        return context.json(
          { code: error.code, message: error.message, requestId: context.get("requestId") },
          400,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization Profile could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
