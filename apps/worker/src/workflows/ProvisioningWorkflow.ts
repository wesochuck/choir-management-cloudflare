import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { z } from "zod";

import type { Env } from "../env";
import { currentOrganizationSchemaVersion } from "../organization/schema";

const provisioningParamsSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "pending"]),
  name: z.string().min(1).max(120),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
  slug: z.string().min(2).max(63),
});

export type ProvisioningParams = z.infer<typeof provisioningParamsSchema>;

export class ProvisioningWorkflow extends WorkflowEntrypoint<Env, ProvisioningParams> {
  override async run(event: WorkflowEvent<ProvisioningParams>, step: WorkflowStep): Promise<void> {
    const params = provisioningParamsSchema.parse(event.payload);
    await step.do("initialize organization store", async () => {
      const objectId = this.env.ORGANIZATION_STORE.idFromName(params.organizationId);
      const response = await this.env.ORGANIZATION_STORE.get(objectId).fetch(
        new Request("https://organization.internal/internal/provision", {
          body: JSON.stringify(params),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      if (!response.ok) {
        throw new Error("Organization store initialization failed");
      }
      return { initialized: true, schemaVersion: currentOrganizationSchemaVersion };
    });

    await step.do("activate organization registry", async () => {
      const activatedAt = new Date().toISOString();
      const result = await this.env.CONTROL_DB.prepare(
        `UPDATE organizations
         SET lifecycle_state = 'active', operational_schema_version = ?,
             provisioned_at = COALESCE(provisioned_at, ?), updated_at = ?
         WHERE id = ? AND provisioning_workflow_id = ?
           AND lifecycle_state IN ('provisioning', 'active')`,
      )
        .bind(
          currentOrganizationSchemaVersion,
          activatedAt,
          activatedAt,
          params.organizationId,
          event.instanceId,
        )
        .run();
      if (result.meta.changes !== 1) {
        throw new Error("Organization registry activation failed");
      }
      await this.env.CONTROL_DB.batch([
        this.env.CONTROL_DB.prepare(
          `INSERT OR IGNORE INTO platform_audit_events
            (id, actor_user_id, organization_id, action, target_type, target_id,
             request_id, change_summary, occurred_at)
           VALUES (?, ?, ?, 'organization.provisioning.completed', 'organization', ?, ?, ?, ?)`,
        ).bind(
          `organization-provisioned:${params.requestId}`,
          params.actorUserId,
          params.organizationId,
          params.organizationId,
          params.requestId,
          JSON.stringify({
            canonicalHostname: params.canonicalHostname,
            canonicalStatus: params.canonicalStatus,
            operationalSchemaVersion: currentOrganizationSchemaVersion,
          }),
          activatedAt,
        ),
        this.env.CONTROL_DB.prepare(
          `INSERT OR IGNORE INTO member
            (id, organizationId, userId, role, createdAt)
           VALUES (?, ?, ?, 'owner', ?)`,
        ).bind(crypto.randomUUID(), params.organizationId, params.actorUserId, activatedAt),
      ]);
      return { activated: true };
    });

    if (params.canonicalStatus === "active") {
      await step.do("publish canonical route", async () => {
        await this.env.ROUTING_CACHE.put(
          `host:${params.canonicalHostname}`,
          JSON.stringify({
            organizationId: params.organizationId,
            routeKind: "canonical",
            routingVersion: 1,
          }),
          { expirationTtl: 300 },
        );
        return { published: true };
      });
    }
  }
}
