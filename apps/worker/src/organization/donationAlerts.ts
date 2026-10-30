import {
  escapeMarkdown,
  financialAlertRecipients,
  formatMoney,
  type TicketSaleAlertEnv,
} from "./ticketSaleAlerts";
import { queueAutomatedOrganizationCommunication } from "./organizationCommunications";
import { listOrganizationProfiles } from "./profiles";

export type DonationAlertEnv = TicketSaleAlertEnv;

export interface DonationAlertInput {
  readonly actorUserId?: string;
  readonly amountCents: number;
  readonly buyerEmail?: string | null;
  readonly buyerName: string;
  readonly currency?: string;
  readonly donationId: string;
  readonly feeCents?: number;
  readonly includesProgramAd?: boolean;
  readonly orderUrl: string;
  readonly organizationId: string;
  readonly organizationOrigin?: string;
  readonly paymentMethod?: string;
  readonly paymentReference?: string | null;
  readonly requestId: string;
  readonly selectedLevelName?: string | null;
  readonly sponsorName?: string | null;
  readonly tributeName?: string | null;
  readonly tributeType?: string | null;
}

export function formatDonationPaymentMethod(method?: string): string {
  switch (method) {
    case "stripe":
      return "Credit/Debit Card (Stripe)";
    case "check":
      return "Check";
    case "cash":
      return "Cash";
    case "bank_transfer":
      return "Bank transfer";
    case "card_offline":
      return "Card (offline)";
    case "other":
      return "Other";
    default:
      return method && method.length > 0 ? method : "Stripe";
  }
}

function formatProcessingFeeLines(
  amountCents: number,
  feeCents: number | undefined,
  currency: string,
): readonly string[] {
  if (!feeCents || feeCents <= 0) return [];
  return [
    `- **Processing fee covered:** ${formatMoney(feeCents, currency)}`,
    `- **Total charged:** ${formatMoney(amountCents + feeCents, currency)}`,
  ];
}

function formatTributeLine(
  tributeType: string | null | undefined,
  tributeName: string | null | undefined,
): string | null {
  const trimmed = tributeName?.trim();
  if (!tributeType || tributeType === "none" || !trimmed || trimmed.length === 0) {
    return null;
  }
  const kind = tributeType === "memory" ? "In memory of" : "In honor of";
  return `- **Tribute:** ${kind} ${escapeMarkdown(trimmed)}`;
}

function formatSponsorshipLine(
  includesProgramAd: boolean | undefined,
  sponsorName: string | null | undefined,
): string | null {
  if (!includesProgramAd) return null;
  const sponsor = sponsorName?.trim();
  return `- **Program ad sponsorship:** Included${sponsor ? ` (Sponsor: ${escapeMarkdown(sponsor)})` : ""}`;
}

function formatBuyerLine(buyerName: string, buyerEmail?: string | null): string {
  const email = buyerEmail?.trim();
  if (email && email.length > 0) {
    return `- **Donor:** ${escapeMarkdown(buyerName)} (${escapeMarkdown(email)})`;
  }
  return `- **Donor:** ${escapeMarkdown(buyerName)}`;
}

export function buildDonationAlertContent(input: DonationAlertInput): {
  readonly contentMarkdown: string;
  readonly subject: string;
} {
  const effectiveCurrency = input.currency ?? "USD";
  const formattedAmount = formatMoney(input.amountCents, effectiveCurrency);
  const subject = `Donation receipt: ${input.buyerName} — ${formattedAmount}`.slice(0, 300);

  const lines = [
    "## Donation receipt",
    "",
    "A donation was received.",
    "",
    `- **Amount:** ${formattedAmount}`,
    ...formatProcessingFeeLines(input.amountCents, input.feeCents, effectiveCurrency),
    formatBuyerLine(input.buyerName, input.buyerEmail),
  ];

  const selectedLevel = input.selectedLevelName?.trim();
  if (selectedLevel && selectedLevel.length > 0) {
    lines.push(`- **Donation level:** ${escapeMarkdown(selectedLevel)}`);
  }

  const tributeLine = formatTributeLine(input.tributeType, input.tributeName);
  if (tributeLine) {
    lines.push(tributeLine);
  }

  const sponsorshipLine = formatSponsorshipLine(input.includesProgramAd, input.sponsorName);
  if (sponsorshipLine) {
    lines.push(sponsorshipLine);
  }

  lines.push(`- **Payment method:** ${formatDonationPaymentMethod(input.paymentMethod)}`);

  const paymentReference = input.paymentReference?.trim();
  if (paymentReference && paymentReference.length > 0) {
    lines.push(`- **Payment reference:** ${escapeMarkdown(paymentReference)}`);
  }

  lines.push(
    `- **Donations link:** [${input.orderUrl}](${input.orderUrl})`,
    "",
    `[View donations in admin](${input.orderUrl})`,
  );

  return {
    contentMarkdown: lines.join("\n"),
    subject,
  };
}

export async function queueDonationAlert(
  env: DonationAlertEnv,
  input: DonationAlertInput,
): Promise<Awaited<ReturnType<typeof queueAutomatedOrganizationCommunication>> | null> {
  if (!env.CONTROL_DB) return null;

  const profiles = await listOrganizationProfiles(env, input.organizationId);
  const recipients = await financialAlertRecipients(env.CONTROL_DB, input.organizationId, profiles);
  if (recipients.length === 0) return null;

  const { contentMarkdown, subject } = buildDonationAlertContent(input);
  const organizationOrigin = input.organizationOrigin ?? new URL(input.orderUrl).origin;

  return queueAutomatedOrganizationCommunication(
    env,
    {
      actorUserId: input.actorUserId ?? "public_guest",
      organizationId: input.organizationId,
      organizationOrigin,
      requestId: input.requestId,
    },
    {
      contentMarkdown,
      dedupeKey: `donation-alert:${input.donationId}`,
      eventId: null,
      recipients,
      subject,
    },
  );
}
