import {
  notificationFilterSchema,
  organizationNotificationReadAllRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import {
  listOrganizationNotifications,
  markAllOrganizationNotificationsRead,
  markOrganizationNotificationRead,
  NotificationRepositoryError,
} from "../organization/organizationNotifications";
import type { WorkerHonoEnvironment } from "./helpers";
import { authorizeCalendarRoute, resolveEffectiveMemberProfileId } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/notifications", async (context) => {
    context.header("Cache-Control", "private, no-store");
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const { isImpersonating, profileId } = await resolveEffectiveMemberProfileId(
      context,
      authorization,
    );
    if (isImpersonating) {
      return context.json(
        {
          code: "forbidden",
          message: "Personal notifications are not accessible while impersonating.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    if (!profileId) {
      return context.json(
        {
          code: "forbidden",
          message: "A linked Organization Profile is required to access personal notifications.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const query = context.req.query();
    const filterParsed = notificationFilterSchema.safeParse(query.filter ?? undefined);
    const filter = filterParsed.success ? filterParsed.data : "all";
    const limitParsed = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    const limit = Number.isFinite(limitParsed) ? limitParsed : undefined;

    try {
      const result = await listOrganizationNotifications(
        context.env,
        authorization.organizationId,
        {
          cursor: query.cursor ?? null,
          filter,
          limit,
          profileId,
        },
      );
      return context.json({
        ...result,
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "internal_error",
          message: "Failed to list notifications.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        500,
      );
    }
  });

  router.post("/api/notifications/:id/read", async (context) => {
    context.header("Cache-Control", "private, no-store");
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const { isImpersonating, profileId } = await resolveEffectiveMemberProfileId(
      context,
      authorization,
    );
    if (isImpersonating) {
      return context.json(
        {
          code: "forbidden",
          message: "Personal notifications are not accessible while impersonating.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    if (!profileId) {
      return context.json(
        {
          code: "forbidden",
          message: "A linked Organization Profile is required to access personal notifications.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const notificationIdParsed = z.uuid().safeParse(context.req.param("id"));
    if (!notificationIdParsed.success) {
      return context.json(
        {
          code: "bad_request",
          message: "Invalid notification ID.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    try {
      const notification = await markOrganizationNotificationRead(
        context.env,
        authorization.organizationId,
        {
          notificationId: notificationIdParsed.data,
          profileId,
        },
      );
      return context.json({
        notification,
        requestId: context.get("requestId"),
        success: true as const,
      });
    } catch (error) {
      if (error instanceof NotificationRepositoryError && error.status === 404) {
        return context.json(
          {
            code: "not_found",
            message: "Notification not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      return context.json(
        {
          code: "internal_error",
          message: "Failed to mark notification as read.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        500,
      );
    }
  });

  router.post("/api/notifications/read-all", async (context) => {
    context.header("Cache-Control", "private, no-store");
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const { isImpersonating, profileId } = await resolveEffectiveMemberProfileId(
      context,
      authorization,
    );
    if (isImpersonating) {
      return context.json(
        {
          code: "forbidden",
          message: "Personal notifications are not accessible while impersonating.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    if (!profileId) {
      return context.json(
        {
          code: "forbidden",
          message: "A linked Organization Profile is required to access personal notifications.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const bodyParsed = organizationNotificationReadAllRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!bodyParsed.success) {
      return context.json(
        {
          code: "bad_request",
          message: "Invalid read-all request body.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    try {
      const markedCount = await markAllOrganizationNotificationsRead(
        context.env,
        authorization.organizationId,
        {
          boundary: bodyParsed.data.boundary,
          profileId,
        },
      );
      return context.json({
        markedCount,
        requestId: context.get("requestId"),
        success: true as const,
      });
    } catch {
      return context.json(
        {
          code: "internal_error",
          message: "Failed to mark all notifications as read.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        500,
      );
    }
  });
}
