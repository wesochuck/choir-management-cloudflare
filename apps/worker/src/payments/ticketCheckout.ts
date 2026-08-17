import type { Env } from "../env";

export class TicketCheckoutUnavailableError extends Error {
  constructor(message = "Ticket checkout is not configured for this environment.") {
    super(message);
    this.name = "TicketCheckoutUnavailableError";
  }
}

export type PaymentCheckoutMode = "fake" | "stripe";

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

export function ticketCheckoutMode(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "STRIPE_PAYMENTS_ENABLED">,
): PaymentCheckoutMode {
  if (env.EXTERNAL_EFFECTS_MODE === "fake" && env.APP_ENV !== "production") return "fake";
  if (
    env.APP_ENV !== "local" &&
    env.EXTERNAL_EFFECTS_MODE !== "disabled" &&
    env.STRIPE_PAYMENTS_ENABLED?.trim().toLowerCase() === "true"
  ) {
    return "stripe";
  }
  throw new TicketCheckoutUnavailableError();
}
