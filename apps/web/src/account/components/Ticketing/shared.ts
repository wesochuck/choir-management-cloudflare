import type {
  DiscountCodeRequest,
  OrganizationTicketOrder,
  TicketConfirmationSettings,
} from "@choir/contracts";

export type OrderState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly orders: readonly OrganizationTicketOrder[]; readonly status: "ready" };

export type TicketingTab =
  "willcall" | "bundles" | "orders" | "share" | "confirmation" | "discounts";

export interface DiscountDraft {
  readonly active: boolean;
  readonly bundleId: string | null;
  readonly code: string;
  readonly discountType: DiscountCodeRequest["discountType"];
  readonly discountValue: string;
  readonly eventId: string | null;
  readonly redemptionLimit: string;
}

export const EMPTY_DISCOUNT_DRAFT: DiscountDraft = {
  active: true,
  bundleId: null,
  code: "",
  discountType: "percentage",
  discountValue: "",
  eventId: null,
  redemptionLimit: "",
};

export const DEFAULT_TICKET_CONFIRMATION_SETTINGS: TicketConfirmationSettings = {
  admissionInstructions:
    "Keep this confirmation available on your phone. Present the QR code at the door if requested.",
  pendingMessage:
    "We could not load the full ticket details yet. Your purchase may still be processing. Please refresh this page in a moment, or contact the box office if this continues.",
  qrCodeInstructions:
    "Print or screenshot this entire page and bring it with you. We also sent a confirmation email with a link back to this page.",
  successMessage: "Your purchase has been successfully processed.",
  willCallInstructions:
    "Keep this confirmation available on your phone. Present the QR code at the door if requested.",
};

export const WILL_CALL_REFRESH_INTERVAL_MS = 5_000;

export function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

export function buyerLastName(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0] ?? name;
}

/** Keeps today's concert available through local midnight, then prefers the next concert. */
export function findClosestEvent<T extends { readonly startsAt: string }>(
  events: readonly T[],
  relativeTo: Date = new Date(),
  timezone = "UTC",
): T | undefined {
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = dayFormatter.format(relativeTo);
  const targetTime = relativeTo.getTime();
  let todayEvent: T | undefined;
  let todayDistance = Number.POSITIVE_INFINITY;
  let upcoming: T | undefined;
  let upcomingTime = Number.POSITIVE_INFINITY;
  let latestPast: T | undefined;
  let latestPastTime = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const time = Date.parse(event.startsAt);
    if (!Number.isFinite(time)) continue;
    const distance = Math.abs(time - targetTime);
    if (dayFormatter.format(new Date(time)) === today && distance < todayDistance) {
      todayEvent = event;
      todayDistance = distance;
    }
    if (time >= targetTime && time < upcomingTime) {
      upcoming = event;
      upcomingTime = time;
    } else if (time < targetTime && time > latestPastTime) {
      latestPast = event;
      latestPastTime = time;
    }
  }
  return todayEvent ?? upcoming ?? latestPast;
}

export function ticketOrderStatusDisplay(
  order: Pick<OrganizationTicketOrder, "checkoutMode" | "refundRequested" | "status">,
): {
  readonly badgeClass: string;
  readonly label: string;
} {
  const isSimulation = order.checkoutMode === "fake";
  const simulationSuffix = isSimulation ? " (simulation)" : "";

  if (order.status === "refunded") {
    return {
      badgeClass: "status-pill status-pill--neutral",
      label: `Refunded${simulationSuffix}`,
    };
  }

  if (order.status === "paid" && order.refundRequested) {
    return {
      badgeClass: "status-pill status-pill--warning",
      label: `Refund requested${simulationSuffix}`,
    };
  }

  if (order.status === "paid") {
    return {
      badgeClass: "status-pill status-pill--success",
      label: `Paid${simulationSuffix}`,
    };
  }

  return {
    badgeClass: "status-pill",
    label: `${order.status}${simulationSuffix}`,
  };
}

export function canRefundTicketOrder(
  order: Pick<OrganizationTicketOrder, "refundRequested" | "status">,
): boolean {
  return order.status === "paid" && !order.refundRequested;
}
