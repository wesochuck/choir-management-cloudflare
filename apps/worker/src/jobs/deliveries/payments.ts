import { deliverOrganizationCommunication } from "../../communications/provider";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import { issueSignedLink } from "../../security/signedLinks";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import {
  deliveryOrigin,
  paymentNotificationJobSchema,
  readOrganizationBrandingConfig,
  readOrganizationEmailSenderConfig,
} from "./shared";
import type { z } from "zod";

async function renderPaymentNotificationContent(
  env: Pick<JobConsumerEnv, "PRODUCT_BASE_DOMAIN" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  notification: z.infer<typeof paymentNotificationJobSchema>,
): Promise<string> {
  if (
    notification.paymentType !== "donation" ||
    !notification.contentMarkdown.includes("{{DONATION_RECEIPT_LINK}}")
  ) {
    return notification.contentMarkdown;
  }
  const issuedAt = Math.floor(Date.now() / 1_000);
  const token = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: issuedAt + 7 * 24 * 60 * 60,
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "donation_receipt",
    resourceId: notification.resourceId,
    version: 1,
  });
  const origin =
    env.PRODUCT_BASE_DOMAIN === "localhost"
      ? "http://localhost"
      : `https://${env.PRODUCT_BASE_DOMAIN}`;
  const link = `${origin}/donate/success?token=${encodeURIComponent(token)}`;
  return notification.contentMarkdown.replaceAll(
    "{{DONATION_RECEIPT_LINK}}",
    `[View your donation receipt](${link})`,
  );
}

export async function deliverPaymentNotificationJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const objectStub = organizationStoreStub(env, job.organizationId);
  const url = new URL("https://organization.internal/internal/payments/notification-job");
  url.searchParams.set("organizationId", job.organizationId);
  url.searchParams.set("jobId", job.jobId);
  const response = await invokeOrganizationRpc(objectStub, url);
  const notification = paymentNotificationJobSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!response.ok || !notification.success) {
    throw new Error("The payment notification job is unavailable.");
  }
  const contentMarkdown = await renderPaymentNotificationContent(
    env,
    job.organizationId,
    notification.data,
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
    sourceKind: "payment_notification",
    subject: notification.data.subject,
    unsubscribeUrl: null,
  });
  const recordResponse = await invokeOrganizationRpc(
    objectStub,
    "https://organization.internal/internal/payments/notification-result",
    {
      body: JSON.stringify({
        action: "record_payment_notification_result",
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
  if (!recordResponse.ok) throw new Error("The payment notification result was rejected.");
}
