import { renderCommunicationTemplate } from "@choir/domain";
import { deliverOrganizationCommunication } from "../../communications/provider";
import {
  readCommunicationDeliveryJob,
  recordCommunicationDeliveryResults,
} from "../../organization/organizationCommunications";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import {
  readOrganizationEmailSenderConfig,
  renderPlayerLinks,
  renderPollLinks,
  renderRsvpLinks,
} from "./shared";

export async function deliverCommunicationJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const deliveryJob = await readCommunicationDeliveryJob(env, job.organizationId, job.jobId);
  const senderConfig = await readOrganizationEmailSenderConfig(env, job.organizationId);
  for (const delivery of deliveryJob.deliveries) {
    const templatedContent = renderCommunicationTemplate(
      deliveryJob.contentMarkdown,
      delivery.recipientName,
      deliveryJob.context ?? undefined,
    );
    const contentWithRsvpLinks = await renderRsvpLinks(
      env,
      job.organizationId,
      templatedContent,
      deliveryJob.context?.eventId ?? null,
      delivery,
    );
    const contentWithPlayerLinks = await renderPlayerLinks(
      env,
      job.organizationId,
      contentWithRsvpLinks,
      deliveryJob.context?.eventId ?? null,
      delivery,
    );
    const renderedContent = await renderPollLinks(
      env,
      job.organizationId,
      contentWithPlayerLinks,
      delivery,
    );
    const result = await deliverOrganizationCommunication(env, {
      channel: delivery.channel,
      contentMarkdown: renderedContent,
      deliveryId: delivery.id,
      destination: delivery.destination,
      fromName: senderConfig.fromName ?? undefined,
      messageId: deliveryJob.messageId,
      organizationId: job.organizationId,
      recipientName: delivery.recipientName,
      replyTo: senderConfig.replyTo ?? undefined,
      sendingDomain: senderConfig.sendingDomain ?? undefined,
      sourceId: delivery.id,
      sourceKind: delivery.channel === "email" ? "communication_delivery" : undefined,
      subject: renderCommunicationTemplate(
        deliveryJob.subject,
        delivery.recipientName,
        deliveryJob.context ?? undefined,
      ),
      unsubscribeUrl: delivery.unsubscribeUrl,
    });
    // Persist each result before moving on so a worker crash cannot cause all
    // earlier successful deliveries to be retried as queued.
    await recordCommunicationDeliveryResults(env, {
      jobId: job.jobId,
      organizationId: job.organizationId,
      results: [{ deliveryId: delivery.id, ...result }],
    });
  }
}
