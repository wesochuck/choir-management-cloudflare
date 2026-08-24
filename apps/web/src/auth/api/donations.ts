import {
  donationRecordsResponseSchema,
  donationResponseSchema,
  donationSettingsResponseSchema,
  type DonationRecord,
  type DonationSettings,
  type DonationThankYouUpdateRequest,
  type ManualDonationCreateRequest,
} from "@choir/contracts";

import { request } from "./client";

export async function listOrganizationDonations(
  signal?: AbortSignal,
): Promise<readonly DonationRecord[]> {
  const response = await request("/api/organization/donations", { signal: signal ?? null });
  return donationRecordsResponseSchema.parse(await response.json()).donations;
}

export async function createManualOrganizationDonation(
  donation: ManualDonationCreateRequest,
): Promise<DonationRecord> {
  const response = await request("/api/organization/donations/manual", {
    body: JSON.stringify(donation),
    method: "POST",
  });
  return donationResponseSchema.parse(await response.json()).donation;
}

export async function updateOrganizationDonationThankYou(
  payload: DonationThankYouUpdateRequest,
): Promise<DonationRecord> {
  const response = await request("/api/organization/donations/thank-you", {
    body: JSON.stringify(payload),
    method: "POST",
  });
  return donationResponseSchema.parse(await response.json()).donation;
}

export async function getOrganizationDonationSettings(
  signal?: AbortSignal,
): Promise<DonationSettings> {
  const response = await request("/api/organization/donation-settings", {
    signal: signal ?? null,
  });
  return donationSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationDonationSettings(
  settings: DonationSettings,
): Promise<DonationSettings> {
  const response = await request("/api/organization/donation-settings", {
    body: JSON.stringify(settings),
    method: "PUT",
  });
  return donationSettingsResponseSchema.parse(await response.json());
}
