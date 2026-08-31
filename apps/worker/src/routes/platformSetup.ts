import { type PlatformSetupStatusResponse, type ProblemDetails } from "@choir/contracts";
import { createAuth, isProductBaseHost } from "../auth/config";
import {
  authorizePlatformAdministratorSession,
  getPlatformAdministratorMfaStatus,
} from "../auth/platformAdministrator";
import { validateStartupConfig } from "../env";
import { currentOrganizationSchemaVersion } from "../organization/schema";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { providerSetupChecks } from "./helpers";
import type { PlatformCountRow, PlatformSchemaStatusRow } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  // eslint-disable-next-line complexity -- this monitoring endpoint reports each independent readiness dimension.
  router.get("/api/platform/setup-status", async (context) => {
    let config;
    try {
      config = validateStartupConfig(context.env);
    } catch {
      return context.json(
        {
          code: "service_not_ready",
          message: "Required platform runtime configuration is incomplete.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Platform setup monitoring is available only on the product base hostname.",
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

    let controlPlaneReady: boolean;
    let organizationCount: number | null = null;
    let jobDeadLetterCount: number | null = null;
    let schemaStatus: PlatformSchemaStatusRow | null = null;
    try {
      const [ready, organizations, deadLetters, schema] = await Promise.all([
        context.env.CONTROL_DB.prepare("SELECT 1 AS ready").first<{ readonly ready: number }>(),
        context.env.CONTROL_DB.prepare(
          "SELECT COUNT(*) AS count FROM organizations",
        ).first<PlatformCountRow>(),
        context.env.CONTROL_DB.prepare(
          `SELECT COUNT(*) AS count
           FROM job_dead_letters
           LEFT JOIN job_dead_letter_actions a ON a.dead_letter_id = job_dead_letters.id
           WHERE a.status IS NULL OR a.status != 'dismissed'`,
        ).first<PlatformCountRow>(),
        context.env.CONTROL_DB.prepare(
          `SELECT id AS runId, target_version AS targetVersion, status,
          processed_count AS processedCount, started_at AS startedAt,
          updated_at AS updatedAt, completed_at AS completedAt
         FROM fleet_schema_preparations
         ORDER BY started_at DESC, id DESC LIMIT 1`,
        ).first<PlatformSchemaStatusRow>(),
      ]);
      controlPlaneReady = ready?.ready === 1;
      organizationCount = organizations?.count ?? null;
      jobDeadLetterCount = deadLetters?.count ?? null;
      schemaStatus = schema;
    } catch {
      controlPlaneReady = false;
    }

    let mfaReady: boolean;
    try {
      const mfa = await getPlatformAdministratorMfaStatus(
        context.env.CONTROL_DB,
        authorization.value.userId,
      );
      mfaReady = mfa.enrollmentComplete;
    } catch {
      mfaReady = false;
    }
    const emailDeliveryReady =
      config.PLATFORM_EMAIL_MODE === "disabled" || Boolean(context.env.PLATFORM_EMAIL);
    const providerChecks = providerSetupChecks(context.env, config.EXTERNAL_EFFECTS_MODE);

    const checks: PlatformSetupStatusResponse["checks"] = [
      {
        detail: `Required runtime configuration is loaded for ${config.APP_ENV}.`,
        id: "startup_configuration",
        label: "Startup configuration",
        status: "ok",
      },
      {
        detail: controlPlaneReady
          ? "Control-plane database is responding."
          : "Control-plane database did not respond to its readiness query.",
        id: "control_plane",
        label: "Control-plane database",
        status: controlPlaneReady ? "ok" : "error",
      },
      {
        detail: mfaReady
          ? "Platform Administrator MFA enrollment is complete."
          : "Complete Platform Administrator MFA enrollment before managing the platform.",
        id: "platform_mfa",
        label: "Platform Administrator MFA",
        status: mfaReady ? "ok" : "attention",
      },
      {
        detail:
          config.PLATFORM_EMAIL_MODE === "disabled"
            ? "Platform email delivery is disabled for this environment."
            : emailDeliveryReady
              ? `Platform email binding is available in ${config.PLATFORM_EMAIL_MODE} mode.`
              : "Platform email delivery is enabled but its binding is unavailable.",
        id: "email_delivery",
        label: "Platform email delivery",
        status: emailDeliveryReady ? "ok" : "error",
      },
      {
        detail:
          jobDeadLetterCount === null
            ? "Queue failure count could not be read."
            : jobDeadLetterCount === 0
              ? "No failed background jobs are waiting for review."
              : `${String(jobDeadLetterCount)} background job${jobDeadLetterCount === 1 ? " requires" : "s require"} review.`,
        id: "background_jobs",
        label: "Background jobs",
        status:
          jobDeadLetterCount === null ? "error" : jobDeadLetterCount === 0 ? "ok" : "attention",
      },
      {
        detail:
          schemaStatus === null
            ? `No schema preparation run has been recorded. Current version: ${String(currentOrganizationSchemaVersion)}.`
            : schemaStatus.status === "failed"
              ? `The latest preparation failed after ${String(schemaStatus.processedCount)} Organizations. Current version: ${String(currentOrganizationSchemaVersion)}.`
              : `Current version: ${String(currentOrganizationSchemaVersion)}. Latest preparation: ${schemaStatus.status}.`,
        id: "schema",
        label: "Organization schema",
        status: schemaStatus?.status === "failed" ? "attention" : "ok",
      },
      {
        detail: providerChecks.stripe.detail,
        id: "stripe",
        label: "Stripe payments",
        status: providerChecks.stripe.status,
      },
      {
        detail: providerChecks.brevo.detail,
        id: "brevo",
        label: "Brevo communications",
        status: providerChecks.brevo.status,
      },
    ];

    return context.json({
      checks,
      environment: config.APP_ENV,
      jobDeadLetterCount,
      organizationCount,
      requestId: context.get("requestId"),
      version: config.BUILD_VERSION,
    } satisfies PlatformSetupStatusResponse);
  });
}
