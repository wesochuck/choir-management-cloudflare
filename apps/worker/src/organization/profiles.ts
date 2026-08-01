import {
  memberProfileUpdateRequestSchema,
  organizationDirectoryProfileSchema,
  organizationProfileSchema,
  organizationProfileStatusHistoryResponseSchema,
  organizationProfilesResponseSchema,
  type MemberProfileUpdateRequest,
  type OrganizationDirectoryProfile,
  type OrganizationProfile,
  type OrganizationProfileRequest,
  type OrganizationProfileStatusHistoryResponse,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";

interface ProfileEmailRow {
  readonly email: string;
  readonly profileId: string;
}

const directoryStoreResponseSchema = z.object({
  profiles: z.array(organizationDirectoryProfileSchema.omit({ email: true })).max(500),
});

export class OrganizationProfileMutationError extends Error {
  readonly code: "voice_part_not_configured";

  constructor() {
    super("The selected voice part is not configured for this Organization.");
    this.name = "OrganizationProfileMutationError";
    this.code = "voice_part_not_configured";
  }
}

async function assertProfileMutationAccepted(response: Response, operation: string): Promise<void> {
  if (response.status === 400) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      body.code === "voice_part_not_configured"
    ) {
      throw new OrganizationProfileMutationError();
    }
  }
  if (!response.ok) throw new Error(`The Organization store rejected the Profile ${operation}.`);
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

export async function listOrganizationProfileStatusHistory(
  env: Env,
  organizationId: string,
  profileId: string,
): Promise<OrganizationProfileStatusHistoryResponse> {
  const url = new URL("https://organization.internal/internal/profiles/status-history");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("profileId", profileId);
  const response = await organizationStub(env, organizationId).fetch(url);
  if (!response.ok)
    throw new Error("The Organization store rejected the Profile status history request.");
  return organizationProfileStatusHistoryResponseSchema.parse(await response.json());
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

export async function readOrganizationMemberProfile(
  env: Env,
  organizationId: string,
  profileId: string,
): Promise<OrganizationProfile> {
  const url = new URL("https://organization.internal/internal/profiles/member");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("profileId", profileId);
  const response = await organizationStub(env, organizationId).fetch(url);
  if (!response.ok) throw new Error("The Organization store rejected the member Profile request.");
  return organizationProfileSchema.parse(await response.json());
}

export async function listOrganizationDirectoryProfiles(
  env: Env,
  database: D1Database,
  organizationId: string,
): Promise<readonly OrganizationDirectoryProfile[]> {
  const url = new URL("https://organization.internal/internal/profiles/directory");
  url.searchParams.set("organizationId", organizationId);
  const [response, emails] = await Promise.all([
    organizationStub(env, organizationId).fetch(url),
    listOrganizationProfileEmails(database, organizationId),
  ]);
  if (!response.ok) throw new Error("The Organization store rejected the directory request.");
  return directoryStoreResponseSchema.parse(await response.json()).profiles.map((profile) => ({
    ...profile,
    email: emails.get(profile.id) ?? "",
  }));
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
  await assertProfileMutationAccepted(response, "create request");
  const profile = organizationProfileSchema.parse(await response.json());
  if (profile.id !== profileId) {
    throw new Error("The Organization store returned a mismatched Profile identity.");
  }
  return profile;
}

export async function deleteOrganizationProfile(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly profileId: string;
    readonly requestId: string;
  },
): Promise<void> {
  const response = await organizationStub(env, input.organizationId).fetch(
    "https://organization.internal/internal/profiles/delete",
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error("The Organization store rejected the Profile delete request.");
  }
}

export async function importOrganizationProfiles(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly profiles: readonly OrganizationProfileRequest[];
    readonly requestId: string;
  },
): Promise<number> {
  const response = await organizationStub(env, input.organizationId).fetch(
    "https://organization.internal/internal/profiles/import",
    {
      body: JSON.stringify({
        ...input,
        profiles: input.profiles.map((profile) => ({ profile, profileId: crypto.randomUUID() })),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  await assertProfileMutationAccepted(response, "import request");
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("imported" in body) ||
    typeof body.imported !== "number"
  ) {
    throw new Error("The Organization store returned an invalid Profile import result.");
  }
  return body.imported;
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
  await assertProfileMutationAccepted(response, "update request");
  const profile = organizationProfileSchema.parse(await response.json());
  if (profile.id !== input.profileId) {
    throw new Error("The Organization store returned a mismatched Profile identity.");
  }
  return profile;
}

export async function updateOrganizationMemberProfile(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly profile: MemberProfileUpdateRequest;
    readonly profileId: string;
    readonly requestId: string;
  },
): Promise<OrganizationProfile> {
  const response = await organizationStub(env, input.organizationId).fetch(
    "https://organization.internal/internal/profiles/member-update",
    {
      body: JSON.stringify({
        ...input,
        profile: memberProfileUpdateRequestSchema.parse(input.profile),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error("The Organization store rejected the member Profile update.");
  const profile = organizationProfileSchema.parse(await response.json());
  if (profile.id !== input.profileId) {
    throw new Error("The Organization store returned a mismatched member Profile identity.");
  }
  return profile;
}

const profilePhotoStoreResponseSchema = z.object({
  previousFileId: z.uuid().nullable(),
  profile: organizationProfileSchema,
});

export async function setOrganizationProfilePhoto(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly fileId: string | null;
    readonly organizationId: string;
    readonly profileId: string;
    readonly requestId: string;
  },
): Promise<{ readonly previousFileId: string | null; readonly profile: OrganizationProfile }> {
  const response = await organizationStub(env, input.organizationId).fetch(
    "https://organization.internal/internal/profiles/photo",
    {
      body: JSON.stringify({
        action: input.fileId ? "attach" : "remove",
        ...input,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error("The Organization store rejected the Profile photo update.");
  return profilePhotoStoreResponseSchema.parse(await response.json());
}
