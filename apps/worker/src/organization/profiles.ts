import {
  organizationProfileSchema,
  organizationProfilesResponseSchema,
  type OrganizationProfile,
} from "@choir/contracts";

import type { Env } from "../env";

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

export async function createOrganizationProfile(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly displayName: string;
    readonly organizationId: string;
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
