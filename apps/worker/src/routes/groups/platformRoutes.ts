import type { Hono } from "hono";
import type { WorkerHonoEnvironment } from "../helpers";

import { registerRoutes as registerPlatformAdministrationRoutes } from "../platformAdministration";
import { registerRoutes as registerPlatformEmailFeedbackRoutes } from "../platformEmailFeedback";
import { registerRoutes as registerPlatformEmailSuppressionRoutes } from "../platformEmailSuppressions";
import { registerRoutes as registerPlatformMaintenanceRoutes } from "../platformMaintenance";
import { registerRoutes as registerPlatformOperationsRoutes } from "../platformOperations";
import { registerRoutes as registerPlatformSetupRoutes } from "../platformSetup";

export function registerPlatformGroupRoutes(router: Hono<WorkerHonoEnvironment>): void {
  registerPlatformSetupRoutes(router);
  registerPlatformAdministrationRoutes(router);
  registerPlatformEmailSuppressionRoutes(router);
  registerPlatformEmailFeedbackRoutes(router);
  registerPlatformOperationsRoutes(router);
  registerPlatformMaintenanceRoutes(router);
}
