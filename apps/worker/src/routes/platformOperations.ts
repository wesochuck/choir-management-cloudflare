import {
  organizationIdSchema,
  organizationProvisionRequestSchema,
  platformElevationRequestSchema,
  platformStripeConnectResetRequestSchema,
  platformStripeReconciliationApplyRequestSchema,
  platformStripeReconciliationPreviewRequestSchema,
  publicDomainRegistrationRequestSchema,
  type OrganizationProvisionResponse,
  type PlatformOrganizationContextResponse,
  type PlatformOrganizationPublicDomainsResponse,
  type PlatformStripeReconciliationApplyResponse,
  type PlatformStripeReconciliationApplyResult,
  type PlatformStripeReconciliationPreviewResponse,
  type PlatformStripeReconciliationRow,
  type ProblemDetails,
} from "@choir/contracts";
import {
  compareStripePaymentToLocalCandidate,
  type ReconciliationLookupError,
  type StripePaymentSnapshot,
} from "@choir/domain";
import { z } from "zod";
import { removeStripeAccountOrganization } from "../payments/stripeRouting";
import {
  retrieveStripePaymentReconciliationSnapshot,
  StripeConnectError,
} from "../payments/stripeConnect";
import { createAuth, isProductBaseHost } from "../auth/config";
import {
  assertEmailProviderRecipientAvailable,
  EmailRecipientSuppressedError,
} from "../communications/emailFeedback";
import { authorizePlatformAdministratorSession } from "../auth/platformAdministrator";
import { sendPlatformEmail } from "../auth/platformEmail";
import {
  createPlatformElevation,
  getPlatformOrganizationContext,
  revokePlatformElevation,
} from "../auth/platformElevation";
import {
  beginOrganizationProvisioning,
  OrganizationProvisioningError,
} from "../control/provisionOrganization";
import { validateStartupConfig } from "../env";
import {
  disablePublicDomain,
  listPublicDomains,
  registerPublicDomain,
  removePublicDomain,
} from "../tenancy/registerPublicDomain";

import type { Context, Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { resolveCanonicalOrganizationId } from "./helpers";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import {
  reconciliationReportSchema,
  type ReconciliationReport,
} from "../organization/reconciliationStore";

const RECONCILIATION_ARCHIVE_PAGE_SIZE = 1_000;
type WorkerContext = Context<WorkerHonoEnvironment>;

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function authorizePlatformRead(
  context: WorkerContext,
  requestUrl: URL,
): Promise<{ readonly userId: string } | Response> {
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (authorization.ok) return { userId: authorization.value.userId };
  return context.json(
    {
      code: authorization.error.code,
      message: authorization.error.message,
      requestId: context.get("requestId"),
    } satisfies ProblemDetails,
    authorization.error.code === "unauthorized" ? 401 : 403,
  );
}

async function listOrganizationExportArchives(
  bucket: R2Bucket,
  organizationId: string,
): Promise<{ readonly objects: readonly R2Object[]; readonly truncated: boolean }> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  for (;;) {
    const prefix = `organizations/${organizationId}/exports/`;
    const page = await bucket.list(
      cursor
        ? { cursor, limit: RECONCILIATION_ARCHIVE_PAGE_SIZE, prefix }
        : { limit: RECONCILIATION_ARCHIVE_PAGE_SIZE, prefix },
    );
    objects.push(...page.objects);
    if (objects.length > 10_000) return { objects, truncated: true };
    if (!page.truncated || !page.cursor) return { objects, truncated: false };
    cursor = page.cursor;
  }
}

async function readAndMergeReconciliationReport(
  context: WorkerContext,
  organizationId: string,
): Promise<ReconciliationReport | Response> {
  const reportResponse = await invokeOrganizationRpc(
    organizationStoreStub(context.env, organizationId),
    `https://organization.internal/internal/reconciliation-report?organizationId=${encodeURIComponent(organizationId)}`,
  );
  const report = reconciliationReportSchema.safeParse(
    await reportResponse.json().catch(() => null),
  );
  if (!reportResponse.ok || !report.success) {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization reconciliation report could not be read.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }

  const archiveObjects = await listOrganizationExportArchives(
    context.env.ORGANIZATION_FILES,
    organizationId,
  );
  if (archiveObjects.truncated) {
    return context.json(
      {
        code: "reconciliation_report_too_large",
        message: "The Organization has too many export archives to audit in one report.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
  const knownOrphans = new Map(
    report.data.orphanedExportArchives.map((archive) => [archive.archiveKey, archive]),
  );
  const completedArchives = new Set(report.data.completedExportArchiveKeys);
  for (const object of archiveObjects.objects) {
    if (completedArchives.has(object.key) || knownOrphans.has(object.key)) continue;
    knownOrphans.set(object.key, {
      archiveKey: object.key,
      exportId: object.customMetadata?.exportId ?? "unknown",
      status: "unreferenced",
    });
  }
  return {
    ...report.data,
    orphanedExportArchives: [...knownOrphans.values()],
  };
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/platform/organizations", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Organization provisioning is available only on the product base hostname.",
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
    const authorization = await authorizePlatformAdministratorSession(
      context.env.CONTROL_DB,
      session?.session.id ?? null,
      session?.user.id ?? null,
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

    const parsedBody = organizationProvisionRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Organization name and unique hostname slug are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    try {
      const started = await beginOrganizationProvisioning(context.env, {
        ...parsedBody.data,
        actorUserId: authorization.value.userId,
        requestId: context.get("requestId"),
      });
      const response: OrganizationProvisionResponse = {
        ...started,
        lifecycleState: "provisioning",
        requestId: context.get("requestId"),
      };
      return context.json(response, 202);
    } catch (error: unknown) {
      const workflowDispatchFailed =
        error instanceof OrganizationProvisioningError && error.phase === "workflow";
      return context.json(
        {
          code: workflowDispatchFailed ? "service_unavailable" : "conflict",
          message: workflowDispatchFailed
            ? "The Organization registry was created, but provisioning could not be dispatched."
            : "The Organization name or hostname slug is already in use.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        workflowDispatchFailed ? 503 : 409,
      );
    }
  });

  router.get("/api/platform/organizations/:organizationId/public-domains", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message:
            "Platform public domain management is available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const organizationId = z.uuid().safeParse(context.req.param("organizationId"));
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
    const response: PlatformOrganizationPublicDomainsResponse = {
      domains: [...(await listPublicDomains(context.env.CONTROL_DB, organizationId.data))],
      requestId: context.get("requestId"),
    };
    return context.json(response);
  });

  router.post("/api/platform/organizations/:organizationId/public-domains", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message:
            "Platform public domain management is available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const organizationId = z.uuid().safeParse(context.req.param("organizationId"));
    const parsedBody = publicDomainRegistrationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!organizationId.success || !parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Organization and custom hostname are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
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
    const registration = await registerPublicDomain(context.env, {
      actorUserId: authorization.userId,
      hostname: parsedBody.data.hostname,
      organizationId: organizationId.data,
      requestId: context.get("requestId"),
    });
    if (!registration.ok) {
      return context.json(
        {
          code: registration.error.code,
          message: registration.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        registration.error.code === "validation_failed" ? 400 : 409,
      );
    }
    return context.json({ ...registration.value, requestId: context.get("requestId") }, 201);
  });

  router.delete(
    "/api/platform/organizations/:organizationId/public-domains/:domainId",
    async (context) => {
      const config = validateStartupConfig(context.env);
      const requestUrl = new URL(context.req.url);
      if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
        return context.json(
          {
            code: "not_found",
            message:
              "Platform public domain management is available only on the product base hostname.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const organizationId = z.uuid().safeParse(context.req.param("organizationId"));
      const domainId = z.uuid().safeParse(context.req.param("domainId"));
      if (!organizationId.success || !domainId.success) {
        return context.json(
          {
            code: "not_found",
            message: "The custom hostname was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const authorization = await authorizePlatformRead(context, requestUrl);
      if (authorization instanceof Response) return authorization;
      const action = context.req.query("action");
      if (action === "disable") {
        try {
          const disabled = await disablePublicDomain(context.env, {
            actorUserId: authorization.userId,
            domainId: domainId.data,
            organizationId: organizationId.data,
            requestId: context.get("requestId"),
          });
          if (!disabled.ok) {
            return context.json(
              {
                code: disabled.error.code,
                message: disabled.error.message,
                requestId: context.get("requestId"),
              } satisfies ProblemDetails,
              404,
            );
          }
          return context.json({ ...disabled.value, requestId: context.get("requestId") });
        } catch {
          return context.json(
            {
              code: "service_unavailable",
              message:
                "The custom hostname could not be disabled while its provider configuration is being removed.",
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            503,
          );
        }
      }

      try {
        const removed = await removePublicDomain(context.env, {
          actorUserId: authorization.userId,
          domainId: domainId.data,
          organizationId: organizationId.data,
          requestId: context.get("requestId"),
        });
        if (!removed.ok) {
          return context.json(
            {
              code: removed.error.code,
              message: removed.error.message,
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            404,
          );
        }
        return context.json({
          domainId: domainId.data,
          ok: true,
          requestId: context.get("requestId"),
        });
      } catch {
        return context.json(
          {
            code: "service_unavailable",
            message:
              "The custom hostname could not be removed while its provider configuration is being deleted.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }
    },
  );

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

  router.post(
    "/api/platform/organizations/:organizationId/stripe-reconciliation/preview",
    async (context) => {
      const config = validateStartupConfig(context.env);
      const requestUrl = new URL(context.req.url);
      if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
        return context.json(
          {
            code: "not_found",
            message:
              "Platform Stripe reconciliation is available only on the product base hostname.",
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

      const parsedBody = platformStripeReconciliationPreviewRequestSchema.safeParse(
        await context.req.json<unknown>().catch(() => ({})),
      );
      if (!parsedBody.success) {
        return context.json(
          {
            code: "validation_failed",
            message: "Invalid preview request parameters.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }

      const stub = organizationStoreStub(context.env, organizationId.data);
      const eligibilityRes = await invokeOrganizationRpc(
        stub,
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
      const eligibility = await eligibilityRes.json<{ readonly accountId: string | null }>();
      if (!eligibility.accountId) {
        return context.json(
          {
            code: "stripe_connect_not_connected",
            message: "This Organization does not currently have a connected Stripe account.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }

      const secretKey = context.env.STRIPE_SECRET_KEY;
      if (!secretKey) {
        return context.json(
          {
            code: "stripe_unavailable",
            message: "Stripe API key is not configured.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }

      const { candidates, hasMore } = await stub.listStripePaymentReconciliationCandidates({
        limit: parsedBody.data.limit,
        organizationId: organizationId.data,
        since: parsedBody.data.since,
      });

      const rows: PlatformStripeReconciliationRow[] = await mapConcurrent(
        candidates,
        4,
        async (candidate) => {
          let snapshot: StripePaymentSnapshot | null = null;
          let lookupError: ReconciliationLookupError | null = null;
          try {
            snapshot = await retrieveStripePaymentReconciliationSnapshot(
              secretKey,
              eligibility.accountId!,
              candidate.providerPaymentId,
            );
          } catch (err: unknown) {
            if (err instanceof StripeConnectError) {
              lookupError = { code: err.code, message: err.safeMessage, status: err.status };
            } else {
              lookupError = { message: err instanceof Error ? err.message : String(err) };
            }
          }

          const comparison = compareStripePaymentToLocalCandidate(candidate, snapshot, lookupError);

          return {
            classification: comparison.classification,
            createdAt: candidate.createdAt,
            currency: candidate.currency,
            localAmountCents: candidate.amountCents,
            localPaymentAttemptStatus: candidate.paymentAttemptStatus,
            localProcessorFeeCents: candidate.processorFeeCents,
            localProviderBalanceTransactionId: candidate.providerBalanceTransactionId,
            localResourceStatus: candidate.resourceStatus,
            manualReviewReason: comparison.manualReviewReason,
            paymentType: candidate.paymentType,
            proposedActions: [...comparison.proposedActions],
            providerPaymentId: candidate.providerPaymentId,
            resourceId: candidate.resourceId,
            safeToApply: comparison.safeToApply,
            stripeAmountChargedCents: snapshot?.amountChargedCents ?? null,
            stripeAmountRefundedCents: snapshot?.amountRefundedCents ?? null,
            stripeFullyRefunded: snapshot?.fullyRefunded ?? null,
            stripeProcessorFeeCents: snapshot?.processorFeeCents ?? null,
            stripeProviderBalanceTransactionId: snapshot?.providerBalanceTransactionId ?? null,
            stripeRefundCompletedAt: snapshot?.refundCompletedAt ?? null,
            stripeStatus: comparison.stripeStatus,
          };
        },
      );

      const scannedCount = rows.length;
      const matchedCount = rows.filter((r) => r.classification === "matched").length;
      const repairableCount = rows.filter(
        (r) => r.safeToApply && r.proposedActions.length > 0,
      ).length;
      const manualReviewCount = rows.filter(
        (r) => !r.safeToApply && r.classification !== "matched",
      ).length;

      const occurredAt = new Date().toISOString();
      await context.env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'platform.stripe_reconciliation.previewed', 'organization', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          authorization.userId,
          organizationId.data,
          organizationId.data,
          context.get("requestId"),
          JSON.stringify({
            accountId: eligibility.accountId,
            manualReviewCount,
            matchedCount,
            repairableCount,
            scannedCount,
            since: parsedBody.data.since ?? null,
          }),
          occurredAt,
        )
        .run();

      const responsePayload: PlatformStripeReconciliationPreviewResponse = {
        accountId: eligibility.accountId,
        hasMore,
        manualReviewCount,
        matchedCount,
        organizationId: organizationId.data,
        repairableCount,
        requestId: context.get("requestId"),
        rows,
        scannedCount,
      };

      return context.json(responsePayload);
    },
  );

  router.post(
    "/api/platform/organizations/:organizationId/stripe-reconciliation/apply",
    async (context) => {
      const config = validateStartupConfig(context.env);
      const requestUrl = new URL(context.req.url);
      if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
        return context.json(
          {
            code: "not_found",
            message:
              "Platform Stripe reconciliation is available only on the product base hostname.",
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

      const auth = createAuth({
        env: context.env,
        requestUrl,
        waitUntil: (promise) => {
          context.executionCtx.waitUntil(promise);
        },
      });
      const session = await auth.api.getSession({ headers: context.req.raw.headers });
      const authorization = await authorizePlatformAdministratorSession(
        context.env.CONTROL_DB,
        session?.session.id ?? null,
        session?.user.id ?? null,
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

      const elevation = await getPlatformOrganizationContext(
        context.env.CONTROL_DB,
        organizationId.data,
        session?.session.id ?? "",
        authorization.value.userId,
      );
      if (!elevation.canEdit) {
        return context.json(
          {
            code: "platform_elevation_required",
            message:
              "Enable a current Platform Administrator elevation before applying reconciliation.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          403,
        );
      }

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

      const parsedBody = platformStripeReconciliationApplyRequestSchema.safeParse(
        await context.req.json<unknown>().catch(() => null),
      );
      if (!parsedBody.success) {
        return context.json(
          {
            code: "validation_failed",
            message:
              "A valid confirmation, auditable reason (3-500 characters), and parameters are required.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }

      const stub = organizationStoreStub(context.env, organizationId.data);
      const eligibilityRes = await invokeOrganizationRpc(
        stub,
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
      const eligibility = await eligibilityRes.json<{ readonly accountId: string | null }>();
      if (!eligibility.accountId) {
        return context.json(
          {
            code: "stripe_connect_not_connected",
            message: "This Organization does not currently have a connected Stripe account.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }

      const secretKey = context.env.STRIPE_SECRET_KEY;
      if (!secretKey) {
        return context.json(
          {
            code: "stripe_unavailable",
            message: "Stripe API key is not configured.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }

      const { candidates } = await stub.listStripePaymentReconciliationCandidates({
        limit: 200,
        organizationId: organizationId.data,
        since: parsedBody.data.since,
      });

      const selectedIds = parsedBody.data.providerPaymentIds;
      const targetCandidates =
        selectedIds && selectedIds.length > 0
          ? candidates.filter((c) => selectedIds.includes(c.providerPaymentId))
          : candidates;

      const results: PlatformStripeReconciliationApplyResult[] = await mapConcurrent(
        targetCandidates,
        4,
        async (candidate) => {
          let snapshot: StripePaymentSnapshot | null = null;
          let lookupError: ReconciliationLookupError | null = null;
          try {
            snapshot = await retrieveStripePaymentReconciliationSnapshot(
              secretKey,
              eligibility.accountId!,
              candidate.providerPaymentId,
            );
          } catch (err: unknown) {
            if (err instanceof StripeConnectError) {
              lookupError = { code: err.code, message: err.safeMessage, status: err.status };
            } else {
              lookupError = { message: err instanceof Error ? err.message : String(err) };
            }
          }

          const comparison = compareStripePaymentToLocalCandidate(candidate, snapshot, lookupError);

          if (!comparison.safeToApply || comparison.proposedActions.length === 0) {
            return {
              actionsApplied: [],
              message:
                comparison.manualReviewReason ??
                "Row is already matched or requires manual review.",
              providerPaymentId: candidate.providerPaymentId,
              status: "skipped",
            };
          }

          const applyResult = await stub.applyHistoricalStripeReconciliation({
            actions: comparison.proposedActions,
            adminUserId: authorization.value.userId,
            organizationId: organizationId.data,
            providerPaymentId: candidate.providerPaymentId,
            reason: parsedBody.data.reason,
            stripeSnapshot: {
              amountChargedCents: snapshot!.amountChargedCents,
              amountRefundedCents: snapshot!.amountRefundedCents,
              fullyRefunded: snapshot!.fullyRefunded,
              processorFeeCents: snapshot!.processorFeeCents,
              providerBalanceTransactionId: snapshot!.providerBalanceTransactionId,
              refundCompletedAt: snapshot!.refundCompletedAt,
            },
          });

          return {
            actionsApplied: [...applyResult.actionsApplied],
            message: applyResult.message,
            providerPaymentId: candidate.providerPaymentId,
            status: applyResult.status,
          };
        },
      );

      const appliedCount = results.filter((r) => r.status === "applied").length;
      const skippedCount = results.filter((r) => r.status === "skipped").length;
      const failedCount = results.filter((r) => r.status === "failed").length;
      const refundedCount = results.filter((r) =>
        r.actionsApplied.includes("mark_refunded"),
      ).length;
      const feeBackfilledCount = results.filter((r) =>
        r.actionsApplied.includes("backfill_fee"),
      ).length;

      const occurredAt = new Date().toISOString();
      await context.env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'platform.stripe_reconciliation.applied', 'organization', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          authorization.value.userId,
          organizationId.data,
          organizationId.data,
          context.get("requestId"),
          JSON.stringify({
            accountId: eligibility.accountId,
            appliedCount,
            failedCount,
            feeBackfilledCount,
            reason: parsedBody.data.reason,
            refundedCount,
            skippedCount,
          }),
          occurredAt,
        )
        .run();

      const responsePayload: PlatformStripeReconciliationApplyResponse = {
        accountId: eligibility.accountId,
        appliedCount,
        failedCount,
        feeBackfilledCount,
        organizationId: organizationId.data,
        refundedCount,
        requestId: context.get("requestId"),
        results,
        skippedCount,
      };

      return context.json(responsePayload);
    },
  );

  router.get("/api/platform/organization-context", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Platform Organization access requires a registered canonical hostname.",
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
    const authorization = await authorizePlatformAdministratorSession(
      context.env.CONTROL_DB,
      session?.session.id ?? null,
      session?.user.id ?? null,
    );
    if (!authorization.ok || !session) {
      const code = authorization.ok ? "unauthorized" : authorization.error.code;
      const message = authorization.ok ? "Sign in is required." : authorization.error.message;
      return context.json(
        { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
        code === "unauthorized" ? 401 : 403,
      );
    }

    const platformContext = await getPlatformOrganizationContext(
      context.env.CONTROL_DB,
      organizationId,
      session.session.id,
      authorization.value.userId,
    );
    const response: PlatformOrganizationContextResponse = {
      ...platformContext,
      requestId: context.get("requestId"),
    };
    return context.json(response);
  });

  router.get("/api/platform/reconciliation-report", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "A registered canonical hostname is required for reconciliation reports.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const authorization = await authorizePlatformRead(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    const report = await readAndMergeReconciliationReport(context, organizationId);
    if (report instanceof Response) return report;
    return context.json({
      ...report,
      requestId: context.get("requestId"),
    });
  });

  router.post("/api/platform/elevations", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Platform edit elevation requires a registered canonical hostname.",
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
    const authorization = await authorizePlatformAdministratorSession(
      context.env.CONTROL_DB,
      session?.session.id ?? null,
      session?.user.id ?? null,
    );
    if (!authorization.ok || !session) {
      const code = authorization.ok ? "unauthorized" : authorization.error.code;
      const message = authorization.ok ? "Sign in is required." : authorization.error.message;
      return context.json(
        { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
        code === "unauthorized" ? 401 : 403,
      );
    }

    const parsedBody = platformElevationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A concise reason is required before enabling Platform Administrator edits.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const platformContext = await createPlatformElevation(context.env.CONTROL_DB, {
      actorUserId: authorization.value.userId,
      organizationId,
      reason: parsedBody.data.reason,
      requestId: context.get("requestId"),
      sessionId: session.session.id,
    });
    const response: PlatformOrganizationContextResponse = {
      ...platformContext,
      requestId: context.get("requestId"),
    };
    return context.json(response, 201);
  });

  router.delete("/api/platform/elevations/:elevationId", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    const elevationId = z.uuid().safeParse(context.req.param("elevationId"));
    if (!organizationId || !elevationId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The scoped Platform Administrator elevation was not found.",
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
    const authorization = await authorizePlatformAdministratorSession(
      context.env.CONTROL_DB,
      session?.session.id ?? null,
      session?.user.id ?? null,
    );
    if (!authorization.ok || !session) {
      const code = authorization.ok ? "unauthorized" : authorization.error.code;
      const message = authorization.ok ? "Sign in is required." : authorization.error.message;
      return context.json(
        { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
        code === "unauthorized" ? 401 : 403,
      );
    }

    const revoked = await revokePlatformElevation(context.env.CONTROL_DB, {
      actorUserId: authorization.value.userId,
      elevationId: elevationId.data,
      organizationId,
      requestId: context.get("requestId"),
      sessionId: session.session.id,
    });
    if (!revoked.ok) {
      return context.json(
        {
          code: revoked.error.code,
          message: revoked.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({ elevationId: revoked.value.elevationId, status: "revoked" as const });
  });

  router.post("/api/test-smtp", async (context) => {
    const requestUrl = new URL(context.req.url);
    const config = validateStartupConfig(context.env);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Platform test endpoints are available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const authorization = await authorizePlatformRead(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Invalid request body" }, 400);
    }
    const parsed = z.object({ to: z.string().min(3).max(320) }).safeParse(body);
    if (!parsed.success || !parsed.data.to.includes("@"))
      return context.json({ error: "Invalid email address" }, 400);
    try {
      await assertEmailProviderRecipientAvailable(context.env.CONTROL_DB, parsed.data.to);
    } catch (error: unknown) {
      if (error instanceof EmailRecipientSuppressedError) {
        return context.json(
          { code: error.code, message: error.message, requestId: context.get("requestId") },
          error.status,
        );
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The email suppression list could not be checked.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    const mode: string = context.env.EXTERNAL_EFFECTS_MODE;
    if (mode === "fake") {
      return context.json({
        sent: true,
        mode: "fake",
        to: parsed.data.to,
        requestId: context.get("requestId"),
      });
    }
    try {
      await sendPlatformEmail(
        {
          CONTROL_DB: context.env.CONTROL_DB,
          PLATFORM_EMAIL: context.env.PLATFORM_EMAIL,
          PLATFORM_EMAIL_ALLOWED_RECIPIENTS: context.env.PLATFORM_EMAIL_ALLOWED_RECIPIENTS,
          PLATFORM_EMAIL_FROM: context.env.PLATFORM_EMAIL_FROM,
          PLATFORM_EMAIL_MODE: context.env.PLATFORM_EMAIL_MODE,
        },
        {
          kind: "communication-test",
          recipient: parsed.data.to,
          subject: "Platform Email Delivery Test",
          text: "This is an operator test message from the platform operations console.",
        },
      );
      return context.json({
        sent: true,
        mode: context.env.PLATFORM_EMAIL_MODE,
        to: parsed.data.to,
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("not allowlisted")) {
        return context.json(
          {
            code: "recipient_not_allowlisted",
            message: "The email recipient is not allowlisted for sandbox sending.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          403,
        );
      }
      return context.json(
        {
          code: "email_delivery_failed",
          message: "The platform test email could not be sent.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        500,
      );
    }
  });

  router.post("/api/test-sms", async (context) => {
    const requestUrl = new URL(context.req.url);
    const config = validateStartupConfig(context.env);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Platform test endpoints are available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const authorization = await authorizePlatformRead(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Invalid request body" }, 400);
    }
    const parsed = z.object({ to: z.string().min(1).max(20) }).safeParse(body);
    if (!parsed.success) return context.json({ error: "Invalid phone number" }, 400);
    const mode: string = context.env.EXTERNAL_EFFECTS_MODE;
    if (mode === "fake") {
      return context.json({
        sent: true,
        mode: "fake",
        to: parsed.data.to,
        requestId: context.get("requestId"),
      });
    }
    return context.json({ error: "Real SMS sending not configured" }, 501);
  });

  router.get("/api/platform/queue-settings", async (context) => {
    const authorization = await authorizePlatformRead(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    return context.json({
      queue: "choir-management-jobs-local",
      deadLetterQueue: "choir-management-jobs-dlq-local",
      mode: context.env.EXTERNAL_EFFECTS_MODE,
      requestId: context.get("requestId"),
    });
  });

  router.post("/api/platform/queue-settings/generate", async (context) => {
    const authorization = await authorizePlatformRead(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    return context.json({ generated: true, requestId: context.get("requestId") });
  });
}
