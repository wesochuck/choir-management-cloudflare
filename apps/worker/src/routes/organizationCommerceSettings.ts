import {
  donationSettingsSchema,
  ticketConfirmationSettingsSchema,
  ticketConfirmationSettingsResponseSchema,
  transactionFeeSettingsSchema,
  transactionFeeSettingsResponseSchema,
  type ProblemDetails,
} from "@choir/contracts";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/donation-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/donations/settings");
      url.searchParams.set("organizationId", authorization.organizationId);
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        url,
      );
      const settings = donationSettingsSchema.safeParse(await response.json());
      if (!response.ok || !settings.success) throw new Error("invalid_settings");
      return context.json({ ...settings.data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Donation settings could not be retrieved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/donation-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = donationSettingsSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid donation settings are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        "https://organization.internal/internal/donations/settings",
        {
          body: JSON.stringify({
            ...body.data,
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        return context.json(
          {
            code: response.status === 400 ? "validation_failed" : "donation_settings_update_failed",
            message:
              response.status === 400
                ? "Valid donation settings are required."
                : "Donation settings could not be saved.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          response.status === 400 || response.status === 409 ? response.status : 503,
        );
      }
      const settings = donationSettingsSchema.safeParse(await response.json());
      if (!settings.success) throw new Error("invalid_settings");
      return context.json({ ...settings.data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Donation settings could not be saved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/transaction-fee-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/transaction-fee-settings");
      url.searchParams.set("organizationId", authorization.organizationId);
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        url,
      );
      const settings = transactionFeeSettingsSchema.safeParse(await response.json());
      if (!response.ok || !settings.success) throw new Error("invalid_settings");
      return context.json(
        transactionFeeSettingsResponseSchema.parse({
          ...settings.data,
          requestId: context.get("requestId"),
        }),
      );
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Transaction fee settings could not be retrieved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/transaction-fee-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = transactionFeeSettingsSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid transaction fee settings are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        "https://organization.internal/internal/transaction-fee-settings",
        {
          body: JSON.stringify({
            ...body.data,
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        return context.json(
          {
            code:
              response.status === 400
                ? "validation_failed"
                : "transaction_fee_settings_update_failed",
            message:
              response.status === 400
                ? "Valid transaction fee settings are required."
                : "Transaction fee settings could not be saved.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          response.status === 400 || response.status === 409 ? response.status : 503,
        );
      }
      const settings = transactionFeeSettingsSchema.safeParse(await response.json());
      if (!settings.success) throw new Error("invalid_settings");
      return context.json(
        transactionFeeSettingsResponseSchema.parse({
          ...settings.data,
          requestId: context.get("requestId"),
        }),
      );
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Transaction fee settings could not be saved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/ticket-confirmation-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/ticket-confirmation-settings");
      url.searchParams.set("organizationId", authorization.organizationId);
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        url,
      );
      const settings = ticketConfirmationSettingsSchema.safeParse(await response.json());
      if (!response.ok || !settings.success) throw new Error("invalid_settings");
      return context.json(
        ticketConfirmationSettingsResponseSchema.parse({
          ...settings.data,
          requestId: context.get("requestId"),
        }),
      );
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Ticket confirmation wording could not be retrieved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/ticket-confirmation-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = ticketConfirmationSettingsSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid ticket confirmation wording is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        "https://organization.internal/internal/ticket-confirmation-settings",
        {
          body: JSON.stringify({
            ...body.data,
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        return context.json(
          {
            code:
              response.status === 400
                ? "validation_failed"
                : "ticket_confirmation_settings_update_failed",
            message:
              response.status === 400
                ? "Valid ticket confirmation wording is required."
                : "Ticket confirmation wording could not be saved.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          response.status === 400 || response.status === 409 ? response.status : 503,
        );
      }
      const settings = ticketConfirmationSettingsSchema.safeParse(await response.json());
      if (!settings.success) throw new Error("invalid_settings");
      return context.json(
        ticketConfirmationSettingsResponseSchema.parse({
          ...settings.data,
          requestId: context.get("requestId"),
        }),
      );
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Ticket confirmation wording could not be saved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
