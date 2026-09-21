import { handleStripeWebhook, handleStripeV2Webhook } from "../payments/stripeWebhookHandler";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/webhook/stripe", handleStripeWebhook);
  router.post("/api/webhook/stripe/v2", handleStripeV2Webhook);
}
