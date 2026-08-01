import {
  publishedOrganizationProjectionSchema,
  publicWebsitePublishResponseSchema,
  publicWebsiteSettingsResponseSchema,
  donationSettingsResponseSchema,
  publicDonationReceiptResponseSchema,
  transactionFeeSettingsResponseSchema,
  type TransactionFeeSettings,
  type PublicDonationReceiptResponse,
  type PublishedOrganizationProjection,
  type PublicWebsiteSettings,
  type PublicWebsiteSettingsRequest,
  type DonationSettings,
} from "@choir/contracts";

import { request, responseError } from "./client";

export async function getPublishedOrganizationProjection(
  signal?: AbortSignal,
): Promise<PublishedOrganizationProjection | null> {
  const response = await fetch("/api/public/projection", {
    headers: { accept: "application/json" },
    signal: signal ?? null,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await responseError(response);
  return publishedOrganizationProjectionSchema.parse(await response.json());
}

export async function getPublicCommerceProjection(
  signal?: AbortSignal,
): Promise<PublishedOrganizationProjection> {
  const response = await fetch("/api/public/commerce-projection", {
    headers: { accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) throw await responseError(response);
  return publishedOrganizationProjectionSchema.parse(await response.json());
}

export async function getOrganizationPublicWebsiteSettings(
  signal?: AbortSignal,
): Promise<PublicWebsiteSettings> {
  const response = await request("/api/organization/website", { signal: signal ?? null });
  return publicWebsiteSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationPublicWebsiteSettings(
  settings: PublicWebsiteSettingsRequest,
): Promise<PublicWebsiteSettings> {
  const response = await request("/api/organization/website", {
    body: JSON.stringify(settings),
    method: "PUT",
  });
  return publicWebsiteSettingsResponseSchema.parse(await response.json());
}

export async function publishOrganizationPublicWebsite(): Promise<{
  readonly publishedAt: string;
  readonly version: number;
}> {
  const response = await request("/api/organization/website/publish", { method: "POST" });
  return publicWebsitePublishResponseSchema.parse(await response.json());
}

export async function getPublicTransactionFeeSettings(
  signal?: AbortSignal,
): Promise<TransactionFeeSettings> {
  const response = await request("/api/public/transaction-fee-settings", {
    signal: signal ?? null,
  });
  return transactionFeeSettingsResponseSchema.parse(await response.json());
}

export async function getPublicDonationSettings(signal?: AbortSignal): Promise<DonationSettings> {
  const response = await request("/api/public/donation-settings", { signal: signal ?? null });
  return donationSettingsResponseSchema.parse(await response.json());
}

export async function getPublicDonationReceipt(
  token: string,
  signal?: AbortSignal,
): Promise<PublicDonationReceiptResponse> {
  const response = await request(
    `/api/public/donation-receipt?token=${encodeURIComponent(token)}`,
    {
      signal: signal ?? null,
    },
  );
  return publicDonationReceiptResponseSchema.parse(await response.json());
}
