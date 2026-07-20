import { failure, success, type DomainResult } from "@choir/domain";
import { z } from "zod";

import type { Env } from "../env";

const organizationRouteSchema = z.object({
  organizationId: z.string().min(1),
  routeKind: z.enum(["canonical", "custom_public"]),
  routingVersion: z.number().int().positive(),
});

export type OrganizationRoute = z.infer<typeof organizationRouteSchema>;

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export async function resolveOrganization(
  requestUrl: URL,
  env: Env,
): Promise<DomainResult<OrganizationRoute>> {
  const hostname = normalizeHostname(requestUrl.hostname);
  if (!hostname || hostname.length > 253) {
    return failure("validation_failed", "The request hostname is invalid.");
  }

  const cached = await env.ROUTING_CACHE.get(`host:${hostname}`, "json");
  const cachedRoute = organizationRouteSchema.safeParse(cached);
  if (cachedRoute.success) {
    const confirmedRow = await env.CONTROL_DB.prepare(
      `SELECT organization_id AS organizationId, kind AS routeKind,
        routing_version AS routingVersion
       FROM organization_domains
       WHERE hostname = ? AND organization_id = ? AND routing_version = ? AND status = 'active'
       LIMIT 1`,
    )
      .bind(hostname, cachedRoute.data.organizationId, cachedRoute.data.routingVersion)
      .first<OrganizationRoute>();
    const confirmedRoute = organizationRouteSchema.safeParse(confirmedRow);
    if (confirmedRoute.success) {
      return success(confirmedRoute.data);
    }
  }

  const row = await env.CONTROL_DB.prepare(
    `SELECT organization_id AS organizationId, kind AS routeKind,
      routing_version AS routingVersion
     FROM organization_domains
     WHERE hostname = ? AND status = 'active'
     LIMIT 1`,
  )
    .bind(hostname)
    .first<OrganizationRoute>();
  const route = organizationRouteSchema.safeParse(row);
  if (!route.success) {
    return failure("not_found", "No active Organization is configured for this hostname.");
  }

  await env.ROUTING_CACHE.put(`host:${hostname}`, JSON.stringify(route.data), {
    expirationTtl: 300,
  });
  return success(route.data);
}
