import { deliverOrganizationCommunication } from "../../communications/provider";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import {
  auditionNotificationJobSchema,
  deliveryOrigin,
  readOrganizationBrandingConfig,
  readOrganizationEmailSenderConfig,
  renderAuditionLink,
} from "./shared";

export async function deliverAuditionNotificationJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const objectStub = organizationStoreStub(env, job.organizationId);
  const url = new URL("https://organization.internal/internal/audition/notification-job");
  url.searchParams.set("organizationId", job.organizationId);
  url.searchParams.set("jobId", job.jobId);
  const response = await invokeOrganizationRpc(objectStub, url);
  const notification = auditionNotificationJobSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!response.ok || !notification.success) {
    throw new Error("The audition notification job is unavailable.");
  }
  const contentMarkdown = await renderAuditionLink(
    env,
    job.organizationId,
    notification.data.contentMarkdown,
    notification.data.auditionId,
    notification.data.kind,
  );
  const [senderConfig, branding] = await Promise.all([
    readOrganizationEmailSenderConfig(env, job.organizationId),
    readOrganizationBrandingConfig(env, job.organizationId),
  ]);
  const origin = await deliveryOrigin(env, job.organizationId, { unsubscribeUrl: null });
  const logoUrl = branding.logoFileId ? `${origin}/api/public/logo` : null;
  const result = await deliverOrganizationCommunication(env, {
    channel: "email",
    contentMarkdown,
    deliveryId: notification.data.id,
    destination: notification.data.destination,
    fromName: senderConfig.fromName ?? undefined,
    messageId: notification.data.id,
    organizationId: job.organizationId,
    organizationLogoUrl: logoUrl,
    organizationName: branding.organizationName || undefined,
    physicalAddress: branding.physicalAddress,
    recipientName: notification.data.recipientName,
    replyTo: senderConfig.replyTo ?? undefined,
    sendingDomain: senderConfig.sendingDomain ?? undefined,
    sourceId: notification.data.id,
    sourceKind: "audition_notification",
    subject: notification.data.subject,
    unsubscribeUrl: null,
  });
  const recordResponse = await invokeOrganizationRpc(
    objectStub,
    "https://organization.internal/internal/audition/notification-result",
    {
      body: JSON.stringify({
        failureDetail: result.failureDetail,
        jobId: job.jobId,
        organizationId: job.organizationId,
        providerMessageId: result.providerMessageId,
        status: result.status,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!recordResponse.ok) throw new Error("The audition notification result was rejected.");
}
