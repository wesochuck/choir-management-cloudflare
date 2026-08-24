import {
  organizationProvisionRequestSchema,
  publicDomainRegistrationRequestSchema,
  platformElevationRequestSchema,
  type PlatformOrganizationPublicDomainsResponse,
  type OrganizationProvisionResponse,
  type PlatformOrganizationContextResponse,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
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
