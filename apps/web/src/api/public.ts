import {
  donationSettingsResponseSchema,
  donationCheckoutResponseSchema,
  publicAuditionDetailsResponseSchema,
  publicAuditionSettingsSchema,
  publicDonationReceiptResponseSchema,
  publicPollDetailsResponseSchema,
  publicRsvpDetailsResponseSchema,
  publishedOrganizationProjectionSchema,
  publicWebsitePublishResponseSchema,
  publicWebsiteSettingsResponseSchema,
  transactionFeeSettingsResponseSchema,
  type DonationCheckoutRequest,
  type DonationSettings,
  type PublicAuditionDetailsResponse,
  type PublicAuditionSettings,
  type PublicDonationReceiptResponse,
  type PublicPollDetailsResponse,
  type PublicRsvpDetailsResponse,
  type PublicWebsiteSettings,
  type PublicWebsiteSettingsRequest,
  type PublishedOrganizationProjection,
  type TransactionFeeSettings,
} from "@choir/contracts";
import { z } from "zod";

import { request, requestJson, responseError } from "./client";

export async function checkoutPublicDonation(checkoutRequest: DonationCheckoutRequest): Promise<{
  readonly url: string;
  readonly successToken: string;
  readonly checkoutMode: "fake" | "stripe";
}> {
  return requestJson("/api/public/donations/checkout", donationCheckoutResponseSchema, {
    body: JSON.stringify(checkoutRequest),
    method: "POST",
  });
}

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
  return requestJson("/api/organization/website", publicWebsiteSettingsResponseSchema, {
    signal: signal ?? null,
  });
}

export async function updateOrganizationPublicWebsiteSettings(
  settings: PublicWebsiteSettingsRequest,
): Promise<PublicWebsiteSettings> {
  return requestJson("/api/organization/website", publicWebsiteSettingsResponseSchema, {
    body: JSON.stringify(settings),
    method: "PUT",
  });
}

export async function publishOrganizationPublicWebsite(): Promise<{
  readonly publishedAt: string;
  readonly version: number;
}> {
  return requestJson("/api/organization/website/publish", publicWebsitePublishResponseSchema, {
    method: "POST",
  });
}

export async function getPublicTransactionFeeSettings(
  signal?: AbortSignal,
): Promise<TransactionFeeSettings> {
  return requestJson("/api/public/transaction-fee-settings", transactionFeeSettingsResponseSchema, {
    signal: signal ?? null,
  });
}

export async function getPublicDonationSettings(signal?: AbortSignal): Promise<DonationSettings> {
  return requestJson("/api/public/donation-settings", donationSettingsResponseSchema, {
    signal: signal ?? null,
  });
}

export async function getPublicDonationReceipt(
  token: string,
  signal?: AbortSignal,
): Promise<PublicDonationReceiptResponse> {
  return requestJson(
    `/api/public/donation-receipt?token=${encodeURIComponent(token)}`,
    publicDonationReceiptResponseSchema,
    { signal: signal ?? null },
  );
}

export async function getPublicPollDetails(
  token: string,
  signal?: AbortSignal,
): Promise<PublicPollDetailsResponse> {
  return requestJson("/api/public/poll-details", publicPollDetailsResponseSchema, {
    body: JSON.stringify({ token }),
    method: "POST",
    signal: signal ?? null,
  });
}

export async function submitPublicPollVote(token: string, optionIds: string[]): Promise<void> {
  await request("/api/public/poll-vote", {
    body: JSON.stringify({ optionIds, token }),
    method: "POST",
  });
}

export async function getPublicRsvpDetails(
  token: string,
  signal?: AbortSignal,
): Promise<PublicRsvpDetailsResponse> {
  return requestJson("/api/public/rsvp-details", publicRsvpDetailsResponseSchema, {
    body: JSON.stringify({ token }),
    method: "POST",
    signal: signal ?? null,
  });
}

export async function submitPublicQuickRsvp(
  token: string,
  rsvp: "Yes" | "No" | "Pending",
  rsvpNote: string,
): Promise<void> {
  await request("/api/public/quick-rsvp", {
    body: JSON.stringify({ rsvp, rsvpNote, token }),
    method: "POST",
  });
}

export async function getPublicAuditionDetails(
  token: string,
  signal?: AbortSignal,
): Promise<PublicAuditionDetailsResponse> {
  return requestJson("/api/public/audition-details", publicAuditionDetailsResponseSchema, {
    body: JSON.stringify({ token }),
    method: "POST",
    signal: signal ?? null,
  });
}

export type NormalizedPublicAuditionSettings = Omit<PublicAuditionSettings, "slots"> & {
  readonly slots: readonly {
    readonly id: string;
    readonly startsAt: string;
    readonly endsAt: string;
  }[];
};

export async function getPublicAuditionSettings(
  signal?: AbortSignal,
): Promise<NormalizedPublicAuditionSettings> {
  const data = await requestJson("/api/public/audition-settings", publicAuditionSettingsSchema, {
    signal: signal ?? null,
  });
  return {
    ...data,
    slots: data.slots.map((slot) => ({
      endsAt: slot.endsAt,
      id: slot.id ?? slot.startsAt,
      startsAt: slot.startsAt,
    })),
  };
}

export async function submitPublicAuditionInquiry(payload: {
  readonly availabilityNotes: string;
  readonly email: string;
  readonly experience: string;
  readonly name: string;
  readonly phone: string;
  readonly requestedSlots: readonly string[];
  readonly voicePart: string;
}): Promise<string> {
  const result = await requestJson("/api/public/audition-inquiry", z.object({ id: z.string() }), {
    body: JSON.stringify(payload),
    method: "POST",
  });
  return result.id;
}

export async function submitPublicAuditionUpdate(
  token: string,
  voicePart: string,
  availabilityNotes: string,
): Promise<void> {
  await request("/api/public/audition-submit", {
    body: JSON.stringify({ availabilityNotes, token, voicePart }),
    method: "POST",
  });
}
