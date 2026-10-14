import {
  organizationIdSchema,
  platformStripeConnectResetRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import { isProductBaseHost } from "../../auth/config";
import { validateStartupConfig } from "../../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import { removeStripeAccountOrganization } from "../../payments/stripeRouting";
import type { WorkerHonoEnvironment } from "../helpers";
import { authorizePlatformRead } from "./shared";

export function registerPlatformStripeConnectRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/organizations/:organizationId/stripe-connect", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message:
            "Platform Stripe Connect inspection is available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const organizationId = organizationIdSchema.safeParse(context.req.param("organizationId"));
    if (!organizationId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The Organization was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const authorization = await authorizePlatformRead(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    const organization = await context.env.CONTROL_DB.prepare(
      "SELECT id FROM organizations WHERE id = ? LIMIT 1",
    )
      .bind(organizationId.data)
      .first<{ readonly id: string }>();
    if (!organization) {
      return context.json(
        {
          code: "not_found",
          message: "The Organization was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const rpcRes = await invokeOrganizationRpc(
      organizationStoreStub(context.env, organizationId.data),
      `https://organization.internal/internal/stripe-connect/eligibility?organizationId=${encodeURIComponent(organizationId.data)}`,
    );
    if (!rpcRes.ok) {
      return context.json(
        {
          code: "stripe_connect_unavailable",
          message: "Organization Stripe Connect details could not be loaded.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    const eligibility = await rpcRes.json<Record<string, unknown>>();
    return context.json({
      ...eligibility,
      organizationId: organizationId.data,
      requestId: context.get("requestId"),
    });
  });

  router.post(
    "/api/platform/organizations/:organizationId/stripe-connect/reset",
    async (context) => {
      const config = validateStartupConfig(context.env);
      const requestUrl = new URL(context.req.url);
      if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
        return context.json(
          {
            code: "not_found",
            message:
              "Platform Stripe Connect reset is available only on the product base hostname.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const organizationId = organizationIdSchema.safeParse(context.req.param("organizationId"));
      if (!organizationId.success) {
        return context.json(
          {
            code: "not_found",
            message: "The Organization was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const authorization = await authorizePlatformRead(context, requestUrl);
      if (authorization instanceof Response) return authorization;
      const organization = await context.env.CONTROL_DB.prepare(
        "SELECT id FROM organizations WHERE id = ? LIMIT 1",
      )
        .bind(organizationId.data)
        .first<{ readonly id: string }>();
      if (!organization) {
        return context.json(
          {
            code: "not_found",
            message: "The Organization was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const parsedBody = platformStripeConnectResetRequestSchema.safeParse(
        await context.req.json<unknown>().catch(() => null),
      );
      if (!parsedBody.success) {
        return context.json(
          {
            code: "validation_failed",
            message:
              "A valid expected Stripe account ID, confirmation, and auditable reason are required.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }

      const eligibilityRes = await invokeOrganizationRpc(
        organizationStoreStub(context.env, organizationId.data),
        `https://organization.internal/internal/stripe-connect/eligibility?organizationId=${encodeURIComponent(organizationId.data)}`,
      );
      if (!eligibilityRes.ok) {
        return context.json(
          {
            code: "stripe_connect_unavailable",
            message: "Organization Stripe Connect details could not be checked.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }
      const eligibility = await eligibilityRes.json<{
        accountId: string | null;
        activations: Record<string, boolean>;
        eligibleForReset: boolean;
        hasPaymentHistory: boolean;
        hasPendingPayments: boolean;
        ineligibilityReason: string | null;
        status: string;
      }>();

      if (!eligibility.accountId) {
        return context.json(
          {
            code: "stripe_connect_not_connected",
            message: "This Organization does not currently have a Stripe account to reset.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      if (eligibility.accountId !== parsedBody.data.expectedAccountId) {
        return context.json(
          {
            code: "stripe_connect_account_changed",
            message:
              "The connected Stripe account changed after this page was loaded. Refresh before resetting it.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      if (eligibility.hasPaymentHistory) {
        return context.json(
          {
            code: "stripe_connect_reset_has_payment_history",
            message:
              "This Organization has completed real Stripe payments. The connection cannot be reset safely until historical payments retain their Stripe account of origin.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      if (eligibility.hasPendingPayments) {
        return context.json(
          {
            code: "stripe_connect_reset_has_pending_payments",
            message:
              "One or more Stripe checkouts are still pending. Wait for them to complete or expire before resetting the connection.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }

      const occurredAt = new Date().toISOString();
      await context.env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'platform.stripe_connect.reset_requested', 'stripe_connect_account', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          authorization.userId,
          organizationId.data,
          parsedBody.data.expectedAccountId,
          context.get("requestId"),
          JSON.stringify({
            expectedAccountId: parsedBody.data.expectedAccountId,
            previousActivations: eligibility.activations,
            previousStatus: eligibility.status,
            reason: parsedBody.data.reason,
          }),
          occurredAt,
        )
        .run();

      await removeStripeAccountOrganization(context.env.CONTROL_DB, {
        accountId: parsedBody.data.expectedAccountId,
        organizationId: organizationId.data,
      });

      const resetRpcRes = await invokeOrganizationRpc(
        organizationStoreStub(context.env, organizationId.data),
        "https://organization.internal/internal/stripe-connect/reset",
        {
          body: JSON.stringify({
            action: "reset_stripe_connect",
            actorUserId: authorization.userId,
            confirm: true,
            expectedAccountId: parsedBody.data.expectedAccountId,
            organizationId: organizationId.data,
            reason: parsedBody.data.reason,
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      if (!resetRpcRes.ok) {
        await context.env.CONTROL_DB.prepare(
          `INSERT INTO platform_audit_events
            (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
           VALUES (?, ?, ?, 'platform.stripe_connect.reset_failed', 'stripe_connect_account', ?, ?, ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            authorization.userId,
            organizationId.data,
            parsedBody.data.expectedAccountId,
            context.get("requestId"),
            JSON.stringify({
              error: await resetRpcRes.text().catch(() => "unknown"),
              expectedAccountId: parsedBody.data.expectedAccountId,
              reason: parsedBody.data.reason,
            }),
            new Date().toISOString(),
          )
          .run();

        return context.json(
          {
            code: "stripe_connect_reset_incomplete",
            message:
              "Stripe routing was disabled, but the Organization connection could not be fully reset. Retry the recovery action or inspect the Organization store before reconnecting.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }

      await context.env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'platform.stripe_connect.reset_completed', 'stripe_connect_account', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          authorization.userId,
          organizationId.data,
          parsedBody.data.expectedAccountId,
          context.get("requestId"),
          JSON.stringify({
            detachedAccountId: parsedBody.data.expectedAccountId,
            previousActivations: eligibility.activations,
            reason: parsedBody.data.reason,
          }),
          new Date().toISOString(),
        )
        .run();

      return context.json({
        accountId: null,
        activations: { donations: false, dues: false, tickets: false },
        organizationId: organizationId.data,
        requestId: context.get("requestId"),
        status: "not_started",
      });
    },
  );
}
