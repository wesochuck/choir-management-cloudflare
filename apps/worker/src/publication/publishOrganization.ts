import {
  organizationIdSchema,
  publishedOrganizationProjectionSchema,
  type PublishedOrganizationProjection,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";

const MAX_PUBLISHED_PROJECTION_BYTES = 1_000_000;

const publishedProjectionPointerSchema = z.object({
  key: z.string().min(1).max(512),
  organizationId: organizationIdSchema,
  version: z.number().int().positive().max(2_147_483_647),
});

type PublicationEnv = Pick<Env, "ORGANIZATION_FILES" | "ROUTING_CACHE">;

export interface ReadPublishedProjection {
  readonly httpEtag: string;
  readonly projection: PublishedOrganizationProjection;
}

export function publishedProjectionKey(organizationId: string, version: number): string {
  return `organizations/${organizationId}/published/v${String(version)}/index.json`;
}

export function publishedMediaKey(organizationId: string, version: number, fileId: string): string {
  return `organizations/${organizationId}/published/v${String(version)}/media/${fileId}`;
}

export async function writePublishedOrganization(
  env: PublicationEnv,
  projection: PublishedOrganizationProjection,
): Promise<string> {
  const validatedProjection = publishedOrganizationProjectionSchema.parse(projection);
  const serializedProjection = JSON.stringify(validatedProjection);
  if (new TextEncoder().encode(serializedProjection).byteLength > MAX_PUBLISHED_PROJECTION_BYTES) {
    throw new Error("The published Organization projection exceeds the size limit.");
  }
  const key = publishedProjectionKey(
    validatedProjection.organizationId,
    validatedProjection.version,
  );
  await env.ORGANIZATION_FILES.put(key, serializedProjection, {
    customMetadata: {
      organizationId: validatedProjection.organizationId,
      version: String(validatedProjection.version),
    },
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  return key;
}

export async function activatePublishedOrganization(
  env: PublicationEnv,
  projection: PublishedOrganizationProjection,
  key: string,
): Promise<void> {
  const validatedProjection = publishedOrganizationProjectionSchema.parse(projection);
  const expectedKey = publishedProjectionKey(
    validatedProjection.organizationId,
    validatedProjection.version,
  );
  if (key !== expectedKey) throw new Error("The published Organization pointer key is invalid.");
  await env.ROUTING_CACHE.put(
    `published:${validatedProjection.organizationId}`,
    JSON.stringify({
      key,
      organizationId: validatedProjection.organizationId,
      version: validatedProjection.version,
    }),
  );
}

export async function publishOrganization(
  env: PublicationEnv,
  projection: PublishedOrganizationProjection,
): Promise<string> {
  const key = await writePublishedOrganization(env, projection);
  await activatePublishedOrganization(env, projection, key);
  return key;
}

export async function readPublishedOrganization(
  env: PublicationEnv,
  organizationId: string,
): Promise<ReadPublishedProjection | null> {
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return null;
  }
  const pointerValue: unknown = await env.ROUTING_CACHE.get(
    `published:${parsedOrganizationId.data}`,
    "json",
  ).catch(() => null);
  const pointer = publishedProjectionPointerSchema.safeParse(pointerValue);
  if (!pointer.success || pointer.data.organizationId !== parsedOrganizationId.data) {
    return null;
  }
  const expectedKey = publishedProjectionKey(parsedOrganizationId.data, pointer.data.version);
  if (pointer.data.key !== expectedKey) {
    return null;
  }
  const object = await env.ORGANIZATION_FILES.get(expectedKey);
  if (!object || object.size > MAX_PUBLISHED_PROJECTION_BYTES) {
    return null;
  }
  const projectionValue: unknown = await object.json().catch(() => null);
  const projection = publishedOrganizationProjectionSchema.safeParse(projectionValue);
  if (
    !projection.success ||
    projection.data.organizationId !== parsedOrganizationId.data ||
    projection.data.version !== pointer.data.version
  ) {
    return null;
  }
  return { httpEtag: object.httpEtag, projection: projection.data };
}

export async function readPublishedOrganizationMedia(
  env: PublicationEnv,
  organizationId: string,
  version: number,
  fileId: string,
): Promise<R2ObjectBody | null> {
  const projectionObject = await env.ORGANIZATION_FILES.get(
    publishedProjectionKey(organizationId, version),
  );
  const projectionValue: unknown = await projectionObject?.json().catch(() => null);
  const projection = publishedOrganizationProjectionSchema.safeParse(projectionValue);
  if (
    !projection.success ||
    projection.data.organizationId !== organizationId ||
    projection.data.version !== version ||
    !projection.data.payload.mediaFileIds.includes(fileId)
  ) {
    return null;
  }
  const key = publishedMediaKey(organizationId, version, fileId);
  const object = await env.ORGANIZATION_FILES.get(key);
  if (
    !object ||
    object.customMetadata?.organizationId !== organizationId ||
    object.customMetadata.version !== String(version) ||
    object.customMetadata.fileId !== fileId
  ) {
    return null;
  }
  return object;
}
