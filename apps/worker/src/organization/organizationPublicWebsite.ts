import {
  publicWebsiteProjectionPayloadSchema,
  publicWebsiteSettingsRequestSchema,
  publicWebsiteSettingsSchema,
  type PublicWebsiteSettingsRequest,
} from "@choir/contracts";
import { z } from "zod";

import type { publicWebsiteOperationSchema } from "./publicWebsiteStore";
import type { Env } from "../env";
import {
  activatePublishedOrganization,
  publishedMediaKey,
  writePublishedOrganization,
  readPublishedOrganization,
  PublicationConflictError,
} from "../publication/publishOrganization";
import { privateOrganizationFileKey } from "../storage/privateFiles";
import { organizationStoreStub } from "./rpc/client";

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
    readonly code = "public_website_error",
  ) {
    super(message);
  }
}

type WebsiteContext = z.infer<typeof contextSchema>;

function organizationStub(env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) {
  return organizationStoreStub(env, organizationId);
}

async function runWebsiteOperation(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: WebsiteContext,
  body: z.infer<typeof publicWebsiteOperationSchema> extends infer T
    ? T extends WebsiteContext
      ? Omit<T, keyof WebsiteContext>
      : never
    : never,
): Promise<Response> {
  return organizationStub(env, context.organizationId).managePublicWebsite({
    ...context,
    ...body,
  });
}

export async function readOrganizationPublicWebsiteSettings(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
) {
  const response = await organizationStub(env, organizationId).readPublicWebsiteSettings({
    organizationId,
  });
  const parsed = publicWebsiteSettingsSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) {
    throw new PublicWebsiteError(404, "The Organization website settings were not found.");
  }
  return parsed.data;
}

function throwWebsiteImageError(code: string) {
  if (code === "website_image_limit_exceeded") {
    throw new PublicWebsiteError(
      409,
      "Use at most 50 distinct content images and 102 total published images.",
      code,
    );
  }
  if (code === "invalid_public_website_image") {
    throw new PublicWebsiteError(409, "One of the public website images is unavailable.", code);
  }
}

export async function updateOrganizationPublicWebsiteSettings(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: WebsiteContext,
  settings: PublicWebsiteSettingsRequest,
) {
  const validatedContext = contextSchema.parse(context);
  const validatedSettings = publicWebsiteSettingsRequestSchema.parse(settings);
  const response = await runWebsiteOperation(env, validatedContext, {
    action: "update",
    settings: validatedSettings,
  });
  const responseBody: unknown = await response.json().catch(() => null);
  const problem = z.object({ code: z.string() }).safeParse(responseBody);
  if (
    !response.ok &&
    problem.success &&
    ["website_draft_conflict", "website_page_url_locked"].includes(problem.data.code)
  ) {
    throw new PublicWebsiteError(
      409,
      problem.data.code === "website_draft_conflict"
        ? "This draft changed in another tab. Your edits are preserved; reload to review the latest saved draft before saving again."
        : "Saved page URLs cannot be changed.",
      problem.data.code,
    );
  }
  if (!response.ok && problem.success && problem.data.code === "website_settings_too_large") {
    throw new PublicWebsiteError(
      400,
      "Website settings, including compatible History content, must be 500,000 UTF-8 bytes or smaller.",
      problem.data.code,
    );
  }
  if (!response.ok && problem.success) throwWebsiteImageError(problem.data.code);
  const parsed = publicWebsiteSettingsSchema.safeParse(responseBody);
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
  schedule?: { readonly settings: PublicWebsiteSettingsRequest; readonly version: number },
) {
  const validatedContext = contextSchema.parse(context);
  const beginResponse = await runWebsiteOperation(env, validatedContext, {
    action: "begin_publication",
    ...(schedule ? { scheduleSettings: schedule.settings, expectedVersion: schedule.version } : {}),
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
  const completeResponse = await runWebsiteOperation(env, validatedContext, {
    action: "complete_publication",
    publishedAt: generatedAt,
    version: draft.data.version,
  });
  const completed = publicationCompleteSchema.safeParse(
    await completeResponse.json().catch(() => null),
  );
  if (!completeResponse.ok || !completed.success) {
    throw new PublicWebsiteError(
      completeResponse.status === 409 ? 409 : 503,
      "The public website publication could not be finalized.",
    );
  }
  return completed.data;
}

/** Refresh event content without exposing the administrator's saved website draft. */
export async function refreshOrganizationPublicSchedule(
  env: Pick<Env, "ORGANIZATION_FILES" | "ORGANIZATION_STORE" | "ROUTING_CACHE">,
  context: WebsiteContext,
  event: { readonly eventId: string; readonly isPublic: boolean },
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readPublishedOrganization(env, context.organizationId);
    // An Organization must publish its website once before its live schedule can be refreshed.
    if (!current) return;
    if (
      !event.isPublic &&
      !current.projection.payload.performances.some(({ id }) => id === event.eventId)
    )
      return;
    try {
      await publishOrganizationPublicWebsite(env, context, {
        settings: current.projection.payload.settings,
        version: current.projection.version,
      });
      return;
    } catch (error) {
      const conflict =
        error instanceof PublicationConflictError ||
        (error instanceof PublicWebsiteError && error.status === 409);
      if (!conflict || attempt === 2) throw error;
    }
  }
}
