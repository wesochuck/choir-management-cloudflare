import {
  publicWebsiteProjectionPayloadSchema,
  publicWebsiteSettingsRequestSchema,
  publicWebsiteSettingsSchema,
  type PublicWebsiteSettingsRequest,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import {
  activatePublishedOrganization,
  publishedMediaKey,
  writePublishedOrganization,
} from "../publication/publishOrganization";
import { privateOrganizationFileKey } from "../storage/privateFiles";

const contextSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const mediaSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  id: z.uuid(),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});

const publicationDraftSchema = z.object({
  media: z.array(mediaSchema).max(102),
  payload: publicWebsiteProjectionPayloadSchema,
  version: z.number().int().positive(),
});

const publicationCompleteSchema = z.object({
  publishedAt: z.iso.datetime(),
  version: z.number().int().positive(),
});

export class PublicWebsiteError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}

type WebsiteContext = z.infer<typeof contextSchema>;

function organizationStub(env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) {
  return env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
}

async function internalPost(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: WebsiteContext,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> {
  return organizationStub(env, context.organizationId).fetch(
    "https://organization.internal/internal/website/manage",
    {
      body: JSON.stringify({ ...context, ...body }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

export async function readOrganizationPublicWebsiteSettings(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
) {
  const response = await organizationStub(env, organizationId).fetch(
    `https://organization.internal/internal/website/settings?organizationId=${encodeURIComponent(organizationId)}`,
  );
  const parsed = publicWebsiteSettingsSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) {
    throw new PublicWebsiteError(404, "The Organization website settings were not found.");
  }
  return parsed.data;
}

export async function updateOrganizationPublicWebsiteSettings(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: WebsiteContext,
  settings: PublicWebsiteSettingsRequest,
) {
  const validatedContext = contextSchema.parse(context);
  const validatedSettings = publicWebsiteSettingsRequestSchema.parse(settings);
  const response = await internalPost(env, validatedContext, {
    action: "update",
    settings: validatedSettings,
  });
  const parsed = publicWebsiteSettingsSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) {
    throw new PublicWebsiteError(
      response.status === 409 ? 409 : 400,
      response.status === 409
        ? "One of the public website images is unavailable."
        : "The public website settings were rejected.",
    );
  }
  return parsed.data;
}

async function copyPublicMedia(
  env: Pick<Env, "ORGANIZATION_FILES">,
  organizationId: string,
  version: number,
  media: z.infer<typeof mediaSchema>,
): Promise<void> {
  const sourceKey = privateOrganizationFileKey(organizationId, media.id);
  const source = await env.ORGANIZATION_FILES.get(sourceKey);
  const sourceMetadata = source?.customMetadata;
  if (
    source?.size !== media.sizeBytes ||
    sourceMetadata?.organizationId !== organizationId ||
    sourceMetadata.fileId !== media.id
  ) {
    throw new PublicWebsiteError(409, "A public website image is no longer available.");
  }
  await env.ORGANIZATION_FILES.put(
    publishedMediaKey(organizationId, version, media.id),
    source.body,
    {
      customMetadata: {
        fileId: media.id,
        organizationId,
        version: String(version),
      },
      httpMetadata: { contentType: media.contentType },
    },
  );
}

async function copyPublicMediaInBatches(
  env: Pick<Env, "ORGANIZATION_FILES">,
  organizationId: string,
  version: number,
  media: readonly z.infer<typeof mediaSchema>[],
): Promise<void> {
  for (let index = 0; index < media.length; index += 5) {
    await Promise.all(
      media
        .slice(index, index + 5)
        .map((item) => copyPublicMedia(env, organizationId, version, item)),
    );
  }
}

export async function publishOrganizationPublicWebsite(
  env: Pick<Env, "ORGANIZATION_FILES" | "ORGANIZATION_STORE" | "ROUTING_CACHE">,
  context: WebsiteContext,
) {
  const validatedContext = contextSchema.parse(context);
  const beginResponse = await internalPost(env, validatedContext, {
    action: "begin_publication",
  });
  const draft = publicationDraftSchema.safeParse(await beginResponse.json().catch(() => null));
  if (!beginResponse.ok || !draft.success) {
    throw new PublicWebsiteError(
      beginResponse.status === 409 ? 409 : 503,
      "The public website snapshot could not be prepared.",
    );
  }
  const generatedAt = new Date().toISOString();
  const projection = {
    generatedAt,
    organizationId: validatedContext.organizationId,
    payload: draft.data.payload,
    version: draft.data.version,
  };
  await copyPublicMediaInBatches(
    env,
    validatedContext.organizationId,
    draft.data.version,
    draft.data.media,
  );
  const key = await writePublishedOrganization(env, projection);
  await activatePublishedOrganization(env, projection, key);
  const completeResponse = await internalPost(env, validatedContext, {
    action: "complete_publication",
    publishedAt: generatedAt,
    version: draft.data.version,
  });
  const completed = publicationCompleteSchema.safeParse(
    await completeResponse.json().catch(() => null),
  );
  if (!completeResponse.ok || !completed.success) {
    throw new PublicWebsiteError(503, "The public website publication could not be finalized.");
  }
  return completed.data;
}
