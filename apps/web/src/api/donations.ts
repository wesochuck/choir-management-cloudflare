import {
  donationRecordSchema,
  donationRecordsResponseSchema,
  donationResponseSchema,
  donationSettingsResponseSchema,
  patronRecordsResponseSchema,
  type DonationRecord,
  type DonationSettings,
  type DonationThankYouUpdateRequest,
  type ManualDonationCreateRequest,
  type PatronRecord,
} from "@choir/contracts";

import { requestJson } from "./client";

export async function refundOrganizationDonation(donationId: string): Promise<DonationRecord> {
  return requestJson(
    `/api/organization/donations/${encodeURIComponent(donationId)}/refund`,
    donationRecordSchema,
    { method: "POST" },
  );
}

export async function listOrganizationDonations(
  signal?: AbortSignal,
): Promise<readonly DonationRecord[]> {
  const result = await requestJson("/api/organization/donations", donationRecordsResponseSchema, {
    signal: signal ?? null,
  });
  return result.donations;
}

export async function listOrganizationPatrons(
  signal?: AbortSignal,
): Promise<readonly PatronRecord[]> {
  const result = await requestJson("/api/organization/patrons", patronRecordsResponseSchema, {
    signal: signal ?? null,
  });
  return result.patrons;
}

export async function createManualOrganizationDonation(
  donation: ManualDonationCreateRequest,
): Promise<DonationRecord> {
  const result = await requestJson("/api/organization/donations/manual", donationResponseSchema, {
    body: JSON.stringify(donation),
    method: "POST",
  });
  return result.donation;
}

export async function updateOrganizationDonationThankYou(
  payload: DonationThankYouUpdateRequest,
): Promise<DonationRecord> {
  const result = await requestJson(
    "/api/organization/donations/thank-you",
    donationResponseSchema,
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
  );
  return result.donation;
}

export async function getOrganizationDonationSettings(
  signal?: AbortSignal,
): Promise<DonationSettings> {
  return requestJson("/api/organization/donation-settings", donationSettingsResponseSchema, {
    signal: signal ?? null,
  });
}

export async function updateOrganizationDonationSettings(
  settings: DonationSettings,
): Promise<DonationSettings> {
  return requestJson("/api/organization/donation-settings", donationSettingsResponseSchema, {
    body: JSON.stringify(settings),
    method: "PUT",
  });
}
