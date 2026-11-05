import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { organizationProfileRequestSchema } from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import { createOrganizationProfile } from "../organization/profiles";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { currentOrganizationSchemaVersion } from "../organization/schema";
import { reconcileCanonicalHostnameFirewall } from "../security/canonicalHostnameFirewall";

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
      const response = await invokeOrganizationRpc(
        organizationStoreStub(this.env, params.organizationId),
        "https://organization.internal/internal/provision",
        {
          body: JSON.stringify(params),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
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

    await step.do("provision owner profile", async () => {
      const membership = await this.env.CONTROL_DB.prepare(
        `SELECT id, profileId FROM member WHERE organizationId = ? AND userId = ? AND role = 'owner' LIMIT 1`,
      )
        .bind(params.organizationId, params.actorUserId)
        .first<{ id: string; profileId: string | null }>();
      if (!membership || membership.profileId) {
        return { profileId: membership?.profileId ?? null };
      }

      const user = await this.env.CONTROL_DB.prepare(
        `SELECT name, email FROM user WHERE id = ? LIMIT 1`,
      )
        .bind(params.actorUserId)
        .first<{ name: string; email: string }>();
      if (!user) {
        throw new Error("Provisioning owner user record not found");
      }

      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`provisioning:owner-profile:${params.requestId}`),
      );
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      const deterministicProfileId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;

      const checkResponse = await invokeOrganizationRpc(
        organizationStoreStub(this.env, params.organizationId),
        `https://organization.internal/internal/profiles/${encodeURIComponent(deterministicProfileId)}`,
      );
      if (!checkResponse.ok && checkResponse.status !== 404) {
        throw new Error("Failed to verify existing owner profile during provisioning");
      }
      if (checkResponse.status === 404) {
        await createOrganizationProfile(this.env, {
          actorUserId: params.actorUserId,
          email: user.email,
          organizationId: params.organizationId,
          profile: organizationProfileRequestSchema.parse({
            displayName: user.name || "Choir Administrator",
            receiveAdminNotifications: true,
            receiveFinancialAlerts: true,
            receiveRsvpDeclineNotices: true,
          }),
          profileId: deterministicProfileId,
          requestId: params.requestId,
        });
      }

      await this.env.CONTROL_DB.prepare(
        `UPDATE member SET profileId = ? WHERE id = ? AND organizationId = ? AND profileId IS NULL`,
      )
        .bind(deterministicProfileId, membership.id, params.organizationId)
        .run();

      return { profileId: deterministicProfileId };
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

    await step.do("sync canonical hostname firewall", async () => {
      const result = await reconcileCanonicalHostnameFirewall(this.env);
      return {
        action: result.action,
        changed: result.changed,
        desiredHostnameCount: result.desiredHostnameCount,
        mode: result.mode,
      };
    });
  }
}
