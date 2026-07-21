import { processDeadLetterBatch, processDeliveryBatch } from "./jobs/consumer";
import { OrganizationStore } from "./organization/OrganizationStore";
import { router } from "./router";
import { ProvisioningWorkflow } from "./workflows/ProvisioningWorkflow";
import type { Env } from "./env";

export { OrganizationStore, ProvisioningWorkflow };

const worker = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    return router.fetch(request, env, executionContext);
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    if (batch.queue === env.JOBS_DLQ_NAME) {
      await processDeadLetterBatch(batch, env);
      return;
    }
    await processDeliveryBatch(batch, env);
  },
  scheduled(event: ScheduledController, env: Env, executionContext: ExecutionContext): void {
    executionContext.waitUntil(
      Promise.resolve().then(() => {
        console.info(
          JSON.stringify({
            environment: env.APP_ENV,
            event: "scheduled_safety_tick",
            scheduledTime: event.scheduledTime,
          }),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;

export default worker;
