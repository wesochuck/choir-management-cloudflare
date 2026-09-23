import { AuthApiError } from "../api";

const ticketTerminalCheckoutCodes = new Set([
  "checkout_request_conflict",
  "discount_code_invalid",
  "ticket_capacity_exceeded",
  "ticket_checkout_amount_too_small",
  "ticket_checkout_expired",
  "ticket_sales_closed",
]);

const donationTerminalCheckoutCodes = new Set([
  "donation_checkout_conflict",
  "donation_checkout_expired",
  "validation_failed",
]);

/**
 * A checkout request ID is retained after unknown failures: the server may have
 * completed the attempt even when the browser did not receive its response.
 * Only a typed terminal application error proves this identity cannot recover.
 */
export function shouldStartNewTicketCheckoutAttempt(error: unknown): boolean {
  return error instanceof AuthApiError && ticketTerminalCheckoutCodes.has(error.code);
}

export function shouldStartNewDonationCheckoutAttempt(error: unknown): boolean {
  return error instanceof AuthApiError && donationTerminalCheckoutCodes.has(error.code);
}
