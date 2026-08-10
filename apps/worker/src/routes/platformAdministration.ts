import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";
import { registerPlatformDeadLetterRoutes } from "./platformAdministration/deadLetters";
import { registerPlatformFleetRoutes } from "./platformAdministration/fleet";
import { registerPlatformMfaRoutes } from "./platformAdministration/mfa";
import { registerPlatformOrganizationRoutes } from "./platformAdministration/organizations";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  registerPlatformMfaRoutes(router);
  registerPlatformFleetRoutes(router);
  registerPlatformDeadLetterRoutes(router);
  registerPlatformOrganizationRoutes(router);
}
