import {
  processEmailProviderDeadLetterBatch,
  processEmailProviderQueue,
  reconcileEmailProviderEvents,
} from "./communications/emailFeedback";
import { reconcileEmailChangeNotifications } from "./auth/emailChange";
import { processDeadLetterBatch, processDeliveryBatch } from "./jobs/consumer";
import { OrganizationStore } from "./organization/OrganizationStore";
import { router, setSecurityHeaders } from "./router";
import { CustomDomainWorkflow } from "./workflows/CustomDomainWorkflow";
import { FleetSchemaWorkflow } from "./workflows/FleetSchemaWorkflow";
import { ProvisioningWorkflow } from "./workflows/ProvisioningWorkflow";
import type { Env } from "./env";

export { CustomDomainWorkflow, FleetSchemaWorkflow, OrganizationStore, ProvisioningWorkflow };

const worker = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const response = await router.fetch(request, env, executionContext);
    const pathname = new URL(request.url).pathname;
    if (response.status !== 404 || pathname === "/api" || pathname.startsWith("/api/")) {
      return response;
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    setSecurityHeaders(headers);
    return new Response(assetResponse.body, {
      headers,
      status: assetResponse.status,
      statusText: assetResponse.statusText,
    });
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    if (batch.queue === env.EMAIL_EVENTS_QUEUE_NAME) {
      await processEmailProviderQueue(batch, env);
      return;
    }
    if (batch.queue === env.EMAIL_EVENTS_DLQ_NAME) {
      await processEmailProviderDeadLetterBatch(batch, env);
      return;
    }
    if (batch.queue === env.JOBS_QUEUE_NAME) {
      await processDeliveryBatch(batch, env);
      return;
    }
    if (batch.queue === env.JOBS_DLQ_NAME) {
      await processDeadLetterBatch(batch, env);
      return;
    }
    console.error(
      JSON.stringify({
        event: "unknown_queue_batch",
        messagesCount: batch.messages.length,
        queue: batch.queue,
      }),
    );
    throw new Error(`Unhandled queue: ${batch.queue}`);
  },
  scheduled(event: ScheduledController, env: Env, executionContext: ExecutionContext): void {
    executionContext.waitUntil(
      Promise.resolve().then(() => {
        return Promise.all([
          reconcileEmailChangeNotifications(env),
          reconcileEmailProviderEvents(env),
        ]).then(() => {
          console.info(
            JSON.stringify({
              environment: env.APP_ENV,
              event: "scheduled_safety_tick",
              scheduledTime: event.scheduledTime,
            }),
          );
        });
      }),
    );
  },
} satisfies ExportedHandler<Env>;

export default worker;
