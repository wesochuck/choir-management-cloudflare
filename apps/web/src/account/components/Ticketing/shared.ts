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
  pendingMessage:
    "We could not load the full ticket details yet. Your purchase may still be processing. Please refresh this page in a moment, or contact the box office if this continues.",
  qrCodeInstructions:
    "Print or screenshot this entire page and bring it with you. We also sent a confirmation email with a link back to this page.",
  successMessage: "Your purchase has been successfully processed.",
  willCallInstructions:
    "A confirmation email has been sent with a link back to this page. Your tickets will be held at Will Call on show day. Please bring a photo ID matching the buyer’s name.",
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

/**
 * Finds the event closest in time to relativeTo (defaulting to today's date/time).
 */
export function findClosestEvent<T extends { readonly startsAt: string }>(
  events: readonly T[],
  relativeTo: Date = new Date(),
): T | undefined {
  if (events.length === 0) return undefined;
  const targetTime = relativeTo.getTime();
  let closest: T | undefined;
  let minDiff = Number.POSITIVE_INFINITY;

  for (const event of events) {
    const time = new Date(event.startsAt).getTime();
    if (Number.isNaN(time)) continue;
    const diff = Math.abs(time - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = event;
    } else if (diff === minDiff && closest !== undefined) {
      const closestTime = new Date(closest.startsAt).getTime();
      if (time >= targetTime && closestTime < targetTime) {
        closest = event;
      }
    }
  }

  return closest;
}
