export interface TicketPriceInput {
  readonly advancePriceCents: number;
  readonly dayOfPriceCents: number;
  readonly now: Date;
  readonly startsAt: string;
  readonly timezone: string;
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

export function ticketProcessingFeeCents(unitPriceCents: number, quantity: number): number {
  const subtotal = unitPriceCents * quantity;
  return subtotal > 0 ? Math.round(subtotal * 0.029) + 30 : 0;
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
    (current === "paid" && next === "refunded")
  );
}
