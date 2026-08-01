import { type HealthResponse, type ProblemDetails } from "@choir/contracts";
import { validateStartupConfig } from "../env";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/health", (context) => {
    const config = validateStartupConfig(context.env);
    const response: HealthResponse = {
      environment: config.APP_ENV,
      fingerprint: "cloudflare-worker",
      requestId: context.get("requestId"),
      service: "choir-management-cloudflare",
      status: "ok",
      version: config.BUILD_VERSION,
    };

    return context.json(response);
  });

  router.get("/api/ready", async (context) => {
    const requestIdValue = context.get("requestId");

    try {
      validateStartupConfig(context.env);
      await context.env.CONTROL_DB.prepare("SELECT 1 AS ready").first<{ ready: number }>();
      return context.json({ requestId: requestIdValue, status: "ready" as const });
    } catch (error: unknown) {
      console.error(
        JSON.stringify({
          errorType: error instanceof Error ? error.name : "UnknownError",
          event: "readiness_check_failed",
          requestId: requestIdValue,
        }),
      );
      const problem: ProblemDetails = {
        code: "service_not_ready",
        message: "The service is not ready.",
        requestId: requestIdValue,
      };
      return context.json(problem, 503);
    }
  });
}
