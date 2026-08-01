import { handleStripeWebhook } from "../payments/stripeWebhookHandler";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/webhook/stripe", handleStripeWebhook);
}
