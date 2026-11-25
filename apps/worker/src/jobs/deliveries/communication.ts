import { organizationStoreStub } from "../../organization/rpc/client";
import {
  CommunicationRenderLimitError,
  DEFAULT_COMMUNICATION_RENDER_BODY_LIMIT,
  DEFAULT_COMMUNICATION_RENDER_SUBJECT_LIMIT,
  extractCommunicationPlaceholders,
  formatUpcomingPerformancesList,
  renderCommunicationTemplate,
  renderOrganizationLogoPlaceholder,
  replaceUpcomingPerformancesPlaceholder,
  usesUpcomingPerformancesPlaceholder,
  type CommunicationRenderLimits,
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
  bodyLimit = DEFAULT_COMMUNICATION_RENDER_BODY_LIMIT,
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
    { field: "body", maxLength: bodyLimit },
  );
  const contentWithEventTicketLink = renderEventTicketLink(
    templatedContent,
    deliveryJob.context?.eventTicketPath ?? null,
    canonicalOrigin,
    bodyLimit,
  );
  const contentWithRsvpLinks = await renderRsvpLinks(
    env,
    job.organizationId,
    contentWithEventTicketLink,
    deliveryJob.context?.eventId ?? null,
    delivery,
    canonicalOrigin,
    bodyLimit,
  );
  const contentWithPlayerLinks = await renderPlayerLinks(
    env,
    job.organizationId,
    contentWithRsvpLinks,
    deliveryJob.context?.eventId ?? null,
    delivery,
    canonicalOrigin,
    bodyLimit,
  );
  const contentWithPollLinks = await renderPollLinks(
    env,
    job.organizationId,
    contentWithPlayerLinks,
    delivery,
    canonicalOrigin,
    bodyLimit,
  );
  return renderUpcomingPerformancesContent(
    contentWithPollLinks,
    deliveryJob.upcomingPerformancesContext,
    canonicalOrigin,
    delivery.unsubscribeUrl,
    bodyLimit,
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
  bodyLimit = DEFAULT_COMMUNICATION_RENDER_BODY_LIMIT,
): string {
  if (!usesUpcomingPerformancesPlaceholder(content) || !upcomingContext) {
    if (content.length > bodyLimit) {
      throw new CommunicationRenderLimitError("body", bodyLimit);
    }
    return content;
  }
  const ticketOrigin = canonicalOrigin ?? safeOriginFromUrl(unsubscribeUrl);
  const formattedList = formatUpcomingPerformancesList(upcomingContext.performances, {
    canonicalOrigin: ticketOrigin,
    timezone: upcomingContext.timezone,
  });
  return replaceUpcomingPerformancesPlaceholder(content, formattedList, bodyLimit);
}

function checkUnresolvedPlaceholders(subject: string, content: string): string | null {
  const unresolvedSubject = extractCommunicationPlaceholders(subject);
  const unresolvedContent = extractCommunicationPlaceholders(content);
  const unresolved = [...new Set([...unresolvedSubject, ...unresolvedContent])];
  if (unresolved.length === 0) return null;
  return `unresolved_placeholders: Cannot deliver communication due to unresolvable placeholders: ${unresolved.join(", ")}`;
}

async function renderDeliverySubjectAndBody(
  env: JobConsumerEnv,
  job: DeliveryJob,
  deliveryJob: CommunicationDeliveryJob,
  delivery: CommunicationDeliveryJob["deliveries"][number],
  orgName: string,
  logoUrl: string | null,
  canonicalOrigin: string | null,
  bodyLimit: number,
  subjectLimit: number,
): Promise<
  | { readonly failureDetail: string; readonly ok: false }
  | { readonly ok: true; readonly renderedContent: string; readonly renderedSubject: string }
> {
  try {
    const renderedContent = await renderDeliveryContent(
      env,
      job,
      deliveryJob,
      delivery,
      orgName,
      logoUrl,
      canonicalOrigin,
      bodyLimit,
    );
    const subjectContext = deliveryJob.context
      ? {
          ...deliveryJob.context,
          eventLocation: deliveryJob.context.eventLocationText || deliveryJob.context.eventLocation,
        }
      : {};
    const renderedSubject = renderCommunicationTemplate(
      deliveryJob.subject,
      delivery.recipientName,
      {
        organizationName: orgName,
        ...subjectContext,
      },
      { field: "subject", maxLength: subjectLimit },
    );
    const unresolvedDetail = checkUnresolvedPlaceholders(renderedSubject, renderedContent);
    if (unresolvedDetail) {
      return { failureDetail: unresolvedDetail, ok: false };
    }
    return { ok: true, renderedContent, renderedSubject };
  } catch (error: unknown) {
    if (error instanceof CommunicationRenderLimitError) {
      return { failureDetail: `${error.code}: ${error.message}`, ok: false };
    }
    throw error;
  }
}

function resolveCommunicationRenderLimits(renderLimits?: CommunicationRenderLimits): {
  readonly bodyLimit: number;
  readonly subjectLimit: number;
} {
  return {
    bodyLimit: renderLimits?.body ?? DEFAULT_COMMUNICATION_RENDER_BODY_LIMIT,
    subjectLimit: renderLimits?.subject ?? DEFAULT_COMMUNICATION_RENDER_SUBJECT_LIMIT,
  };
}

async function resolveCommunicationDeliveryContext(env: JobConsumerEnv, organizationId: string) {
  const senderConfig = await readOrganizationEmailSenderConfig(env, organizationId);
  const branding = await readOrganizationBrandingConfig(env, organizationId);
  const trimmedOrgName = branding.organizationName.trim();
  const orgName =
    trimmedOrgName.length > 0 ? trimmedOrgName : (senderConfig.fromName ?? "Choir Management");
  const canonicalOrigin = await resolveCanonicalOrigin(env, organizationId);
  const origin = await deliveryOrigin(
    env,
    organizationId,
    { unsubscribeUrl: null },
    canonicalOrigin,
  );
  const logoUrl = branding.logoFileId ? `${origin}/api/public/logo` : null;
  return { branding, canonicalOrigin, logoUrl, orgName, senderConfig };
}

export async function deliverCommunicationJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
  renderLimits?: CommunicationRenderLimits,
): Promise<void> {
  const { bodyLimit, subjectLimit } = resolveCommunicationRenderLimits(renderLimits);
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
  const { branding, canonicalOrigin, logoUrl, orgName, senderConfig } =
    await resolveCommunicationDeliveryContext(env, job.organizationId);

  for (const delivery of deliveryJob.deliveries) {
    const rendered = await renderDeliverySubjectAndBody(
      env,
      job,
      deliveryJob,
      delivery,
      orgName,
      logoUrl,
      canonicalOrigin,
      bodyLimit,
      subjectLimit,
    );
    if (!rendered.ok) {
      await recordCommunicationDeliveryResults(env, {
        jobId: job.jobId,
        organizationId: job.organizationId,
        results: [
          {
            deliveryId: delivery.id,
            failureDetail: rendered.failureDetail,
            providerMessageId: null,
            status: "failed",
          },
        ],
      });
      continue;
    }
    const { renderedContent, renderedSubject } = rendered;

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
