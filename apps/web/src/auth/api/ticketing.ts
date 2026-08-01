import {
  organizationTicketOrderSchema,
  organizationTicketOrdersResponseSchema,
  publicTicketPurchaseResponseSchema,
  ticketCheckoutResponseSchema,
  ticketBundleSchema,
  ticketBundlesResponseSchema,
  ticketScanResponseSchema,
  ticketConfirmationSettingsResponseSchema,
  type TicketConfirmationSettings,
  type OrganizationTicketOrder,
  type PublicTicketReceipt,
  type TicketCheckoutRequest,
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
