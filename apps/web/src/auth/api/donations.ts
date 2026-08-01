import { donationSettingsResponseSchema, type DonationSettings } from "@choir/contracts";

import { request } from "./client";

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
