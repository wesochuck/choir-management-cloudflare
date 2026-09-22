export interface TicketPriceInput {
  readonly advancePriceCents: number;
  readonly dayOfPriceCents: number;
  readonly now: Date;
  readonly startsAt: string;
  readonly timezone: string;
}

export interface TransactionFeeSettings {
  readonly fixedCents: number;
  readonly percentage: number;
}

export type TicketDiscountType = "fixed" | "percentage";

export interface TicketDiscountInput {
  readonly discountType: TicketDiscountType;
  readonly discountValue: number;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface TicketOrderQuote extends TicketDiscountInput {
  readonly discountAmountCents: number;
  readonly discountedSubtotalCents: number;
  readonly feeCents: number;
  readonly originalSubtotalCents: number;
  readonly totalCents: number;
}

export const defaultTransactionFeeSettings = {
  fixedCents: 30,
  percentage: 2.9,
} as const;

export function normalizeDiscountCode(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

export function isValidTicketDiscountValue(
  discountType: TicketDiscountType,
  discountValue: number,
): boolean {
  if (!Number.isInteger(discountValue) || discountValue < 0) return false;
  return discountType === "percentage"
    ? discountValue >= 1 && discountValue <= 100
    : discountValue >= 0;
}

export function ticketOrderQuote(
  input: TicketDiscountInput,
  settings: TransactionFeeSettings = defaultTransactionFeeSettings,
): TicketOrderQuote {
  const originalSubtotalCents = input.unitPriceCents * input.quantity;
  const rawDiscountCents =
    input.discountType === "percentage"
      ? Math.round((originalSubtotalCents * input.discountValue) / 100)
      : Math.min(input.unitPriceCents, input.discountValue) * input.quantity;
  const discountAmountCents = Math.min(originalSubtotalCents, Math.max(0, rawDiscountCents));
  const discountedSubtotalCents = Math.max(0, originalSubtotalCents - discountAmountCents);
  const feeCents = transactionProcessingFeeCents(discountedSubtotalCents, settings);
  return {
    ...input,
    discountAmountCents,
    discountedSubtotalCents,
    feeCents,
    originalSubtotalCents,
    totalCents: discountedSubtotalCents + feeCents,
  };
}

function calendarDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).format(value);
}

export function ticketUnitPriceCents(input: TicketPriceInput): number {
  const eventDate = new Date(input.startsAt);
  const isShowDay =
    calendarDate(input.now, input.timezone) === calendarDate(eventDate, input.timezone);
  return isShowDay ? input.dayOfPriceCents : input.advancePriceCents;
}

function providerProcessingFeeCents(
  chargeAmountCents: number,
  settings: TransactionFeeSettings,
): number {
  return chargeAmountCents > 0
    ? Math.round(chargeAmountCents * (settings.percentage / 100)) + settings.fixedCents
    : 0;
}

export function transactionProcessingFeeCents(
  baseAmountCents: number,
  settings: TransactionFeeSettings = defaultTransactionFeeSettings,
): number {
  if (baseAmountCents <= 0) return 0;

  const rate = settings.percentage / 100;
  if (rate >= 1) {
    throw new RangeError("Processing-fee percentage must be less than 100% for fee pass-through.");
  }

  // Gross up the charge so the configured provider fee is paid by the payer
  // and the Organization still nets the full base amount. Start from the
  // algebraic estimate, then adjust in whole cents to match provider rounding.
  let chargeAmountCents = Math.max(
    baseAmountCents,
    Math.floor((baseAmountCents + settings.fixedCents) / (1 - rate)),
  );

  while (
    chargeAmountCents -
      providerProcessingFeeCents(chargeAmountCents, settings) <
    baseAmountCents
  ) {
    chargeAmountCents += 1;
  }

  while (chargeAmountCents > baseAmountCents) {
    const previousChargeCents = chargeAmountCents - 1;
    if (
      previousChargeCents -
        providerProcessingFeeCents(previousChargeCents, settings) <
      baseAmountCents
    ) {
      break;
    }
    chargeAmountCents = previousChargeCents;
  }

  return chargeAmountCents - baseAmountCents;
}

export function ticketProcessingFeeCents(
  unitPriceCents: number,
  quantity: number,
  settings: TransactionFeeSettings = defaultTransactionFeeSettings,
): number {
  return transactionProcessingFeeCents(unitPriceCents * quantity, settings);
}

export function remainingTicketCapacity(
  capacity: number | null,
  committedQuantity: number,
): number | null {
  return capacity === null ? null : Math.max(0, capacity - committedQuantity);
}

export function canTransitionTicketPurchase(
  current: "expired" | "paid" | "pending" | "refunded",
  next: "expired" | "paid" | "pending" | "refunded",
): boolean {
  return (
    current === next ||
    (current === "pending" && (next === "paid" || next === "expired")) ||
    (current === "expired" && next === "paid") ||
    (current === "paid" && next === "refunded")
  );
}

export interface TicketWillCallRow {
  readonly amountPaidCents: number;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly createdAt: string;
  readonly id: string;
  readonly quantity: number;
  readonly status: "expired" | "paid" | "pending" | "refunded";
  readonly type?: "Bundle" | "Standard";
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function buyerSortKey(name: string): readonly [string, string] {
  const parts = name.trim().split(/\s+/);
  return [(parts.at(-1) ?? "").toLowerCase(), parts.slice(0, -1).join(" ").toLowerCase()];
}

export function renderTicketWillCallCsv(rows: readonly TicketWillCallRow[]): string {
  const header = [
    "ID",
    "Buyer Name",
    "Buyer Email",
    "Quantity",
    "Paid",
    "Status",
    "Created",
    "Type",
  ];
  const sorted = [...rows].sort((left, right) => {
    const leftKey = buyerSortKey(left.buyerName);
    const rightKey = buyerSortKey(right.buyerName);
    return (
      leftKey[0].localeCompare(rightKey[0]) ||
      leftKey[1].localeCompare(rightKey[1]) ||
      left.id.localeCompare(right.id)
    );
  });
  return `${[
    header,
    ...sorted.map((row) => [
      row.id,
      row.buyerName,
      row.buyerEmail,
      row.quantity,
      (row.amountPaidCents / 100).toFixed(2),
      row.status,
      row.createdAt,
      row.type ?? "Standard",
    ]),
  ]
    .map((cells) => cells.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}

export function ticketWillCallFilename(eventTitle: string, eventId: string): string {
  const safeTitle = eventTitle
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return `will-call-${safeTitle || eventId}.csv`;
}

export interface TicketCheckoutLineItemsInput {
  readonly discountedSubtotalCents: number;
  readonly feeCents: number;
  readonly productName: string;
}

export function ticketCheckoutLineItems({
  discountedSubtotalCents,
  feeCents,
  productName,
}: TicketCheckoutLineItemsInput): readonly {
  readonly productName: string;
  readonly quantity: number;
  readonly unitAmountCents: number;
}[] {
  const lineItems = [];
  if (discountedSubtotalCents > 0) {
    lineItems.push({
      productName,
      quantity: 1,
      unitAmountCents: discountedSubtotalCents,
    });
  }
  if (feeCents > 0) {
    lineItems.push({
      productName: "Processing fee",
      quantity: 1,
      unitAmountCents: feeCents,
    });
  }
  return lineItems;
}
