import {
  donationSettingsResponseSchema,
  donationCheckoutResponseSchema,
  publicAuditionDetailsResponseSchema,
  publicAuditionSettingsSchema,
  publicDonationReceiptResponseSchema,
  publicPollDetailsResponseSchema,
  publicRsvpDetailsResponseSchema,
  publicSponsorArtworkUploadResponseSchema,
  publicSponsorDonationResponseSchema,
  publishedOrganizationProjectionSchema,
  publicWebsitePublishResponseSchema,
  publicWebsiteSettingsResponseSchema,
  transactionFeeSettingsResponseSchema,
  platformHomeTicketListingsResponseSchema,
  platformInquiryResponseSchema,
  type DonationCheckoutRequest,
  type DonationSettings,
  type PlatformHomeTicketListing,
  type PlatformInquiryRequest,
  type PlatformInquiryResponse,
  type PublicAuditionDetailsResponse,
  type PublicAuditionSettings,
  type PublicDonationReceiptResponse,
  type PublicPollDetailsResponse,
  type PublicRsvpDetailsResponse,
  type PublicSponsorArtworkUploadResponse,
  type PublicSponsorDonationResponse,
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

export async function uploadPublicSponsorArtwork(
  file: File,
  levelId: string,
  checkoutRequestId?: string,
): Promise<PublicSponsorArtworkUploadResponse> {
  const contentType = file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type;
  const headers: Record<string, string> = {
    "content-type": contentType,
    "x-donation-level-id": levelId,
    "x-file-name": encodeURIComponent(file.name),
  };
  if (checkoutRequestId) {
    headers["x-checkout-request-id"] = checkoutRequestId;
  }
  const response = await fetch("/api/public/donations/artwork/upload", {
    body: file,
    headers,
    method: "POST",
  });
  if (!response.ok) throw await responseError(response);
  return publicSponsorArtworkUploadResponseSchema.parse(await response.json());
}

export async function getPublicSponsorDonation(
  token: string,
  signal?: AbortSignal,
): Promise<PublicSponsorDonationResponse> {
  const response = await fetch(
    `/api/public/donations/sponsor-info?token=${encodeURIComponent(token)}`,
    {
      headers: { accept: "application/json" },
      signal: signal ?? null,
    },
  );
  if (!response.ok) throw await responseError(response);
  return publicSponsorDonationResponseSchema.parse(await response.json());
}

export async function submitPublicSponsorArtwork(
  token: string,
  file: File,
): Promise<PublicSponsorDonationResponse> {
  const contentType = file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type;
  const response = await fetch(
    `/api/public/donations/sponsor-artwork?token=${encodeURIComponent(token)}`,
    {
      body: file,
      headers: {
        "content-type": contentType,
        "x-file-name": encodeURIComponent(file.name),
      },
      method: "POST",
    },
  );
  if (!response.ok) throw await responseError(response);
  return publicSponsorDonationResponseSchema.parse(await response.json());
}

const projectionCache = new Map<string, PublishedOrganizationProjection | null>();
const inFlightProjectionRequests = new Map<
  string,
  Promise<PublishedOrganizationProjection | null>
>();

function currentHostKey(): string {
  return typeof window !== "undefined" && window.location.host ? window.location.host : "default";
}

export function clearPublishedOrganizationProjectionCache(host?: string): void {
  if (host) {
    projectionCache.delete(host);
    inFlightProjectionRequests.delete(host);
  } else {
    projectionCache.clear();
    inFlightProjectionRequests.clear();
  }
}

function withCallerSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted.", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener("abort", onAbort);
        resolve(val);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export async function getPublishedOrganizationProjection(
  signal?: AbortSignal,
  options?: { readonly bypassCache?: boolean },
): Promise<PublishedOrganizationProjection | null> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }

  const hostKey = currentHostKey();

  if (options?.bypassCache) {
    projectionCache.delete(hostKey);
    inFlightProjectionRequests.delete(hostKey);
  } else {
    const cached = projectionCache.get(hostKey);
    if (cached !== undefined) {
      return cached;
    }
    const inFlight = inFlightProjectionRequests.get(hostKey);
    if (inFlight) {
      return withCallerSignal(inFlight, signal);
    }
  }

  const url = "/api/public/projection";

  const fetchPromise = (async () => {
    try {
      const response = await fetch(url, {
        cache: options?.bypassCache ? "no-store" : "default",
        headers: {
          accept: "application/json",
          ...(options?.bypassCache ? { "cache-control": "no-cache" } : {}),
        },
      });
      if (response.status === 404) {
        projectionCache.set(hostKey, null);
        return null;
      }
      if (!response.ok) throw await responseError(response);
      const parsed = publishedOrganizationProjectionSchema.parse(await response.json());
      projectionCache.set(hostKey, parsed);
      return parsed;
    } finally {
      inFlightProjectionRequests.delete(hostKey);
    }
  })();

  inFlightProjectionRequests.set(hostKey, fetchPromise);
  return withCallerSignal(fetchPromise, signal);
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
  const result = await requestJson(
    "/api/organization/website",
    publicWebsiteSettingsResponseSchema,
    {
      body: JSON.stringify(settings),
      method: "PUT",
    },
  );
  clearPublishedOrganizationProjectionCache();
  return result;
}

export async function publishOrganizationPublicWebsite(): Promise<{
  readonly publishedAt: string;
  readonly version: number;
}> {
  const result = await requestJson(
    "/api/organization/website/publish",
    publicWebsitePublishResponseSchema,
    {
      method: "POST",
    },
  );
  clearPublishedOrganizationProjectionCache();
  return result;
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

export async function getPlatformHomeTickets(
  signal?: AbortSignal,
): Promise<readonly PlatformHomeTicketListing[]> {
  const data = await requestJson(
    "/api/public/platform/tickets",
    platformHomeTicketListingsResponseSchema,
    { signal: signal ?? null },
  );
  return data.listings;
}

export async function submitPlatformInquiry(
  inquiry: PlatformInquiryRequest,
  signal?: AbortSignal,
): Promise<PlatformInquiryResponse> {
  return requestJson("/api/public/platform/inquire", platformInquiryResponseSchema, {
    body: JSON.stringify(inquiry),
    method: "POST",
    signal: signal ?? null,
  });
}
