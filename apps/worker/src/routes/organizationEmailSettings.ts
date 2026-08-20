import {
  organizationEmailDomainVerifyResponseSchema,
  organizationEmailSettingsSchema,
  organizationEmailSettingsUpdateRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { authorizeCalendarRoute, type WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/email-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const url = new URL("https://organization.internal/internal/email-settings");
      url.searchParams.set("organizationId", authorization.organizationId);
      const response = await invokeOrganizationRpc(stub, url);
      const raw: unknown = await response.json();
      const settings = organizationEmailSettingsSchema.parse(
        typeof raw === "object" && raw !== null && "settings" in raw ? raw.settings : raw,
      );
      return context.json({
        requestId: context.get("requestId"),
        settings,
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization email settings are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/email-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const rawBody = await context.req.json<unknown>().catch(() => null);
    const parsed = organizationEmailSettingsUpdateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid email settings are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const url = new URL("https://organization.internal/internal/email-settings/manage");
      url.searchParams.set("organizationId", authorization.organizationId);
      const response = await invokeOrganizationRpc(stub, url, {
        body: JSON.stringify(parsed.data),
        method: "POST",
      });
      if (!response.ok) {
        return context.json(
          {
            code: "update_failed",
            message: "Failed to update organization email settings.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      const raw: unknown = await response.json();
      const settings = organizationEmailSettingsSchema.parse(
        typeof raw === "object" && raw !== null && "settings" in raw ? raw.settings : raw,
      );

      // Update control database routing index
      if (parsed.data.customDomain) {
        const domain = parsed.data.customDomain.trim().toLowerCase();
        await context.env.CONTROL_DB.prepare(
          `INSERT INTO organization_email_domains (id, organization_id, domain, status, created_at)
           VALUES (?, ?, ?, 'pending', ?)
           ON CONFLICT(domain) DO UPDATE SET organization_id = excluded.organization_id`,
        )
          .bind(crypto.randomUUID(), authorization.organizationId, domain, Date.now())
          .run()
          .catch(() => undefined);
      } else if (parsed.data.customDomain === null) {
        await context.env.CONTROL_DB.prepare(
          "DELETE FROM organization_email_domains WHERE organization_id = ?",
        )
          .bind(authorization.organizationId)
          .run()
          .catch(() => undefined);
      }

      return context.json({
        requestId: context.get("requestId"),
        settings,
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization email settings are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/email-settings/verify", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const url = new URL("https://organization.internal/internal/email-settings/verify");
      url.searchParams.set("organizationId", authorization.organizationId);
      const response = await invokeOrganizationRpc(stub, url, { method: "POST" });
      if (!response.ok) {
        return context.json(
          {
            code: "verification_failed",
            message: "No custom email domain is configured to verify.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      const raw: unknown = await response.json();
      const parsed = organizationEmailDomainVerifyResponseSchema
        .omit({ requestId: true })
        .parse(raw);

      if (parsed.allValid) {
        await context.env.CONTROL_DB.prepare(
          "UPDATE organization_email_domains SET status = 'active', verified_at = ? WHERE organization_id = ?",
        )
          .bind(Date.now(), authorization.organizationId)
          .run()
          .catch(() => undefined);
      }

      return context.json({
        ...parsed,
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization email verification is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
