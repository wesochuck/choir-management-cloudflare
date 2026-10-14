import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";
import { registerPlatformDiagnosticRoutes } from "./platformOperations/diagnostics";
import { registerPlatformElevationRoutes } from "./platformOperations/elevations";
import { registerPlatformOrganizationRoutes } from "./platformOperations/organizations";
import { registerPlatformQueueSettingRoutes } from "./platformOperations/queueSettings";
import { registerPlatformReconciliationRoutes } from "./platformOperations/reconciliation";
import { registerPlatformStripeConnectRoutes } from "./platformOperations/stripeConnect";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  registerPlatformOrganizationRoutes(router);
  registerPlatformStripeConnectRoutes(router);
  registerPlatformReconciliationRoutes(router);
  registerPlatformElevationRoutes(router);
  registerPlatformDiagnosticRoutes(router);
  registerPlatformQueueSettingRoutes(router);
}
