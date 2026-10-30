import type {
  PublishedOrganizationProjection,
  PublicTicketReceipt,
  TicketConfirmationSettings,
  TransactionFeeSettings,
} from "@choir/contracts";

export type LoadState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly feeSettings: TransactionFeeSettings;
      readonly projection: PublishedOrganizationProjection;
      readonly status: "ready";
    };

export const DEFAULT_TRANSACTION_FEE_SETTINGS: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: false,
  percentage: 2.9,
};

export const DEFAULT_TICKET_CONFIRMATION_SETTINGS: TicketConfirmationSettings = {
  admissionInstructions:
    "Keep this confirmation available on your phone. Present the QR code at the door if requested.",
  pendingMessage:
    "We could not load the full ticket details yet. Your purchase may still be processing. Please refresh this page in a moment, or contact the box office if this continues.",
  qrCodeInstructions:
    "Present this QR code at the door for entry. You can also use the link in your confirmation email to open this ticket anytime.",
  successMessage: "Your purchase has been successfully processed.",
  willCallInstructions:
    "Keep this confirmation available on your phone. Present the QR code at the door if requested.",
};

export function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

export function getRefundedAmountCents(purchase: PublicTicketReceipt): number {
  // Refunds are currently full-purchase refunds; use a dedicated refunded amount when partial
  // refunds are introduced.
  return purchase.amountPaidCents;
}

export function getRefundedAt(purchase: PublicTicketReceipt): string | null {
  if (!("refundedAt" in purchase)) return null;
  const value = purchase.refundedAt;
  return typeof value === "string" ? value : null;
}

export function publicDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function publicDateWithWeekday(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(new Date(value));
}

export function publicTimeFromIso(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

export function publicTime(value: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match?.[2]) return value;
  const hour = Number(match[1]);
  return `${String(hour % 12 || 12)}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}
