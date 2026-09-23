export type CommunicationChannel = "Both" | "Email" | "SMS";
export type DeliveryChannel = "email" | "sms";
export type DeliveryStatus = "failed" | "processing" | "queued" | "sent" | "suppressed";
export type ProviderDeliveryStatus =
  "accepted" | "bounced" | "complained" | "deferred" | "delivered" | "failed" | "rejected";

export interface ReachableRecipient {
  readonly email: string;
  readonly phone: string;
}

export interface CommunicationReach {
  readonly both: number;
  readonly email: number;
  readonly sms: number;
  readonly ticketBuyerPurchasesOverLimit: number;
  readonly total: number;
  readonly undeliverableTicketBuyerPurchases: number;
  readonly unreachable: number;
}

export interface DeliveryRecord {
  readonly attempts: number;
  readonly channel: DeliveryChannel;
  readonly destination: string;
  readonly failureDetail: string;
  readonly providerStatus?: ProviderDeliveryStatus | null;
  readonly status: DeliveryStatus;
  readonly updatedAt: string;
}

interface ChannelCounts {
  failed: number;
  processing: number;
  queued: number;
  sent: number;
  suppressed: number;
  total: number;
}

interface ProviderCounts {
  accepted: number;
  bounced: number;
  complained: number;
  deferred: number;
  delivered: number;
  failed: number;
  rejected: number;
  total: number;
}

function available(recipient: ReachableRecipient, channel: CommunicationChannel): boolean {
  if (channel === "Email") return recipient.email.trim().length > 0;
  if (channel === "SMS") return recipient.phone.trim().length > 0;
  return recipient.email.trim().length > 0 || recipient.phone.trim().length > 0;
}

export function communicationReach(
  recipients: readonly ReachableRecipient[],
  channel: CommunicationChannel,
  undeliverableTicketBuyerPurchases = 0,
  ticketBuyerPurchasesOverLimit = 0,
): CommunicationReach {
  let email = 0;
  let sms = 0;
  let both = 0;
  let unreachable = 0;
  for (const recipient of recipients) {
    const hasEmail = recipient.email.trim().length > 0;
    const hasSms = recipient.phone.trim().length > 0;
    if (hasEmail) email += 1;
    if (hasSms) sms += 1;
    if (hasEmail && hasSms) both += 1;
    if (!available(recipient, channel)) unreachable += 1;
  }
  return {
    both,
    email,
    sms,
    ticketBuyerPurchasesOverLimit,
    total: recipients.length - unreachable,
    undeliverableTicketBuyerPurchases,
    unreachable,
  };
}

export function renderCommunicationTemplate(
  template: string,
  recipientName: string,
  values: Readonly<Record<string, string>> = {},
): string {
  const replacements = { buyerName: recipientName, singerName: recipientName, ...values };
  return Object.entries(replacements).reduce(
    (message, [key, value]) =>
      message.split(`{{${key}}}`).join(value).split(`{${key}}`).join(value),
    template,
  );
}

export function renderOrganizationLogoPlaceholder({
  channel,
  logoUrl,
  organizationName,
}: {
  readonly channel: DeliveryChannel;
  readonly logoUrl?: string | null;
  readonly organizationName: string;
}): string {
  if (channel === "sms") {
    return organizationName;
  }
  if (logoUrl && logoUrl.trim().length > 0) {
    return `<img src="${logoUrl}" alt="${organizationName}" style="max-width:200px;height:auto;display:block;" />`;
  }
  return `<span style="font-size:18px;font-weight:bold;color:#1b4d3e;">${organizationName}</span>`;
}

export function maskCommunicationDestination(
  destination: string,
  channel: DeliveryChannel,
): string {
  if (channel === "sms") {
    const digits = destination.replace(/\D/g, "");
    return `***${digits.slice(-4) || "****"}`;
  }
  const at = destination.indexOf("@");
  return at > 0 ? `${destination.slice(0, 1)}***${destination.slice(at)}` : "***";
}

export type CommunicationFailureCategory =
  | "authentication"
  | "invalid-destination"
  | "provider-rejected"
  | "rate-limit"
  | "timeout"
  | "unknown";

export function communicationFailureCategory(detail: string): CommunicationFailureCategory {
  const normalized = detail.toLowerCase();
  if (/429|rate[- ]?limit|too many/.test(normalized)) return "rate-limit";
  if (/auth|credential|token|unauthorized/.test(normalized)) return "authentication";
  if (/timeout|timed out/.test(normalized)) return "timeout";
  if (/invalid|unsubscribe|bounce|undeliverable/.test(normalized)) return "invalid-destination";
  if (/reject|block|spam|provider/.test(normalized)) return "provider-rejected";
  return "unknown";
}

function emptyCounts(): ChannelCounts {
  return { failed: 0, processing: 0, queued: 0, sent: 0, suppressed: 0, total: 0 };
}

function emptyProviderCounts(): ProviderCounts {
  return {
    accepted: 0,
    bounced: 0,
    complained: 0,
    deferred: 0,
    delivered: 0,
    failed: 0,
    rejected: 0,
    total: 0,
  };
}

function increment(counts: ChannelCounts, status: DeliveryStatus): void {
  counts[status] += 1;
  counts.total += 1;
}

function incrementProvider(counts: ProviderCounts, status: ProviderDeliveryStatus): void {
  counts[status] += 1;
  counts.total += 1;
}

function deliveryState(counts: ChannelCounts) {
  if (counts.total === 0) return "tracking-unavailable" as const;
  if (counts.queued === counts.total) return "queued" as const;
  if (counts.queued > 0 || counts.processing > 0) return "sending" as const;
  if (counts.failed > 0 && counts.sent > 0) return "partial" as const;
  if (counts.failed > 0) return "failed" as const;
  return "sent" as const;
}

export function summarizeCommunicationDeliveries(
  messageId: string,
  records: readonly DeliveryRecord[],
) {
  const email = emptyCounts();
  const sms = emptyCounts();
  const provider = emptyProviderCounts();
  const failures = [];
  let hasMoreFailures = false;
  let lastActivity: string | null = null;
  for (const record of records) {
    increment(record.channel === "email" ? email : sms, record.status);
    if (record.providerStatus) incrementProvider(provider, record.providerStatus);
    if (!lastActivity || record.updatedAt > lastActivity) lastActivity = record.updatedAt;
    if (record.status === "failed") {
      if (failures.length < 20) {
        failures.push({
          attempts: record.attempts,
          category: communicationFailureCategory(record.failureDetail),
          channel: record.channel,
          lastSeen: record.updatedAt,
          maskedDestination: maskCommunicationDestination(record.destination, record.channel),
        });
      } else {
        hasMoreFailures = true;
      }
    }
  }
  const total = emptyCounts();
  for (const status of ["failed", "processing", "queued", "sent", "suppressed"] as const) {
    total[status] = email[status] + sms[status];
  }
  total.total = email.total + sms.total;
  return {
    email,
    failures,
    hasMoreFailures,
    lastActivity,
    messageId,
    provider,
    sms,
    state: deliveryState(total),
    total,
  };
}
