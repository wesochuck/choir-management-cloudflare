import {
  discountCodeListResponseSchema,
  discountCodeRequestSchema,
  discountCodeSchema,
  organizationTicketOrderSchema,
  organizationTicketOrdersResponseSchema,
  publicTicketDiscountAvailabilityRequestSchema,
  publicTicketDiscountAvailabilityResponseSchema,
  publicTicketPurchaseResponseSchema,
  ticketCheckoutQuoteRequestSchema,
  ticketCheckoutQuoteSchema,
  ticketCheckoutResponseSchema,
  ticketBundleSchema,
  ticketBundlesResponseSchema,
  ticketScanResponseSchema,
  ticketConfirmationSettingsResponseSchema,
  type TicketConfirmationSettings,
  type OrganizationTicketOrder,
  type PublicTicketReceipt,
  type TicketCheckoutRequest,
  type TicketCheckoutQuote,
  type TicketCheckoutQuoteRequest,
  type DiscountCode,
  type DiscountCodeRequest,
  type TicketBundle,
  type TicketBundleRequest,
  type TicketScanRequest,
  type TicketScanResult,
} from "@choir/contracts";

import { request, responseError } from "./client";

export async function createPublicTicketCheckout(checkout: TicketCheckoutRequest) {
  const response = await fetch("/api/public/tickets/checkout", {
    body: JSON.stringify(checkout),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw await responseError(response);
  return ticketCheckoutResponseSchema.parse(await response.json());
}

export async function getPublicTicketDiscountAvailability(
  target: { readonly bundleId?: string; readonly eventId?: string },
  signal?: AbortSignal,
): Promise<boolean> {
  const parsedTarget = publicTicketDiscountAvailabilityRequestSchema.parse({
    bundleId: target.bundleId ?? null,
    eventId: target.eventId ?? null,
  });
  const search = new URLSearchParams();
  if (parsedTarget.bundleId) search.set("bundleId", parsedTarget.bundleId);
  if (parsedTarget.eventId) search.set("eventId", parsedTarget.eventId);
  const response = await fetch(`/api/public/tickets/discount-availability?${search.toString()}`, {
    headers: { accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) throw await responseError(response);
  return publicTicketDiscountAvailabilityResponseSchema.parse(await response.json())
    .hasRedeemableCode;
}

export async function quotePublicTicketCheckout(
  quote: TicketCheckoutQuoteRequest,
  signal?: AbortSignal,
): Promise<TicketCheckoutQuote> {
  const response = await fetch("/api/public/tickets/quote", {
    body: JSON.stringify(ticketCheckoutQuoteRequestSchema.parse(quote)),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
    signal: signal ?? null,
  });
  if (!response.ok) throw await responseError(response);
  return ticketCheckoutQuoteSchema.parse(await response.json());
}

export async function getPublicTicketPurchase(
  token: string,
  signal?: AbortSignal,
): Promise<PublicTicketReceipt> {
  const response = await fetch(`/api/public/tickets/order?token=${encodeURIComponent(token)}`, {
    headers: { accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) throw await responseError(response);
  return publicTicketPurchaseResponseSchema.parse(await response.json());
}

export async function validateTicketScan(scan: TicketScanRequest): Promise<TicketScanResult> {
  const response = await request("/api/organization/tickets/scan", {
    body: JSON.stringify(scan),
    method: "POST",
  });
  return ticketScanResponseSchema.parse(await response.json());
}

export async function listTicketBundles(signal?: AbortSignal): Promise<readonly TicketBundle[]> {
  const response = await request("/api/organization/tickets/bundles", { signal: signal ?? null });
  return ticketBundlesResponseSchema.parse(await response.json()).bundles;
}

export async function saveTicketBundle(
  bundle: TicketBundleRequest,
  bundleId?: string,
): Promise<TicketBundle> {
  const response = await request(
    bundleId
      ? `/api/organization/tickets/bundles/${encodeURIComponent(bundleId)}`
      : "/api/organization/tickets/bundles",
    { body: JSON.stringify(bundle), method: bundleId ? "PUT" : "POST" },
  );
  return ticketBundleSchema.parse(await response.json());
}

export async function deleteTicketBundle(bundleId: string): Promise<void> {
  await request(`/api/organization/tickets/bundles/${encodeURIComponent(bundleId)}`, {
    method: "DELETE",
  });
}

export async function listOrganizationTicketOrders(
  signal?: AbortSignal,
): Promise<readonly OrganizationTicketOrder[]> {
  const response = await request("/api/organization/tickets/orders", { signal: signal ?? null });
  return organizationTicketOrdersResponseSchema.parse(await response.json()).orders;
}

export async function listOrganizationDiscountCodes(
  signal?: AbortSignal,
): Promise<readonly DiscountCode[]> {
  const response = await request("/api/organization/tickets/discount-codes", {
    signal: signal ?? null,
  });
  return discountCodeListResponseSchema.parse(await response.json()).codes;
}

export async function saveOrganizationDiscountCode(
  code: DiscountCodeRequest,
  codeId?: string,
): Promise<DiscountCode> {
  const response = await request(
    codeId
      ? `/api/organization/tickets/discount-codes/${encodeURIComponent(codeId)}`
      : "/api/organization/tickets/discount-codes",
    {
      body: JSON.stringify(discountCodeRequestSchema.parse(code)),
      method: codeId ? "PUT" : "POST",
    },
  );
  return discountCodeSchema.parse(await response.json());
}

export async function deactivateOrganizationDiscountCode(codeId: string): Promise<DiscountCode> {
  const response = await request(
    `/api/organization/tickets/discount-codes/${encodeURIComponent(codeId)}/deactivate`,
    { method: "POST" },
  );
  return discountCodeSchema.parse(await response.json());
}

export async function reactivateOrganizationDiscountCode(codeId: string): Promise<DiscountCode> {
  const response = await request(
    `/api/organization/tickets/discount-codes/${encodeURIComponent(codeId)}/reactivate`,
    { method: "POST" },
  );
  return discountCodeSchema.parse(await response.json());
}

export async function refundOrganizationTicketOrder(
  purchaseId: string,
): Promise<OrganizationTicketOrder> {
  const response = await request(
    `/api/organization/tickets/${encodeURIComponent(purchaseId)}/refund`,
    { method: "POST" },
  );
  return organizationTicketOrderSchema.parse(await response.json());
}

export async function resendTicketConfirmation(purchaseId: string): Promise<void> {
  await request(`/api/organization/tickets/${encodeURIComponent(purchaseId)}/confirmation`, {
    method: "POST",
  });
}

export async function getPublicTicketConfirmationSettings(
  signal?: AbortSignal,
): Promise<TicketConfirmationSettings> {
  const response = await request("/api/public/ticket-confirmation-settings", {
    signal: signal ?? null,
  });
  return ticketConfirmationSettingsResponseSchema.parse(await response.json());
}

export async function getOrganizationTicketConfirmationSettings(
  signal?: AbortSignal,
): Promise<TicketConfirmationSettings> {
  const response = await request("/api/organization/ticket-confirmation-settings", {
    signal: signal ?? null,
  });
  return ticketConfirmationSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationTicketConfirmationSettings(
  settings: TicketConfirmationSettings,
): Promise<TicketConfirmationSettings> {
  const response = await request("/api/organization/ticket-confirmation-settings", {
    body: JSON.stringify(settings),
    method: "PUT",
  });
  return ticketConfirmationSettingsResponseSchema.parse(await response.json());
}
