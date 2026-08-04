import {
  organizationAuditionSchema,
  organizationAuditionListResponseSchema,
  organizationAuditionSettingsSchema,
  organizationAuditionSettingsResponseSchema,
  organizationAuditionCreateRequestSchema,
  organizationAuditionResponseSchema,
  organizationAuditionUpdateRequestSchema,
  type OrganizationAuditionCreateRequest,
  type OrganizationAuditionSettings,
  type OrganizationAudition,
  type AuditionStatus,
} from "@choir/contracts";

import { request } from "./client";

export async function listOrganizationAuditions(
  signal?: AbortSignal,
): Promise<readonly OrganizationAudition[]> {
  const response = await request("/api/organization/auditions", { signal: signal ?? null });
  return organizationAuditionListResponseSchema.parse(await response.json()).auditions;
}

export async function getOrganizationAuditionSettings(
  signal?: AbortSignal,
): Promise<OrganizationAuditionSettings> {
  const response = await request("/api/organization/audition-settings", {
    signal: signal ?? null,
  });
  return organizationAuditionSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationAuditionSettings(
  settings: OrganizationAuditionSettings,
): Promise<OrganizationAuditionSettings> {
  const parsed = organizationAuditionSettingsSchema.parse(settings);
  const response = await request("/api/organization/audition-settings", {
    body: JSON.stringify(parsed),
    method: "PUT",
  });
  return organizationAuditionSettingsResponseSchema.parse(await response.json());
}

export async function createOrganizationAudition(
  audition: OrganizationAuditionCreateRequest,
): Promise<OrganizationAudition> {
  const parsed = organizationAuditionCreateRequestSchema.parse(audition);
  const response = await request("/api/organization/auditions", {
    body: JSON.stringify(parsed),
    method: "POST",
  });
  return organizationAuditionResponseSchema.parse(await response.json());
}

export async function updateOrganizationAudition(
  auditionId: string,
  update: {
    readonly adminNotes?: string;
    readonly availabilityNotes?: string;
    readonly email?: string;
    readonly experience?: string;
    readonly name?: string;
    readonly performanceId?: string | null;
    readonly phone?: string;
    readonly requestedSlots?: readonly string[];
    readonly scheduledTimeSlot?: string | null;
    readonly status?: AuditionStatus;
    readonly voicePart?: string;
  },
): Promise<OrganizationAudition> {
  const parsed = organizationAuditionUpdateRequestSchema.parse(update);
  const response = await request(`/api/organization/auditions/${encodeURIComponent(auditionId)}`, {
    body: JSON.stringify(parsed),
    method: "PUT",
  });
  return organizationAuditionSchema.parse(await response.json());
}

export async function deleteOrganizationAudition(auditionId: string): Promise<void> {
  await request(`/api/organization/auditions/${encodeURIComponent(auditionId)}`, {
    method: "DELETE",
  });
}

export async function convertOrganizationAudition(
  auditionId: string,
): Promise<{ readonly profileId: string }> {
  const response = await request(
    `/api/organization/auditions/${encodeURIComponent(auditionId)}/convert`,
    { method: "POST" },
  );
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("profile" in body) ||
    typeof body.profile !== "object" ||
    body.profile === null ||
    !("id" in body.profile) ||
    typeof body.profile.id !== "string"
  ) {
    throw new Error("The audition conversion response was invalid.");
  }
  return { profileId: body.profile.id };
}

