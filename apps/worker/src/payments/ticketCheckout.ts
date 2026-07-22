import type { Env } from "../env";

export class TicketCheckoutUnavailableError extends Error {
  constructor(message = "Ticket checkout is not configured for this environment.") {
    super(message);
    this.name = "TicketCheckoutUnavailableError";
  }
}

export function ticketCheckoutMode(env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE">): "fake" {
  if (env.EXTERNAL_EFFECTS_MODE === "fake" && env.APP_ENV !== "production") return "fake";
  throw new TicketCheckoutUnavailableError();
}
