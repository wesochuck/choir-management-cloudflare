import type { Hono } from "hono";
import type { WorkerHonoEnvironment } from "../helpers";

import { registerRoutes as registerPublicCoreRoutes } from "../public";
import { registerRoutes as registerLocalFullstackSeedRoutes } from "../localFullstackSeed";
import { registerRoutes as registerPublicCommerceRoutes } from "../publicCommerce";
import { registerRoutes as registerPublicDonationsRoutes } from "../publicDonations";
import { registerRoutes as registerPublicEngagementRoutes } from "../publicEngagement";
import { registerRoutes as registerPublicRsvpPollsRoutes } from "../publicRsvpPolls";
import { registerRoutes as registerPublicTicketsRoutes } from "../publicTickets";
import { registerRoutes as registerPaymentsRoutes } from "../payments";

export function registerPublicGroupRoutes(router: Hono<WorkerHonoEnvironment>): void {
  registerPublicCoreRoutes(router);
  // Local-only full-stack E2E seam. The module answers 404 unless
  // APP_ENV === "local", so staging and production are unaffected.
  registerLocalFullstackSeedRoutes(router);
  registerPublicCommerceRoutes(router);
  registerPublicDonationsRoutes(router);
  registerPublicTicketsRoutes(router);
  registerPublicRsvpPollsRoutes(router);
  registerPublicEngagementRoutes(router);
  registerPaymentsRoutes(router);
}
