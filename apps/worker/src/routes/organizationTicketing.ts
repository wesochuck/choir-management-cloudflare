import { ticketScanRequestSchema, type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import {
  deleteOrganizationTicketBundle,
  listOrganizationTicketBundles,
  listOrganizationTicketOrders,
  readOrganizationTicketWillCallCsv,
  TicketingError,
  validateOrganizationTicketScan,
} from "../organization/organizationTicketing";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, saveTicketBundleRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/tickets/orders", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const orders = await listOrganizationTicketOrders(context.env, authorization.organizationId);
      return context.json({ orders, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Ticket orders are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/tickets/bundles", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const bundles = await listOrganizationTicketBundles(
        context.env,
        authorization.organizationId,
      );
      return context.json({ bundles, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Ticket bundles are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/tickets/bundles", (context) =>
    saveTicketBundleRoute(context, crypto.randomUUID()),
  );

  router.put("/api/organization/tickets/bundles/:bundleId", (context) =>
    saveTicketBundleRoute(context, context.req.param("bundleId")),
  );

  router.delete("/api/organization/tickets/bundles/:bundleId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const bundleId = z.uuid().safeParse(context.req.param("bundleId"));
    if (!bundleId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid ticket bundle is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      await deleteOrganizationTicketBundle(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        bundleId.data,
      );
      return context.json({ deleted: true, requestId: context.get("requestId") });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof TicketingError ? error.code : "ticket_bundle_unavailable",
          message:
            error instanceof TicketingError
              ? error.message
              : "The ticket bundle could not be deleted.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof TicketingError && error.status === 404
          ? 404
          : error instanceof TicketingError && error.status === 409
            ? 409
            : 503,
      );
    }
  });

  router.get("/api/organization/tickets/will-call", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.query("eventId"));
    if (!eventId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid ticketed event is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const csv = await readOrganizationTicketWillCallCsv(
        context.env,
        authorization.organizationId,
        eventId.data,
      );
      context.header("content-disposition", `attachment; filename="${csv.filename}"`);
      context.header("content-type", "text/csv; charset=utf-8");
      return context.body(csv.content);
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof TicketingError ? error.code : "ticket_export_unavailable",
          message:
            error instanceof TicketingError
              ? error.message
              : "The will-call list is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof TicketingError && error.status === 404 ? 404 : 503,
      );
    }
  });

  router.post("/api/organization/tickets/scan", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const scan = ticketScanRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!scan.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid event and ticket credential are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const result = await validateOrganizationTicketScan(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        scan.data.eventId,
        scan.data.token,
      );
      return context.json({ ...result, requestId: context.get("requestId") });
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof TicketingError ? error.code : "ticket_scan_unavailable",
          message:
            error instanceof TicketingError
              ? error.message
              : "Ticket validation is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof TicketingError && error.status === 404 ? 404 : 503,
      );
    }
  });
}
