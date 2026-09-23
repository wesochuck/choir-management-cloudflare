import { renderCommunicationTemplate } from "@choir/domain";
import { deliverOrganizationCommunication } from "../../communications/provider";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import { formatTicketBundleEventList } from "./ticketEventList";
import {
  deliveryOrigin,
  readOrganizationBrandingConfig,
  readOrganizationEmailSenderConfig,
  renderTicketLinks,
  ticketNotificationJobSchema,
} from "./shared";

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    currency: currency.toUpperCase(),
    style: "currency",
  }).format(cents / 100);
}

export async function deliverTicketNotificationJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const objectStub = organizationStoreStub(env, job.organizationId);
  const url = new URL("https://organization.internal/internal/ticketing/notification-job");
  url.searchParams.set("organizationId", job.organizationId);
  url.searchParams.set("jobId", job.jobId);
  const response = await invokeOrganizationRpc(objectStub, url);
  const notification = ticketNotificationJobSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!response.ok || !notification.success) {
    throw new Error("The ticket notification job is unavailable.");
  }
  const bundleEventList = formatTicketBundleEventList(
    notification.data.bundleEvents,
    notification.data.timezone,
  );
  const templateValues = {
    buyerName: notification.data.buyerName,
    eventDate: new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: notification.data.timezone,
    }).format(new Date(notification.data.eventStartsAt)),
    eventLocation: notification.data.eventLocation,
    eventTitle: notification.data.eventTitle,
    refundAmount: money(notification.data.amountPaidCents, notification.data.currency),
    refundDate: notification.data.refundDate
      ? new Intl.DateTimeFormat("en-US", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: notification.data.timezone,
        }).format(new Date(notification.data.refundDate))
      : "",
    ticketAmount: new Intl.NumberFormat("en-US", {
      currency: notification.data.currency.toUpperCase(),
      style: "currency",
    }).format(notification.data.amountPaidCents / 100),
    ticketBundleName: notification.data.bundleTitle ?? "",
    ticketDiscount: money(notification.data.discountAmountCents, notification.data.currency),
    ticketDiscountCode: notification.data.discountCode ?? "",
    ticketEventList: bundleEventList,
    TICKET_EVENT_LIST: bundleEventList,
    ticketFee: money(notification.data.feeCents, notification.data.currency),
    ticketOriginalSubtotal: money(
      notification.data.originalSubtotalCents,
      notification.data.currency,
    ),
    ticketQuantity: String(notification.data.quantity),
    ticketSubtotal: money(notification.data.discountedSubtotalCents, notification.data.currency),
    venueAddress: notification.data.venueAddress,
    venueName: notification.data.venueName,
  };
  const templatedContent = renderCommunicationTemplate(
    notification.data.contentMarkdown,
    notification.data.buyerName,
    templateValues,
  );
  const contentWithTicketLink = await renderTicketLinks(
    env,
    job.organizationId,
    templatedContent,
    notification.data.purchaseId,
    notification.data.eventStartsAt,
    notification.data.kind === "refund",
  );
  const discountSummary = notification.data.discountCode
    ? [
        "",
        "",
        "### Payment summary",
        "",
        "- **Discount code:** " + notification.data.discountCode,
        "- **Original subtotal:** " +
          money(notification.data.originalSubtotalCents, notification.data.currency),
        "- **Discount:** -" +
          money(notification.data.discountAmountCents, notification.data.currency),
        "- **Discounted subtotal:** " +
          money(notification.data.discountedSubtotalCents, notification.data.currency),
        "- **Processing fee:** " + money(notification.data.feeCents, notification.data.currency),
        "- **Total:** " + money(notification.data.amountPaidCents, notification.data.currency),
      ].join("\n")
    : "";
  const [senderConfig, branding] = await Promise.all([
    readOrganizationEmailSenderConfig(env, job.organizationId),
    readOrganizationBrandingConfig(env, job.organizationId),
  ]);
  const origin = await deliveryOrigin(env, job.organizationId, { unsubscribeUrl: null });
  const logoUrl = branding.logoFileId ? `${origin}/api/public/logo` : null;
  const result = await deliverOrganizationCommunication(env, {
    channel: "email",
    contentMarkdown: contentWithTicketLink + discountSummary,
    deliveryId: notification.data.id,
    destination: notification.data.destination,
    fromName: senderConfig.fromName ?? undefined,
    messageId: notification.data.id,
    organizationId: job.organizationId,
    organizationLogoUrl: logoUrl,
    organizationName: branding.organizationName || undefined,
    physicalAddress: branding.physicalAddress,
    recipientName: notification.data.buyerName,
    replyTo: senderConfig.replyTo ?? undefined,
    sendingDomain: senderConfig.sendingDomain ?? undefined,
    sourceId: notification.data.id,
    sourceKind: "ticket_notification",
    subject: renderCommunicationTemplate(
      notification.data.subject,
      notification.data.buyerName,
      templateValues,
    ),
    unsubscribeUrl: null,
  });
  const recordResponse = await invokeOrganizationRpc(
    objectStub,
    "https://organization.internal/internal/ticketing/manage",
    {
      body: JSON.stringify({
        action: "record_ticket_notification_result",
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
  if (!recordResponse.ok) throw new Error("The ticket notification result was rejected.");
}
