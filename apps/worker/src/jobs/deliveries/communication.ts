import { organizationStoreStub } from "../../organization/rpc/client";
import {
  extractCommunicationPlaceholders,
  formatUpcomingPerformancesList,
  renderCommunicationTemplate,
  renderOrganizationLogoPlaceholder,
  replaceUpcomingPerformancesPlaceholder,
  usesUpcomingPerformancesPlaceholder,
} from "@choir/domain";
import { deliverOrganizationCommunication } from "../../communications/provider";
import { readOrganizationTicketWillCallCsv } from "../../organization/organizationTicketing";
import { readOrganizationDonationCsv } from "../../organization/organizationDonations";
import { recordCommunicationDeliveryResults } from "../../organization/organizationCommunications";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import {
  deliveryOrigin,
  readOrganizationBrandingConfig,
  readOrganizationEmailSenderConfig,
  renderEventTicketLink,
  renderPlayerLinks,
  renderPollLinks,
  renderRsvpLinks,
  resolveCanonicalOrigin,
} from "./shared";

type CommunicationDeliveryJob = Awaited<
  ReturnType<ReturnType<typeof organizationStoreStub>["claimCommunicationDeliveryBatch"]>
>;

interface TicketWillCallEmailAttachment {
  readonly content: Uint8Array<ArrayBuffer>;
  readonly disposition: "attachment";
  readonly filename: string;
  readonly type: "text/csv; charset=utf-8";
}

async function suppressUnavailableEventReportDeliveries(
  env: JobConsumerEnv,
  job: DeliveryJob,
  deliveryJob: CommunicationDeliveryJob,
): Promise<boolean> {
  const kind = deliveryJob.automation?.kind;
  if ((kind !== "ticket_will_call" && kind !== "donor_list_reminder") || deliveryJob.context) {
    return false;
  }
  if (deliveryJob.deliveries.length > 0) {
    await recordCommunicationDeliveryResults(env, {
      jobId: job.jobId,
      organizationId: job.organizationId,
      results: deliveryJob.deliveries.map((delivery) => ({
        deliveryId: delivery.id,
        failureDetail: "",
        providerMessageId: null,
        status: "suppressed",
      })),
    });
  }
  return true;
}

async function readCommunicationEmailAttachment(
  env: JobConsumerEnv,
  job: DeliveryJob,
  deliveryJob: CommunicationDeliveryJob,
): Promise<TicketWillCallEmailAttachment | null> {
  const automation = deliveryJob.automation;
  if (
    !automation ||
    (automation.kind !== "ticket_will_call" && automation.kind !== "donor_list_reminder") ||
    !deliveryJob.deliveries.some((delivery) => delivery.channel === "email")
  ) {
    return null;
  }
  const csv =
    automation.kind === "ticket_will_call"
      ? await readOrganizationTicketWillCallCsv(env, job.organizationId, automation.eventId)
      : await readOrganizationDonationCsv(env, job.organizationId);
  const encodedContent = new TextEncoder().encode(csv.content);
  const content = new Uint8Array(encodedContent.byteLength);
  content.set(encodedContent);
  if (content.byteLength > 18 * 1024 * 1024) {
    const label = automation.kind === "ticket_will_call" ? "will-call" : "donor list";
    throw new Error(`The ${label} CSV exceeds the email attachment size limit.`);
  }
  return {
    content,
    disposition: "attachment",
    filename: csv.filename,
    type: "text/csv; charset=utf-8",
  };
}

async function renderDeliveryContent(
  env: JobConsumerEnv,
  job: DeliveryJob,
  deliveryJob: Awaited<
    ReturnType<ReturnType<typeof organizationStoreStub>["claimCommunicationDeliveryBatch"]>
  >,
  delivery: Awaited<
    ReturnType<ReturnType<typeof organizationStoreStub>["claimCommunicationDeliveryBatch"]>
  >["deliveries"][number],
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
  const contentWithEventTicketLink = renderEventTicketLink(
    templatedContent,
    deliveryJob.context?.eventTicketPath ?? null,
    canonicalOrigin,
  );
  const contentWithRsvpLinks = await renderRsvpLinks(
    env,
    job.organizationId,
    contentWithEventTicketLink,
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
  const contentWithPollLinks = await renderPollLinks(
    env,
    job.organizationId,
    contentWithPlayerLinks,
    delivery,
    canonicalOrigin,
  );
  return renderUpcomingPerformancesContent(
    contentWithPollLinks,
    deliveryJob.upcomingPerformancesContext,
    canonicalOrigin,
    delivery.unsubscribeUrl,
  );
}

function safeOriginFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function renderUpcomingPerformancesContent(
  content: string,
  upcomingContext: Awaited<
    ReturnType<ReturnType<typeof organizationStoreStub>["claimCommunicationDeliveryBatch"]>
  >["upcomingPerformancesContext"],
  canonicalOrigin: string | null,
  unsubscribeUrl: string | null,
): string {
  if (!usesUpcomingPerformancesPlaceholder(content) || !upcomingContext) {
    return content;
  }
  const ticketOrigin = canonicalOrigin ?? safeOriginFromUrl(unsubscribeUrl);
  const formattedList = formatUpcomingPerformancesList(upcomingContext.performances, {
    canonicalOrigin: ticketOrigin,
    timezone: upcomingContext.timezone,
  });
  return replaceUpcomingPerformancesPlaceholder(content, formattedList);
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
  const stub = organizationStoreStub(env, job.organizationId);
  const deliveryJob = await stub.claimCommunicationDeliveryBatch({
    organizationId: job.organizationId,
    jobId: job.jobId,
  });
  if (await suppressUnavailableEventReportDeliveries(env, job, deliveryJob)) {
    await stub.finishCommunicationDeliveryBatch({
      organizationId: job.organizationId,
      jobId: job.jobId,
    });
    return;
  }
  const emailAttachment = await readCommunicationEmailAttachment(env, job, deliveryJob);
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

    if (
      !(await stub.checkCommunicationDelivery({
        organizationId: job.organizationId,
        jobId: job.jobId,
        deliveryId: delivery.id,
      }))
    )
      continue;
    const result = await deliverOrganizationCommunication(env, {
      channel: delivery.channel,
      contentMarkdown: renderedContent,
      deliveryId: delivery.id,
      destination: delivery.destination,
      ...(delivery.channel === "email" && emailAttachment
        ? { attachments: [emailAttachment] }
        : {}),
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
  await stub.finishCommunicationDeliveryBatch({
    organizationId: job.organizationId,
    jobId: job.jobId,
  });
}
