import type { Env } from "../env";

export class TicketCheckoutUnavailableError extends Error {
  constructor(message = "Ticket checkout is not configured for this environment.") {
    super(message);
    this.name = "TicketCheckoutUnavailableError";
  }
}

export type PaymentCheckoutMode = "fake" | "stripe";

export function ticketCheckoutMode(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "STRIPE_PAYMENTS_ENABLED">,
): PaymentCheckoutMode {
  if (env.EXTERNAL_EFFECTS_MODE === "fake" && env.APP_ENV !== "production") return "fake";
  if (
    env.APP_ENV !== "local" &&
    env.APP_ENV !== "preview" &&
    env.EXTERNAL_EFFECTS_MODE !== "disabled" &&
    env.STRIPE_PAYMENTS_ENABLED?.trim().toLowerCase() === "true"
  ) {
    return "stripe";
  }
  throw new TicketCheckoutUnavailableError();
}
