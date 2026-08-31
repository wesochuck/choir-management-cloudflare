import { renderCommunicationTemplate, renderOrganizationLogoPlaceholder } from "@choir/domain";
import { deliverOrganizationCommunication } from "../../communications/provider";
import {
  readCommunicationDeliveryJob,
  recordCommunicationDeliveryResults,
} from "../../organization/organizationCommunications";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import {
  deliveryOrigin,
  readOrganizationBrandingConfig,
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
  const branding = await readOrganizationBrandingConfig(env, job.organizationId);
  const trimmedOrgName = branding.organizationName.trim();
  const orgName =
    trimmedOrgName.length > 0 ? trimmedOrgName : (senderConfig.fromName ?? "Choir Management");
  const origin = await deliveryOrigin(env, job.organizationId, { unsubscribeUrl: null });
  const logoUrl = branding.logoFileId ? `${origin}/api/public/logo` : null;

  for (const delivery of deliveryJob.deliveries) {
    const logoPlaceholder = renderOrganizationLogoPlaceholder({
      channel: delivery.channel,
      logoUrl,
      organizationName: orgName,
    });
    const templatedContent = renderCommunicationTemplate(
      deliveryJob.contentMarkdown,
      delivery.recipientName,
      {
        organizationLogo: logoPlaceholder,
        organizationName: orgName,
        ...(deliveryJob.context ?? {}),
      },
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
      organizationLogoUrl: logoUrl,
      organizationName: orgName,
      physicalAddress: branding.physicalAddress,
      recipientName: delivery.recipientName,
      replyTo: senderConfig.replyTo ?? undefined,
      sendingDomain: senderConfig.sendingDomain ?? undefined,
      sourceId: delivery.id,
      sourceKind: delivery.channel === "email" ? "communication_delivery" : undefined,
      subject: renderCommunicationTemplate(deliveryJob.subject, delivery.recipientName, {
        organizationName: orgName,
        ...(deliveryJob.context ?? {}),
      }),
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
