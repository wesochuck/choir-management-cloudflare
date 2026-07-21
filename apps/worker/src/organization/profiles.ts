import {
  organizationProfileSchema,
  organizationProfilesResponseSchema,
  type OrganizationProfile,
  type OrganizationProfileRequest,
} from "@choir/contracts";

import type { Env } from "../env";

interface ProfileEmailRow {
  readonly email: string;
  readonly profileId: string;
}

function organizationStub(env: Env, organizationId: string): DurableObjectStub {
  return env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
}

export async function listOrganizationProfiles(
  env: Env,
  organizationId: string,
): Promise<readonly OrganizationProfile[]> {
  const url = new URL("https://organization.internal/internal/profiles");
  url.searchParams.set("organizationId", organizationId);
  const response = await organizationStub(env, organizationId).fetch(url);
  if (!response.ok) throw new Error("The Organization store rejected the Profile list request.");
  return organizationProfilesResponseSchema.omit({ requestId: true }).parse(await response.json())
    .profiles;
}

export async function listOrganizationProfileEmails(
  database: D1Database,
  organizationId: string,
): Promise<ReadonlyMap<string, string>> {
  const result = await database
    .prepare(
      `SELECT m.profileId AS profileId, u.email
       FROM member m
       JOIN user u ON u.id = m.userId
       WHERE m.organizationId = ? AND m.profileId IS NOT NULL`,
    )
    .bind(organizationId)
    .all<ProfileEmailRow>();
  return new Map(result.results.map(({ email, profileId }) => [profileId, email]));
}

export async function createOrganizationProfile(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly profile: OrganizationProfileRequest;
    readonly requestId: string;
  },
): Promise<OrganizationProfile> {
  const profileId = crypto.randomUUID();
  const response = await organizationStub(env, input.organizationId).fetch(
    "https://organization.internal/internal/profiles",
    {
      body: JSON.stringify({ ...input, profileId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error("The Organization store rejected the Profile create request.");
  const profile = organizationProfileSchema.parse(await response.json());
  if (profile.id !== profileId) {
    throw new Error("The Organization store returned a mismatched Profile identity.");
  }
  return profile;
}

export async function updateOrganizationProfile(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly profile: OrganizationProfileRequest;
    readonly profileId: string;
    readonly requestId: string;
  },
): Promise<OrganizationProfile> {
  const response = await organizationStub(env, input.organizationId).fetch(
    "https://organization.internal/internal/profiles/update",
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error("The Organization store rejected the Profile update request.");
  const profile = organizationProfileSchema.parse(await response.json());
  if (profile.id !== input.profileId) {
    throw new Error("The Organization store returned a mismatched Profile identity.");
  }
  return profile;
}
