import {
  organizationProfileFolderNumberUpdateSchema,
  organizationProfilePerformanceHistoryResponseSchema,
  organizationProfileStatusHistoryResponseSchema,
  type OrganizationContextResponse,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import { renderRosterCsv } from "@choir/domain";
import { createAuth, isCanonicalAuthHost } from "../auth/config";
import {
  CalendarMutationError,
  readOrganizationRosterConfiguration,
  listOrganizationProfilePerformanceHistory,
  listOrganizationProfileFolderNumbers,
  updateOrganizationProfileFolderNumber,
} from "../calendar/organizationCalendar";
import { validateStartupConfig } from "../env";
import {
  listOrganizationProfileEmails,
  listOrganizationProfiles,
  listOrganizationProfileStatusHistory,
} from "../organization/profiles";
import { authorizeOrganizationMember } from "../tenancy/authorizeOrganization";
import { resolveOrganization } from "../tenancy/resolveOrganization";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, resolveCanonicalOrganizationId } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/context", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const resolvedOrganization = await resolveOrganization(requestUrl, context.env);
    if (!resolvedOrganization.ok) {
      const problem: ProblemDetails = {
        code: resolvedOrganization.error.code,
        message: resolvedOrganization.error.message,
        requestId: context.get("requestId"),
      };
      return context.json(
        problem,
        resolvedOrganization.error.code === "validation_failed" ? 400 : 404,
      );
    }
    if (resolvedOrganization.value.routeKind !== "canonical") {
      const problem: ProblemDetails = {
        code: "not_found",
        message: "Authenticated Organization routes require a canonical product hostname.",
        requestId: context.get("requestId"),
      };
      return context.json(problem, 404);
    }
    if (!isCanonicalAuthHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      const problem: ProblemDetails = {
        code: "not_found",
        message: "Authenticated Organization routes require a canonical product hostname.",
        requestId: context.get("requestId"),
      };
      return context.json(problem, 404);
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
      const problem: ProblemDetails = {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      };
      return context.json(problem, authorization.error.code === "unauthorized" ? 401 : 403);
    }

    const response: OrganizationContextResponse = {
      organizationId: authorization.value.organizationId,
      requestId: context.get("requestId"),
      role: authorization.value.role,
      userId: authorization.value.userId,
    };
    return context.json(response);
  });

  router.get("/api/organization/profiles", async (context) => {
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
          message: "Only Organization Owners and Administrators may view the full Profile roster.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    try {
      return context.json({
        profiles: await listOrganizationProfiles(context.env, organizationId),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization Profiles are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/profiles/export.csv", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const [profiles, emails, rosterConfiguration] = await Promise.all([
        listOrganizationProfiles(context.env, authorization.organizationId),
        listOrganizationProfileEmails(context.env.CONTROL_DB, authorization.organizationId),
        readOrganizationRosterConfiguration(context.env, authorization.organizationId),
      ]);
      const csv = renderRosterCsv(
        profiles.map((profile) => ({
          displayName: profile.displayName,
          email: emails.get(profile.id) ?? "",
          globalStatus: profile.globalStatus,
          isSectionLeader: profile.isSectionLeader,
          phone: profile.phone,
          voicePart: profile.voicePart,
        })),
        rosterConfiguration.performerLabel,
      );
      return context.body(csv, 200, {
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="choir_roster_export.csv"',
        "content-type": "text/csv; charset=utf-8",
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization roster export could not be generated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/profiles/:profileId/performance-history", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = z.uuid().safeParse(context.req.param("profileId"));
    if (!profileId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Profile ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const history = organizationProfilePerformanceHistoryResponseSchema
        .omit({ requestId: true })
        .parse(
          await listOrganizationProfilePerformanceHistory(
            context.env,
            authorization.organizationId,
            profileId.data,
          ),
        );
      return context.json({ ...history, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Profile performance history is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/profiles/:profileId/status-history", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = z.uuid().safeParse(context.req.param("profileId"));
    if (!profileId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Profile ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const history = organizationProfileStatusHistoryResponseSchema.parse(
        await listOrganizationProfileStatusHistory(
          context.env,
          authorization.organizationId,
          profileId.data,
        ),
      );
      return context.json({ ...history, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Profile status history is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/profiles/:profileId/folder-numbers", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = z.uuid().safeParse(context.req.param("profileId"));
    if (!profileId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Profile ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const folderNumbers = await listOrganizationProfileFolderNumbers(
        context.env,
        authorization.organizationId,
        profileId.data,
      );
      return context.json({
        folderNumbers,
        profileId: profileId.data,
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Profile folder numbers are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/profiles/:profileId/folder-numbers/:eventId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = z.uuid().safeParse(context.req.param("profileId"));
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    const folder = organizationProfileFolderNumberUpdateSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!profileId.success || !eventId.success || !folder.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Profile, event, and folder number are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const folderNumber = await updateOrganizationProfileFolderNumber(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        profileId.data,
        eventId.data,
        folder.data,
      );
      return context.json({ ...folderNumber, requestId: context.get("requestId") });
    } catch (error: unknown) {
      if (error instanceof CalendarMutationError) {
        const status = error.status === 409 ? 409 : 503;
        return context.json(
          {
            code: error.code,
            message:
              error.code === "folder_number_requires_performance"
                ? "Folder numbers can only be assigned to Performance events."
                : error.code === "folder_number_conflict"
                  ? "That Folder Number is already used for this Performance."
                  : "The profile folder number could not be saved.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          status,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The profile folder number could not be saved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
