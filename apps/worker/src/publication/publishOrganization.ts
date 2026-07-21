import { organizationIdSchema } from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";

const MAX_PUBLISHED_PROJECTION_BYTES = 1_000_000;

const publishedProjectionSchema = z.object({
  generatedAt: z.iso.datetime(),
  organizationId: organizationIdSchema,
  payload: z.record(z.string().min(1).max(128), z.unknown()),
  version: z.number().int().positive().max(2_147_483_647),
});

const publishedProjectionPointerSchema = z.object({
  key: z.string().min(1).max(512),
  organizationId: organizationIdSchema,
  version: z.number().int().positive().max(2_147_483_647),
});

type PublicationEnv = Pick<Env, "ORGANIZATION_FILES" | "ROUTING_CACHE">;

export interface PublishedProjection {
  readonly generatedAt: string;
  readonly organizationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly version: number;
}

export interface ReadPublishedProjection {
  readonly httpEtag: string;
  readonly projection: PublishedProjection;
}

export function publishedProjectionKey(organizationId: string, version: number): string {
  return `organizations/${organizationId}/published/v${String(version)}/index.json`;
}

export async function publishOrganization(
  env: PublicationEnv,
  projection: PublishedProjection,
): Promise<string> {
  const validatedProjection = publishedProjectionSchema.parse(projection);
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
  await env.ROUTING_CACHE.put(
    `published:${validatedProjection.organizationId}`,
    JSON.stringify({
      key,
      organizationId: validatedProjection.organizationId,
      version: validatedProjection.version,
    }),
  );
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
  const projection = publishedProjectionSchema.safeParse(projectionValue);
  if (
    !projection.success ||
    projection.data.organizationId !== parsedOrganizationId.data ||
    projection.data.version !== pointer.data.version
  ) {
    return null;
  }
  return { httpEtag: object.httpEtag, projection: projection.data };
}
