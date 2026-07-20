import type { OrganizationProvisionRequest } from "@choir/contracts";

import type { Env } from "../env";
import type { ProvisioningParams } from "../workflows/ProvisioningWorkflow";

export interface OrganizationProvisioningStart {
  readonly canonicalHostname: string;
  readonly canonicalStatus: "active" | "pending";
  readonly organizationId: string;
  readonly workflowId: string;
}

export class OrganizationProvisioningError extends Error {
  constructor(readonly phase: "registry" | "workflow") {
    super(`Organization provisioning failed during ${phase}.`);
    this.name = "OrganizationProvisioningError";
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function canonicalDomainStatus(productBaseDomain: string): "active" | "pending" {
  return normalizeHostname(productBaseDomain).endsWith(".workers.dev") ? "pending" : "active";
}

export async function beginOrganizationProvisioning(
  env: Env,
  input: OrganizationProvisionRequest & {
    readonly actorUserId: string;
    readonly requestId: string;
  },
  now = new Date(),
): Promise<OrganizationProvisioningStart> {
  const organizationId = crypto.randomUUID();
  const domainId = crypto.randomUUID();
  const workflowId = `organization-provision-${organizationId}`;
  const productBaseDomain = normalizeHostname(env.PRODUCT_BASE_DOMAIN);
  const canonicalHostname = `${input.slug}.${productBaseDomain}`;
  const canonicalStatus = canonicalDomainStatus(productBaseDomain);
  const occurredAt = now.toISOString();

  try {
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        `INSERT INTO organizations
        (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
         created_at, updated_at, provisioning_workflow_id)
       VALUES (?, ?, ?, 'provisioning', ?, 0, ?, ?, ?)`,
      ).bind(
        organizationId,
        input.name,
        input.slug,
        organizationId,
        occurredAt,
        occurredAt,
        workflowId,
      ),
      env.CONTROL_DB.prepare(
        `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES (?, ?, ?, 'canonical', ?, 1, ?, ?)`,
      ).bind(domainId, organizationId, canonicalHostname, canonicalStatus, occurredAt, occurredAt),
      env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, 'organization.provisioning.requested', 'organization', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.actorUserId,
        organizationId,
        organizationId,
        input.requestId,
        JSON.stringify({ canonicalHostname, canonicalStatus, name: input.name, slug: input.slug }),
        occurredAt,
      ),
    ]);
  } catch {
    throw new OrganizationProvisioningError("registry");
  }

  const params: ProvisioningParams = {
    actorUserId: input.actorUserId,
    canonicalHostname,
    canonicalStatus,
    name: input.name,
    organizationId,
    requestId: input.requestId,
    slug: input.slug,
  };
  try {
    await env.PROVISIONING_WORKFLOW.create({ id: workflowId, params });
  } catch {
    await env.CONTROL_DB.prepare(
      `INSERT OR IGNORE INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, 'organization.provisioning.dispatch_failed', 'organization', ?, ?, ?, ?)`,
    )
      .bind(
        `organization-provisioning-dispatch-failed:${input.requestId}`,
        input.actorUserId,
        organizationId,
        organizationId,
        input.requestId,
        JSON.stringify({ workflowId }),
        new Date().toISOString(),
      )
      .run();
    throw new OrganizationProvisioningError("workflow");
  }

  return { canonicalHostname, canonicalStatus, organizationId, workflowId };
}
