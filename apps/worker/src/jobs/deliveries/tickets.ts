import { renderCommunicationTemplate } from "@choir/domain";
import { deliverOrganizationCommunication } from "../../communications/provider";
import { issueOrganizationTicketScanCredential } from "../../organization/organizationTicketing";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import { issueSignedLink } from "../../security/signedLinks";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import { renderTicketLinks, ticketNotificationJobSchema } from "./shared";

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
  const templateValues = {
    eventDate: new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: notification.data.timezone,
    }).format(new Date(notification.data.eventStartsAt)),
    eventTitle: notification.data.eventTitle,
    ticketAmount: new Intl.NumberFormat("en-US", {
      currency: notification.data.currency.toUpperCase(),
      style: "currency",
    }).format(notification.data.amountPaidCents / 100),
    ticketDiscount: money(notification.data.discountAmountCents, notification.data.currency),
    ticketDiscountCode: notification.data.discountCode ?? "",
    ticketFee: money(notification.data.feeCents, notification.data.currency),
    ticketOriginalSubtotal: money(
      notification.data.originalSubtotalCents,
      notification.data.currency,
    ),
    ticketSubtotal: money(notification.data.discountedSubtotalCents, notification.data.currency),
    ticketBundleName: notification.data.bundleTitle ?? "",
    ticketQuantity: String(notification.data.quantity),
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
  );
  const discountSummary = notification.data.discountCode
    ? [
        "",
        "",
        "Discount code: " + notification.data.discountCode,
        "Original subtotal: " +
          money(notification.data.originalSubtotalCents, notification.data.currency),
        "Discount: -" + money(notification.data.discountAmountCents, notification.data.currency),
        "Discounted subtotal: " +
          money(notification.data.discountedSubtotalCents, notification.data.currency),
        "Processing fee: " + money(notification.data.feeCents, notification.data.currency),
        "Total: " + money(notification.data.amountPaidCents, notification.data.currency),
      ].join("\n")
    : "";
  const credential = await issueOrganizationTicketScanCredential(
    env,
    job.organizationId,
    notification.data.purchaseId,
  );
  const scanToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: credential.expiresAt,
    issuedAt: credential.issuedAt,
    nonce: credential.nonce,
    organizationId: job.organizationId,
    purpose: "ticket_scan",
    resourceId: notification.data.purchaseId,
    version: 1,
  });
  const result = await deliverOrganizationCommunication(env, {
    channel: "email",
    contentMarkdown:
      contentWithTicketLink + discountSummary + "\n\nTicket credential: " + scanToken,
    deliveryId: notification.data.id,
    destination: notification.data.destination,
    messageId: notification.data.id,
    organizationId: job.organizationId,
    recipientName: notification.data.buyerName,
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
