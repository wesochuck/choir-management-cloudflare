import {
  duesRecordSchema,
  duesRecordsResponseSchema,
  duesCashPaymentRequestSchema,
  memberDuesResponseSchema,
  duesCheckoutResponseSchema,
  seasonSchema,
  seasonsResponseSchema,
  type DuesRecord,
  type Season,
  type DuesCheckoutResponse,
  type SeasonCreateRequest,
  type SeasonUpdateRequest,
  type TransactionFeeSettings,
} from "@choir/contracts";

import { request } from "./client";

export async function listOrganizationSeasons(signal?: AbortSignal): Promise<readonly Season[]> {
  const response = await request("/api/organization/seasons", { signal: signal ?? null });
  return seasonsResponseSchema.parse(await response.json()).seasons;
}

export async function createOrganizationSeason(season: SeasonCreateRequest): Promise<Season> {
  const response = await request("/api/organization/seasons", {
    body: JSON.stringify(season),
    method: "POST",
  });
  return seasonSchema.parse(await response.json());
}

export async function updateOrganizationSeason(
  seasonId: string,
  season: SeasonUpdateRequest,
): Promise<Season> {
  const response = await request(`/api/organization/seasons/${encodeURIComponent(seasonId)}`, {
    body: JSON.stringify(season),
    method: "PUT",
  });
  return seasonSchema.parse(await response.json());
}

export async function activateOrganizationSeason(seasonId: string): Promise<Season> {
  const response = await request(
    `/api/organization/seasons/${encodeURIComponent(seasonId)}/activate`,
    { method: "POST" },
  );
  return seasonSchema.parse(await response.json());
}

export async function deleteOrganizationSeason(seasonId: string): Promise<void> {
  await request(`/api/organization/seasons/${encodeURIComponent(seasonId)}`, {
    method: "DELETE",
  });
}

export async function listOrganizationDues(signal?: AbortSignal): Promise<readonly DuesRecord[]> {
  const response = await request("/api/organization/dues", { signal: signal ?? null });
  return duesRecordsResponseSchema.parse(await response.json()).dues;
}

export async function getMyDues(signal?: AbortSignal): Promise<{
  readonly dues: readonly DuesRecord[];
  readonly seasons: readonly Season[];
  readonly transactionFeeSettings: TransactionFeeSettings;
}> {
  const response = await request("/api/singer/dues", { signal: signal ?? null });
  const result = memberDuesResponseSchema.parse(await response.json());
  return {
    dues: result.dues,
    seasons: result.seasons,
    transactionFeeSettings: result.transactionFeeSettings,
  };
}

export async function createMyDuesCheckout(
  seasonId: string,
  checkoutRequestId: string = crypto.randomUUID(),
): Promise<DuesCheckoutResponse> {
  const response = await request("/api/singer/dues/checkout", {
    body: JSON.stringify({ checkoutRequestId, seasonId }),
    method: "POST",
  });
  return duesCheckoutResponseSchema.parse(await response.json());
}

export async function refundOrganizationDues(duesId: string): Promise<DuesRecord> {
  const response = await request(`/api/organization/dues/${encodeURIComponent(duesId)}/refund`, {
    method: "POST",
  });
  return duesRecordSchema.parse(await response.json());
}

export async function markOrganizationDuesPaidInCash(
  profileId: string,
  seasonId: string,
): Promise<DuesRecord> {
  const response = await request("/api/organization/dues/cash", {
    body: JSON.stringify(duesCashPaymentRequestSchema.parse({ profileId, seasonId })),
    method: "POST",
  });
  return duesRecordSchema.parse(await response.json());
}
