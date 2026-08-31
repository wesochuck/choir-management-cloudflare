import type { Hono } from "hono";
import type { WorkerHonoEnvironment } from "../helpers";

import { registerRoutes as registerSetupCoreRoutes } from "../setup";
import { registerRoutes as registerSetupRecoveryRoutes } from "../setupRecovery";

export function registerSetupGroupRoutes(router: Hono<WorkerHonoEnvironment>): void {
  registerSetupCoreRoutes(router);
  registerSetupRecoveryRoutes(router);
}
