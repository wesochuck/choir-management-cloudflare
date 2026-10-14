import {
  extractCommunicationPlaceholders,
  renderCommunicationTemplate,
  renderOrganizationLogoPlaceholder,
} from "@choir/domain";
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
  resolveCanonicalOrigin,
} from "./shared";
async function renderDeliveryContent(
  env: JobConsumerEnv,
  job: DeliveryJob,
  deliveryJob: Awaited<ReturnType<typeof readCommunicationDeliveryJob>>,
  delivery: Awaited<ReturnType<typeof readCommunicationDeliveryJob>>["deliveries"][number],
  orgName: string,
  logoUrl: string | null,
  canonicalOrigin: string | null,
): Promise<string> {
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
    canonicalOrigin,
  );
  const contentWithPlayerLinks = await renderPlayerLinks(
    env,
    job.organizationId,
    contentWithRsvpLinks,
    deliveryJob.context?.eventId ?? null,
    delivery,
    canonicalOrigin,
  );
  return renderPollLinks(
    env,
    job.organizationId,
    contentWithPlayerLinks,
    delivery,
    canonicalOrigin,
  );
}

function checkUnresolvedPlaceholders(subject: string, content: string): string | null {
  const unresolvedSubject = extractCommunicationPlaceholders(subject);
  const unresolvedContent = extractCommunicationPlaceholders(content);
  const unresolved = [...new Set([...unresolvedSubject, ...unresolvedContent])];
  if (unresolved.length === 0) return null;
  return `unresolved_placeholders: Cannot deliver communication due to unresolvable placeholders: ${unresolved.join(", ")}`;
}

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
  const canonicalOrigin = await resolveCanonicalOrigin(env, job.organizationId);
  const origin = await deliveryOrigin(
    env,
    job.organizationId,
    { unsubscribeUrl: null },
    canonicalOrigin,
  );
  const logoUrl = branding.logoFileId ? `${origin}/api/public/logo` : null;

  for (const delivery of deliveryJob.deliveries) {
    const renderedContent = await renderDeliveryContent(
      env,
      job,
      deliveryJob,
      delivery,
      orgName,
      logoUrl,
      canonicalOrigin,
    );
    const renderedSubject = renderCommunicationTemplate(
      deliveryJob.subject,
      delivery.recipientName,
      {
        organizationName: orgName,
        ...(deliveryJob.context ?? {}),
      },
    );

    const failureDetail = checkUnresolvedPlaceholders(renderedSubject, renderedContent);
    if (failureDetail) {
      await recordCommunicationDeliveryResults(env, {
        jobId: job.jobId,
        organizationId: job.organizationId,
        results: [
          {
            deliveryId: delivery.id,
            failureDetail,
            providerMessageId: null,
            status: "failed",
          },
        ],
      });
      continue;
    }

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
      ticketServiceNotice: deliveryJob.ticketServiceNotice,
      subject: renderedSubject,
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
