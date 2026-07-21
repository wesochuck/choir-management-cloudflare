import type { PublicDomainResponse } from "@choir/contracts";
import { failure, success, type DomainResult } from "@choir/domain";

import type { Env } from "../env";

interface PublicDomainRow {
  readonly domainId: string;
  readonly hostname: string;
  readonly organizationId: string;
  readonly routingVersion: number;
  readonly status: "active" | "disabled" | "pending";
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function isProductHostname(hostname: string, productBaseDomain: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  const normalizedBase = normalizeHostname(productBaseDomain);
  return normalizedHostname === normalizedBase || normalizedHostname.endsWith(`.${normalizedBase}`);
}

export async function registerPublicDomain(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly hostname: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  now = new Date(),
): Promise<DomainResult<PublicDomainResponse>> {
  const hostname = normalizeHostname(input.hostname);
  if (isProductHostname(hostname, env.PRODUCT_BASE_DOMAIN)) {
    return failure(
      "validation_failed",
      "A Public Website Domain must be outside the product hostname namespace.",
    );
  }

  const domainId = crypto.randomUUID();
  const occurredAt = now.toISOString();
  try {
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'custom_public', 'pending', 1, ?, ?)`,
      ).bind(domainId, input.organizationId, hostname, occurredAt, occurredAt),
      env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'organization.public_domain.registered',
           'public_website_domain', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.actorUserId,
        input.organizationId,
        domainId,
        input.requestId,
        JSON.stringify({ hostname, status: "pending" }),
        occurredAt,
      ),
    ]);
  } catch {
    return failure("conflict", "This Public Website Domain is already registered.");
  }

  return success({
    domainId,
    hostname,
    organizationId: input.organizationId,
    routingVersion: 1,
    status: "pending",
  });
}

export async function listPublicDomains(
  database: D1Database,
  organizationId: string,
): Promise<readonly PublicDomainResponse[]> {
  const result = await database
    .prepare(
      `SELECT id AS domainId, hostname, organization_id AS organizationId,
        routing_version AS routingVersion, status
       FROM organization_domains
       WHERE organization_id = ? AND kind = 'custom_public'
       ORDER BY hostname`,
    )
    .bind(organizationId)
    .all<PublicDomainRow>();
  return result.results;
}

export async function disablePublicDomain(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly domainId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  now = new Date(),
): Promise<DomainResult<PublicDomainResponse>> {
  const domain = await env.CONTROL_DB.prepare(
    `SELECT id AS domainId, hostname, organization_id AS organizationId,
      routing_version AS routingVersion, status
     FROM organization_domains
     WHERE id = ? AND organization_id = ? AND kind = 'custom_public'
     LIMIT 1`,
  )
    .bind(input.domainId, input.organizationId)
    .first<PublicDomainRow>();
  if (!domain) {
    return failure("not_found", "The Public Website Domain was not found.");
  }
  if (domain.status === "disabled") {
    return success(domain);
  }

  const occurredAt = now.toISOString();
  const routingVersion = domain.routingVersion + 1;
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      `UPDATE organization_domains
       SET status = 'disabled', routing_version = ?, updated_at = ?
       WHERE id = ? AND organization_id = ? AND kind = 'custom_public'`,
    ).bind(routingVersion, occurredAt, input.domainId, input.organizationId),
    env.CONTROL_DB.prepare(
      `INSERT INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, 'organization.public_domain.disabled',
         'public_website_domain', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.actorUserId,
      input.organizationId,
      input.domainId,
      input.requestId,
      JSON.stringify({
        after: { routingVersion, status: "disabled" },
        before: { routingVersion: domain.routingVersion, status: domain.status },
        hostname: domain.hostname,
      }),
      occurredAt,
    ),
  ]);
  await env.ROUTING_CACHE.delete(`host:${domain.hostname}`);

  return success({ ...domain, routingVersion, status: "disabled" });
}
