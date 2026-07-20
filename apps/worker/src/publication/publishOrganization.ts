import type { Env } from "../env";

export interface PublishedProjection {
  readonly generatedAt: string;
  readonly organizationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly version: number;
}

export async function publishOrganization(
  env: Env,
  projection: PublishedProjection,
): Promise<string> {
  const key = `organizations/${projection.organizationId}/published/v${String(projection.version)}/index.json`;
  await env.ORGANIZATION_FILES.put(key, JSON.stringify(projection), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  await env.ROUTING_CACHE.put(
    `published:${projection.organizationId}`,
    JSON.stringify({ key, version: projection.version }),
  );
  return key;
}
