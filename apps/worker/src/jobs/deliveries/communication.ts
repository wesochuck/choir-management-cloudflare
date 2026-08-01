import { renderCommunicationTemplate } from "@choir/domain";
import { deliverOrganizationCommunication } from "../../communications/provider";
import {
  readCommunicationDeliveryJob,
  recordCommunicationDeliveryResults,
} from "../../organization/organizationCommunications";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import { renderPlayerLinks, renderPollLinks, renderRsvpLinks } from "./shared";

export async function deliverCommunicationJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const deliveryJob = await readCommunicationDeliveryJob(env, job.organizationId, job.jobId);
  const results = [];
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
      messageId: deliveryJob.messageId,
      recipientName: delivery.recipientName,
      subject: renderCommunicationTemplate(
        deliveryJob.subject,
        delivery.recipientName,
        deliveryJob.context ?? undefined,
      ),
      unsubscribeUrl: delivery.unsubscribeUrl,
    });
    results.push({ deliveryId: delivery.id, ...result });
  }
  await recordCommunicationDeliveryResults(env, {
    jobId: job.jobId,
    organizationId: job.organizationId,
    results,
  });
}
