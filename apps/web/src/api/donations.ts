import { z } from "zod";
import type {
  donationPublicationMutationSchema,
  donationInclusionMutationSchema,
} from "@choir/contracts";
import {
  donationPublicationsResponseSchema,
  donationPublicationReviewResponseSchema,
} from "@choir/contracts";
import {
  donationRecordSchema,
  donationRecordsResponseSchema,
  donationResponseSchema,
  donationSettingsResponseSchema,
  donationSponsorLinkResponseSchema,
  patronRecordsResponseSchema,
  type DonationRecord,
  type DonationSettings,
  type DonationSponsorLinkResponse,
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

export async function getDonationSponsorLink(
  donationId: string,
): Promise<DonationSponsorLinkResponse> {
  return requestJson(
    `/api/organization/donations/${encodeURIComponent(donationId)}/sponsor-link`,
    donationSponsorLinkResponseSchema,
    { method: "POST" },
  );
}

export async function attachDonationArtwork(
  donationId: string,
  artworkFileId: string,
): Promise<DonationRecord> {
  const result = await requestJson(
    `/api/organization/donations/${encodeURIComponent(donationId)}/artwork`,
    donationResponseSchema,
    {
      body: JSON.stringify({ artworkFileId }),
      method: "POST",
    },
  );
  return result.donation;
}

export async function listDonationPublications(cursor?: string) {
  return requestJson(
    "/api/organization/donation-publications" +
      (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    donationPublicationsResponseSchema,
  );
}
export async function saveDonationPublication(
  mutation: z.infer<typeof donationPublicationMutationSchema>,
) {
  return requestJson(
    "/api/organization/donation-publications",
    donationPublicationsResponseSchema,
    { method: "PUT", body: JSON.stringify(mutation) },
  );
}
export async function reviewDonationPublications(parameters: {
  cursor?: string;
  publicationId?: string;
  filter?: string;
}) {
  return requestJson(
    "/api/organization/donation-publication-review?" + new URLSearchParams(parameters).toString(),
    donationPublicationReviewResponseSchema,
  );
}
export async function setDonationInclusion(
  mutation: z.infer<typeof donationInclusionMutationSchema>,
) {
  return requestJson(
    "/api/organization/donation-publication-inclusion",
    z.object({ success: z.boolean() }),
    { method: "POST", body: JSON.stringify(mutation) },
  );
}
