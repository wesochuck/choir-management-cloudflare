import { publicDomainValidationRecordSchema, type PublicDomainResponse } from "@choir/contracts";
import { failure, success, type DomainResult } from "@choir/domain";

import type { Env } from "../env";
import { deleteCustomHostname, type CustomDomainProviderState } from "./customDomainProvider";

export interface PublicDomainRecord extends PublicDomainResponse {
  readonly providerCheckedAt: string | null;
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function isProductHostname(hostname: string, productBaseDomain: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  const normalizedBase = normalizeHostname(productBaseDomain);
  return normalizedHostname === normalizedBase || normalizedHostname.endsWith(`.${normalizedBase}`);
}

function parseValidationRecords(value: string): PublicDomainResponse["validationRecords"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((record) => {
    const result = publicDomainValidationRecordSchema.safeParse(record);
    return result.success ? [result.data] : [];
  });
}

function providerStatus(value: string): PublicDomainResponse["providerStatus"] {
  switch (value) {
    case "active":
    case "error":
    case "not_configured":
    case "pending":
    case "disabled":
      return value;
    default:
      return "error";
  }
}

function toResponse(row: PublicDomainRecord): PublicDomainResponse {
  return {
    domainId: row.domainId,
    hostname: row.hostname,
    organizationId: row.organizationId,
    providerError: row.providerError,
    providerHostnameId: row.providerHostnameId,
    providerSslStatus: row.providerSslStatus,
    providerStatus: row.providerStatus,
    routingVersion: row.routingVersion,
    status: row.status,
    validationRecords: row.validationRecords,
  };
}

function domainSelect(): string {
  return `SELECT id AS domainId, hostname, organization_id AS organizationId,
      provider_error AS providerError, provider_hostname_id AS providerHostnameId,
      provider_ssl_status AS providerSslStatus, provider_status AS providerStatus,
      routing_version AS routingVersion, status,
      validation_records_json AS validationRecordsJson,
      provider_checked_at AS providerCheckedAt
     FROM organization_domains`;
}

function mapDomainRow(
  row: Omit<PublicDomainRecord, "validationRecords"> & { readonly validationRecordsJson: string },
): PublicDomainRecord {
  return {
    ...row,
    providerStatus: providerStatus(row.providerStatus),
    validationRecords: parseValidationRecords(row.validationRecordsJson),
  };
}

export async function readPublicDomain(
  database: D1Database,
  input: { readonly domainId: string; readonly organizationId: string },
): Promise<PublicDomainRecord | null> {
  const row = await database
    .prepare(
      `${domainSelect()}
       WHERE id = ? AND organization_id = ? AND kind = 'custom_public'
       LIMIT 1`,
    )
    .bind(input.domainId, input.organizationId)
    .first<
      Omit<PublicDomainRecord, "validationRecords"> & { readonly validationRecordsJson: string }
    >();
  return row ? mapDomainRow(row) : null;
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

  try {
    await env.CUSTOM_DOMAIN_WORKFLOW.create({
      id: `custom-domain-${domainId}`,
      params: {
        actorUserId: input.actorUserId,
        attempt: 0,
        domainId,
        organizationId: input.organizationId,
        requestId: input.requestId,
      },
    });
  } catch {
    await recordCustomDomainProviderError(env, {
      actorUserId: input.actorUserId,
      domainId,
      message: "Custom-domain onboarding could not be started.",
      now,
      organizationId: input.organizationId,
      requestId: input.requestId,
    });
  }

  const domain = await readPublicDomain(env.CONTROL_DB, {
    domainId,
    organizationId: input.organizationId,
  });
  if (!domain) return failure("conflict", "The Public Website Domain could not be registered.");
  return success(toResponse(domain));
}

export async function listPublicDomains(
  database: D1Database,
  organizationId: string,
): Promise<readonly PublicDomainResponse[]> {
  const result = await database
    .prepare(
      `${domainSelect()}
       WHERE organization_id = ? AND kind = 'custom_public'
       ORDER BY hostname`,
    )
    .bind(organizationId)
    .all<
      Omit<PublicDomainRecord, "validationRecords"> & { readonly validationRecordsJson: string }
    >();
  return result.results.map((row) => toResponse(mapDomainRow(row)));
}

export async function recordCustomDomainProviderState(
  env: Pick<Env, "CONTROL_DB" | "ROUTING_CACHE">,
  input: {
    readonly actorUserId: string;
    readonly domainId: string;
    readonly organizationId: string;
    readonly providerState: CustomDomainProviderState;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<PublicDomainResponse | null> {
  const current = await readPublicDomain(env.CONTROL_DB, input);
  if (!current) return null;
  if (current.status === "disabled") return toResponse(current);

  const checkedAt = input.now.toISOString();
  const activated = input.providerState.providerStatus === "active";
  const routingVersion =
    activated && current.status !== "active" ? current.routingVersion + 1 : current.routingVersion;
  const status = activated ? "active" : "pending";
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      `UPDATE organization_domains
       SET status = ?, routing_version = ?, provider_hostname_id = ?,
           provider_status = ?, provider_ssl_status = ?, validation_records_json = ?,
           provider_error = NULL, provider_checked_at = ?, updated_at = ?
       WHERE id = ? AND organization_id = ? AND kind = 'custom_public'
         AND status != 'disabled'`,
    ).bind(
      status,
      routingVersion,
      input.providerState.providerHostnameId,
      input.providerState.providerStatus,
      input.providerState.providerSslStatus,
      JSON.stringify(input.providerState.validationRecords),
      checkedAt,
      checkedAt,
      input.domainId,
      input.organizationId,
    ),
    ...(activated && current.status !== "active"
      ? [
          env.CONTROL_DB.prepare(
            `INSERT INTO platform_audit_events
              (id, actor_user_id, organization_id, action, target_type, target_id,
               request_id, change_summary, occurred_at)
             VALUES (?, ?, ?, 'organization.public_domain.activated',
               'public_website_domain', ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            input.actorUserId,
            input.organizationId,
            input.domainId,
            input.requestId,
            JSON.stringify({ hostname: current.hostname, routingVersion, status }),
            checkedAt,
          ),
        ]
      : []),
  ]);

  if (activated) {
    await env.ROUTING_CACHE.put(
      `host:${current.hostname}`,
      JSON.stringify({
        organizationId: current.organizationId,
        routeKind: "custom_public",
        routingVersion,
      }),
      { expirationTtl: 300 },
    );
  }
  const updated = await readPublicDomain(env.CONTROL_DB, input);
  return updated ? toResponse(updated) : null;
}

export async function recordCustomDomainProviderError(
  env: Pick<Env, "CONTROL_DB">,
  input: {
    readonly actorUserId: string;
    readonly domainId: string;
    readonly message: string;
    readonly now: Date;
    readonly organizationId: string;
    readonly requestId: string;
  },
): Promise<void> {
  const current = await readPublicDomain(env.CONTROL_DB, input);
  if (!current || current.status === "disabled") return;

  const occurredAt = input.now.toISOString();
  const message = input.message.slice(0, 500);
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      `UPDATE organization_domains
       SET provider_status = 'error', provider_error = ?, provider_checked_at = ?, updated_at = ?
       WHERE id = ? AND organization_id = ? AND kind = 'custom_public' AND status != 'disabled'`,
    ).bind(message, occurredAt, occurredAt, input.domainId, input.organizationId),
    env.CONTROL_DB.prepare(
      `INSERT INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, 'organization.public_domain.provider_failed',
         'public_website_domain', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.actorUserId,
      input.organizationId,
      input.domainId,
      input.requestId,
      JSON.stringify({ message }),
      occurredAt,
    ),
  ]);
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
  const domain = await readPublicDomain(env.CONTROL_DB, input);
  if (!domain) {
    return failure("not_found", "The Public Website Domain was not found.");
  }
  if (domain.status === "disabled") {
    return success(toResponse(domain));
  }

  await deleteCustomHostname(env, domain.providerHostnameId);

  const occurredAt = now.toISOString();
  const routingVersion = domain.routingVersion + 1;
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      `UPDATE organization_domains
       SET status = 'disabled', routing_version = ?, provider_status = 'disabled',
           provider_error = NULL, provider_checked_at = ?, updated_at = ?
       WHERE id = ? AND organization_id = ? AND kind = 'custom_public'`,
    ).bind(routingVersion, occurredAt, occurredAt, input.domainId, input.organizationId),
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

  const disabled = await readPublicDomain(env.CONTROL_DB, input);
  return disabled
    ? success(toResponse(disabled))
    : failure("not_found", "The Public Website Domain was not found.");
}

export async function removePublicDomain(
  env: Env,
  input: {
    readonly actorUserId: string;
    readonly domainId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  now = new Date(),
): Promise<DomainResult<{ readonly domainId: string }>> {
  const domain = await readPublicDomain(env.CONTROL_DB, input);
  if (!domain) {
    return failure("not_found", "The Public Website Domain was not found.");
  }

  if (domain.providerHostnameId) {
    try {
      await deleteCustomHostname(env, domain.providerHostnameId);
    } catch {
      // Ignore provider cleanup errors if already deleted
    }
  }

  const occurredAt = now.toISOString();
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      `DELETE FROM organization_domains
       WHERE id = ? AND organization_id = ? AND kind = 'custom_public'`,
    ).bind(input.domainId, input.organizationId),
    env.CONTROL_DB.prepare(
      `INSERT INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, 'organization.public_domain.removed',
         'public_website_domain', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.actorUserId,
      input.organizationId,
      input.domainId,
      input.requestId,
      JSON.stringify({
        hostname: domain.hostname,
        previousStatus: domain.status,
      }),
      occurredAt,
    ),
  ]);
  await env.ROUTING_CACHE.delete(`host:${domain.hostname}`);

  return success({ domainId: input.domainId });
}
