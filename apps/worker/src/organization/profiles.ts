import {
  memberProfileUpdateRequestSchema,
  organizationDirectoryProfileSchema,
  organizationProfileSchema,
  organizationProfileImportResponseSchema,
  organizationProfileStatusHistoryResponseSchema,
  organizationProfilesResponseSchema,
  type MemberProfileUpdateRequest,
  type OrganizationDirectoryProfile,
  type OrganizationProfile,
  type OrganizationProfileRequest,
  type OrganizationProfileStatusHistoryResponse,
} from "@choir/contracts";
import { z } from "zod";

import { assertEmailProviderRecipientAvailable } from "../communications/emailFeedback";
import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "./rpc/client";

interface ProfileEmailRow {
  readonly email: string;
  readonly profileId: string;
}

const directoryStoreResponseSchema = z.object({
  profiles: z
    .array(
      organizationDirectoryProfileSchema.omit({ email: true }).extend({
        showEmailInDirectory: z.union([z.literal(0), z.literal(1)]).default(1),
      }),
    )
    .max(500),
});

export class OrganizationProfileMutationError extends Error {
  readonly code: string;
  readonly configuredVoiceParts?: readonly string[] | undefined;
  readonly rejectedValue?: string | undefined;

  constructor(
    options?:
      | string
      | {
          readonly configuredVoiceParts?: readonly string[] | undefined;
          readonly rejectedValue?: string | undefined;
        },
  ) {
    const opts = typeof options === "string" ? undefined : options;
    const configuredSuffix =
      opts?.configuredVoiceParts && opts.configuredVoiceParts.length > 0
        ? ` Configured voice parts: ${opts.configuredVoiceParts.join(", ")}.`
        : "";
    super(`The selected voice part is not configured for this Organization.${configuredSuffix}`);
    this.name = "OrganizationProfileMutationError";
    this.code = typeof options === "string" ? options : "voice_part_not_configured";
    if (this.code === "contact_duplicate_email")
      this.message =
        "This email belongs to another Contact. Resolve its Profile link before saving.";
    this.configuredVoiceParts = opts?.configuredVoiceParts;
    this.rejectedValue = opts?.rejectedValue;
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
      body.code === "contact_duplicate_email"
    ) {
      throw new OrganizationProfileMutationError("contact_duplicate_email");
    }
    if (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      body.code === "voice_part_not_configured"
    ) {
      const configuredVoiceParts =
        "configuredVoiceParts" in body && Array.isArray(body.configuredVoiceParts)
          ? body.configuredVoiceParts.filter((item): item is string => typeof item === "string")
          : undefined;
      const rejectedValue =
        "rejectedValue" in body && typeof body.rejectedValue === "string"
          ? body.rejectedValue
          : undefined;
      throw new OrganizationProfileMutationError({ configuredVoiceParts, rejectedValue });
    }
  }
  if (!response.ok) throw new Error(`The Organization store rejected the Profile ${operation}.`);
}

function organizationStub(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): ReturnType<typeof organizationStoreStub> {
  return organizationStoreStub(env, organizationId);
}

export async function listOrganizationProfiles(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly OrganizationProfile[]> {
  const url = new URL("https://organization.internal/internal/profiles");
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(organizationStub(env, organizationId), url);
  if (!response.ok) throw new Error("The Organization store rejected the Profile list request.");
  return organizationProfilesResponseSchema.omit({ requestId: true }).parse(await response.json())
    .profiles;
}

export async function listOrganizationProfileStatusHistory(
  env: Env,
  organizationId: string,
  profileId: string,
): Promise<OrganizationProfileStatusHistoryResponse | null> {
  const url = new URL("https://organization.internal/internal/profiles/status-history");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("profileId", profileId);
  const response = await invokeOrganizationRpc(organizationStub(env, organizationId), url);
  if (response.status === 404) return null;
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
  const response = await invokeOrganizationRpc(organizationStub(env, organizationId), url);
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
    invokeOrganizationRpc(organizationStub(env, organizationId), url),
    listOrganizationProfileEmails(database, organizationId),
  ]);
  if (!response.ok) throw new Error("The Organization store rejected the directory request.");
  return directoryStoreResponseSchema
    .parse(await response.json())
    .profiles.map(({ showEmailInDirectory, ...profile }) => ({
      ...profile,
      email: showEmailInDirectory === 1 ? (emails.get(profile.id) ?? "") : "",
    }));
}

export async function createOrganizationProfile(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly email?: string;
    readonly organizationId: string;
    readonly profile: OrganizationProfileRequest;
    readonly requestId: string;
  },
): Promise<OrganizationProfile> {
  if (input.email) {
    await assertEmailProviderRecipientAvailable(env.CONTROL_DB, input.email);
  }
  const profileId = crypto.randomUUID();
  const response = await invokeOrganizationRpc(
    organizationStub(env, input.organizationId),
    "https://organization.internal/internal/profiles",
    {
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        profile: { ...input.profile, ...(input.email !== undefined ? { email: input.email } : {}) },
        profileId,
        requestId: input.requestId,
      }),
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

export class OrganizationProfileDeletionError extends Error {
  readonly code: string;

  constructor(message: string, code = "profile_history_requires_inactive") {
    super(message);
    this.name = "OrganizationProfileDeletionError";
    this.code = code;
  }
}

export async function deleteOrganizationProfile(
  env: Pick<Env, "ORGANIZATION_STORE">,
  input: {
    readonly contacts?: "keep" | "delete_unused";
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly profileId: string;
    readonly requestId: string;
  },
): Promise<boolean> {
  const response = await invokeOrganizationRpc(
    organizationStub(env, input.organizationId),
    "https://organization.internal/internal/profiles/delete",
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (response.status === 409) {
    const errorBody: unknown = await response.json().catch(() => null);
    const code =
      typeof errorBody === "object" &&
      errorBody !== null &&
      "code" in errorBody &&
      typeof errorBody.code === "string"
        ? errorBody.code
        : "profile_history_requires_inactive";
    const message =
      typeof errorBody === "object" &&
      errorBody !== null &&
      "message" in errorBody &&
      typeof errorBody.message === "string"
        ? errorBody.message
        : "Profiles with historical records cannot be deleted. Archive the profile instead.";
    throw new OrganizationProfileDeletionError(message, code);
  }
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error("The Organization store rejected the Profile delete request.");
  }
  return true;
}

export async function importOrganizationProfiles(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly email?: string;
    readonly organizationId: string;
    readonly profiles: readonly OrganizationProfileRequest[];
    readonly requestId: string;
  },
): Promise<z.infer<typeof organizationProfileImportResponseSchema>> {
  const response = await invokeOrganizationRpc(
    organizationStub(env, input.organizationId),
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
  return organizationProfileImportResponseSchema.parse({
    ...z
      .object({
        imported: z.number(),
        emailsPersisted: z.number(),
        phonesPersisted: z.number(),
        conflicts: z.array(z.object({ row: z.number(), message: z.string() })),
      })
      .parse(await response.json()),
    requestId: input.requestId,
  });
}

export async function updateOrganizationProfile(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly email?: string;
    readonly organizationId: string;
    readonly profile: OrganizationProfileRequest;
    readonly profileId: string;
    readonly requestId: string;
  },
): Promise<OrganizationProfile> {
  if (input.email) {
    await assertEmailProviderRecipientAvailable(env.CONTROL_DB, input.email);
  }
  const response = await invokeOrganizationRpc(
    organizationStub(env, input.organizationId),
    "https://organization.internal/internal/profiles/update",
    {
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        profile: { ...input.profile, ...(input.email !== undefined ? { email: input.email } : {}) },
        profileId: input.profileId,
        requestId: input.requestId,
      }),
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
  const response = await invokeOrganizationRpc(
    organizationStub(env, input.organizationId),
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
  const response = await invokeOrganizationRpc(
    organizationStub(env, input.organizationId),
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
