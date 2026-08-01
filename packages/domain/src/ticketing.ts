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

export const defaultTransactionFeeSettings: TransactionFeeSettings = {
  fixedCents: 30,
  percentage: 2.9,
};

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

export function transactionProcessingFeeCents(
  baseAmountCents: number,
  settings: TransactionFeeSettings = defaultTransactionFeeSettings,
): number {
  return baseAmountCents > 0
    ? Math.round(baseAmountCents * (settings.percentage / 100)) + settings.fixedCents
    : 0;
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
