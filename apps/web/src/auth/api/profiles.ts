import {
  memberProfileResponseSchema,
  organizationDirectoryResponseSchema,
  organizationMembershipsResponseSchema,
  organizationProfileResponseSchema,
  organizationProfilesResponseSchema,
  organizationProfileImportResponseSchema,
  organizationProfileFolderNumberSchema,
  organizationProfileFolderNumbersResponseSchema,
  organizationProfilePerformanceHistoryResponseSchema,
  organizationProfileStatusHistoryResponseSchema,
  type MemberProfile,
  type MemberProfileUpdateRequest,
  type OrganizationDirectoryProfile,
  type OrganizationMembershipsResponse,
  type OrganizationProfile,
  type OrganizationProfileFolderNumber,
  type OrganizationProfileFolderNumberUpdate,
  type OrganizationProfileRequest,
  type OrganizationProfilePerformanceHistoryResponse,
  type OrganizationProfileStatusHistoryResponse,
} from "@choir/contracts";

import { request } from "./client";

export async function listOrganizationProfiles(
  signal?: AbortSignal,
): Promise<readonly OrganizationProfile[]> {
  const response = await request("/api/organization/profiles", { signal: signal ?? null });
  return organizationProfilesResponseSchema.parse(await response.json()).profiles;
}

export async function listOrganizationMemberships(
  signal?: AbortSignal,
): Promise<OrganizationMembershipsResponse> {
  const response = await request("/api/organization/members", { signal: signal ?? null });
  return organizationMembershipsResponseSchema.parse(await response.json());
}

export async function linkOrganizationMembershipProfile(
  membershipId: string,
  profileId: string,
): Promise<void> {
  await request(`/api/organization/members/${encodeURIComponent(membershipId)}/profile`, {
    body: JSON.stringify({ profileId }),
    method: "PUT",
  });
}

export async function createOrganizationProfile(
  profile: OrganizationProfileRequest,
): Promise<OrganizationProfile> {
  const response = await request("/api/organization/profiles", {
    body: JSON.stringify(profile),
    method: "POST",
  });
  return organizationProfileResponseSchema.parse(await response.json());
}

export async function importOrganizationProfilesCsv(
  csv: string,
): Promise<{ readonly imported: number; readonly invitationCandidates: number }> {
  const response = await request("/api/organization/profiles/import", {
    body: csv,
    headers: { "content-type": "text/csv; charset=utf-8" },
    method: "POST",
  });
  const parsed = organizationProfileImportResponseSchema.parse(await response.json());
  return { imported: parsed.imported, invitationCandidates: parsed.invitationCandidates };
}

export async function updateOrganizationProfile(
  profileId: string,
  profile: OrganizationProfileRequest,
): Promise<OrganizationProfile> {
  const response = await request(`/api/organization/profiles/${encodeURIComponent(profileId)}`, {
    body: JSON.stringify(profile),
    method: "PUT",
  });
  return organizationProfileResponseSchema.parse(await response.json());
}

export async function getOrganizationProfilePerformanceHistory(
  profileId: string,
  signal?: AbortSignal,
): Promise<OrganizationProfilePerformanceHistoryResponse> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/performance-history`,
    { signal: signal ?? null },
  );
  return organizationProfilePerformanceHistoryResponseSchema.parse(await response.json());
}

export async function getOrganizationProfileStatusHistory(
  profileId: string,
  signal?: AbortSignal,
): Promise<OrganizationProfileStatusHistoryResponse> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/status-history`,
    { signal: signal ?? null },
  );
  return organizationProfileStatusHistoryResponseSchema.parse(await response.json());
}

export async function getOrganizationProfileFolderNumbers(
  profileId: string,
  signal?: AbortSignal,
): Promise<readonly OrganizationProfileFolderNumber[]> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/folder-numbers`,
    { signal: signal ?? null },
  );
  return organizationProfileFolderNumbersResponseSchema.parse(await response.json()).folderNumbers;
}

export async function updateOrganizationProfileFolderNumber(
  profileId: string,
  eventId: string,
  folder: OrganizationProfileFolderNumberUpdate,
): Promise<OrganizationProfileFolderNumber> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/folder-numbers/${encodeURIComponent(eventId)}`,
    { body: JSON.stringify(folder), method: "PUT" },
  );
  return organizationProfileFolderNumberSchema.parse(await response.json());
}

export async function getMemberProfile(signal?: AbortSignal): Promise<MemberProfile> {
  const response = await request("/api/singer/profile", { signal: signal ?? null });
  return memberProfileResponseSchema.parse(await response.json());
}

export async function updateMemberProfile(
  profile: MemberProfileUpdateRequest,
): Promise<MemberProfile> {
  const response = await request("/api/singer/profile", {
    body: JSON.stringify(profile),
    method: "PUT",
  });
  return memberProfileResponseSchema.parse(await response.json());
}

export async function listOrganizationDirectory(
  signal?: AbortSignal,
): Promise<readonly OrganizationDirectoryProfile[]> {
  const response = await request("/api/singer/directory", { signal: signal ?? null });
  return organizationDirectoryResponseSchema.parse(await response.json()).profiles;
}

export async function setOrganizationProfilePhoto(
  profileId: string,
  fileId: string,
): Promise<void> {
  await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/photo/${encodeURIComponent(fileId)}`,
    { method: "PUT" },
  );
}

export async function deleteOrganizationProfilePhoto(profileId: string): Promise<void> {
  await request(`/api/organization/profiles/${encodeURIComponent(profileId)}/photo`, {
    method: "DELETE",
  });
}
