import type { Hono } from "hono";
import type { WorkerHonoEnvironment } from "../helpers";

import { registerRoutes as registerMemberEmailChangeRoutes } from "../memberEmailChange";
import { registerRoutes as registerSingerCoreRoutes } from "../singer";
import { registerRoutes as registerSingerBillingRoutes } from "../singerBilling";
import { registerRoutes as registerSingerDashboardRoutes } from "../singerDashboard";
import { registerRoutes as registerSingerDirectoryRoutes } from "../singerDirectory";
import { registerRoutes as registerSingerEventsRoutes } from "../singerEvents";
import { registerRoutes as registerSingerMusicRoutes } from "../singerMusic";
import { registerRoutes as registerSingerSeatingRoutes } from "../singerSeating";

export function registerSingerGroupRoutes(router: Hono<WorkerHonoEnvironment>): void {
  registerSingerCoreRoutes(router);
  registerSingerBillingRoutes(router);
  registerSingerDashboardRoutes(router);
  registerSingerDirectoryRoutes(router);
  registerSingerEventsRoutes(router);
  registerSingerMusicRoutes(router);
  registerSingerSeatingRoutes(router);
  registerMemberEmailChangeRoutes(router);
}
