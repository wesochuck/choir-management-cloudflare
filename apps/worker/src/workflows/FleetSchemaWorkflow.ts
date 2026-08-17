import { organizationIdSchema } from "@choir/contracts";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { z } from "zod";

import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { currentOrganizationSchemaVersion } from "../organization/schema";

const FLEET_SCHEMA_BATCH_SIZE = 20;

export const fleetSchemaParamsSchema = z.object({
  cursorOrganizationId: organizationIdSchema.nullable(),
  requestId: z.uuid(),
  runId: z.uuid(),
  segment: z.number().int().nonnegative(),
  targetVersion: z.number().int().positive(),
});

export type FleetSchemaParams = z.infer<typeof fleetSchemaParamsSchema>;

const organizationBatchSchema = z.array(
  z.object({
    organizationId: organizationIdSchema,
  }),
);

const preparationResponseSchema = z.object({
  organizationId: organizationIdSchema,
  schemaVersion: z.number().int().positive(),
});

const completedRunSchema = z.object({
  status: z.literal("completed"),
  targetVersion: z.number().int().positive(),
});

class OrganizationRegistryIdentityError extends Error {
  constructor() {
    super("An Organization store rejected its registry identity.");
    this.name = "OrganizationRegistryIdentityError";
  }
}

function continuationId(runId: string, segment: number): string {
  return `fleet-schema-${runId}-${String(segment)}`;
}

export class FleetSchemaWorkflow extends WorkflowEntrypoint<Env, FleetSchemaParams> {
  override async run(event: WorkflowEvent<FleetSchemaParams>, step: WorkflowStep): Promise<void> {
    const params = fleetSchemaParamsSchema.parse(event.payload);
    try {
      await this.prepareSegment(params, step);
    } catch (error: unknown) {
      await step.do("mark schema preparation failed", async () => {
        const failedAt = new Date().toISOString();
        await this.env.CONTROL_DB.prepare(
          `UPDATE fleet_schema_preparations
           SET status = 'failed', failure_code = 'workflow_segment_failed',
               updated_at = ?, completed_at = ?
           WHERE id = ? AND status = 'running'`,
        )
          .bind(failedAt, failedAt, params.runId)
          .run();
        return { failed: true };
      });
      if (error instanceof OrganizationRegistryIdentityError) return;
      throw error;
    }
  }

  private async prepareSegment(params: FleetSchemaParams, step: WorkflowStep): Promise<void> {
    if (params.targetVersion > currentOrganizationSchemaVersion) {
      throw new Error("The requested Organization schema version is not deployed.");
    }

    const organizations = await step.do("load bounded Organization batch", async () => {
      const statement = params.cursorOrganizationId
        ? this.env.CONTROL_DB.prepare(
            `SELECT id AS organizationId
             FROM organizations
             WHERE lifecycle_state = 'active' AND operational_schema_version < ? AND id > ?
             ORDER BY id ASC LIMIT ?`,
          ).bind(params.targetVersion, params.cursorOrganizationId, FLEET_SCHEMA_BATCH_SIZE)
        : this.env.CONTROL_DB.prepare(
            `SELECT id AS organizationId
             FROM organizations
             WHERE lifecycle_state = 'active' AND operational_schema_version < ?
             ORDER BY id ASC LIMIT ?`,
          ).bind(params.targetVersion, FLEET_SCHEMA_BATCH_SIZE);
      return organizationBatchSchema.parse((await statement.all()).results);
    });

    const preparation = await step.do("prepare bounded Organization batch", async () => {
      const results = await Promise.all(
        organizations.map(async (organization) => {
          const response = await invokeOrganizationRpc(
            organizationStoreStub(this.env, organization.organizationId),
            "https://organization.internal/internal/schema/prepare",
            {
              body: JSON.stringify({
                organizationId: organization.organizationId,
                targetVersion: params.targetVersion,
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            },
          );
          if (response.status === 400 || response.status === 404 || response.status === 409) {
            return {
              identityFailure: organization.organizationId,
              organizationId: organization.organizationId,
              prepared: false,
            };
          }
          const result = preparationResponseSchema.safeParse(await response.json());
          if (
            !response.ok ||
            !result.success ||
            result.data.organizationId !== organization.organizationId ||
            result.data.schemaVersion < params.targetVersion
          ) {
            throw new Error("An Organization store did not confirm its schema preparation.");
          }
          return {
            identityFailure: null,
            organizationId: organization.organizationId,
            prepared: true,
          };
        }),
      );
      const identityFailure =
        results.find((result) => result.identityFailure)?.identityFailure ?? null;
      return {
        identityFailure,
        preparedOrganizations: identityFailure
          ? []
          : results.filter((result) => result.prepared).map((result) => result.organizationId),
      };
    });
    if (preparation.identityFailure) {
      throw new OrganizationRegistryIdentityError();
    }
    const prepared = preparation.preparedOrganizations;

    await step.do("record progress and continue", async () => {
      const updatedAt = new Date().toISOString();
      const lastOrganizationId = prepared.at(-1) ?? params.cursorOrganizationId;
      if (prepared.length > 0) {
        await this.env.CONTROL_DB.batch(
          prepared.map((organizationId) =>
            this.env.CONTROL_DB.prepare(
              `UPDATE organizations
               SET operational_schema_version = ?, updated_at = ?
               WHERE id = ? AND lifecycle_state = 'active'
                 AND operational_schema_version < ?`,
            ).bind(params.targetVersion, updatedAt, organizationId, params.targetVersion),
          ),
        );
      }

      if (prepared.length === FLEET_SCHEMA_BATCH_SIZE && lastOrganizationId) {
        const nextSegment = params.segment + 1;
        await this.env.CONTROL_DB.prepare(
          `UPDATE fleet_schema_preparations
           SET processed_count = processed_count + ?, cursor_organization_id = ?, updated_at = ?
           WHERE id = ? AND status = 'running'
             AND (cursor_organization_id IS NULL OR cursor_organization_id < ?)`,
        )
          .bind(prepared.length, lastOrganizationId, updatedAt, params.runId, lastOrganizationId)
          .run();
        await this.env.FLEET_SCHEMA_WORKFLOW.createBatch([
          {
            id: continuationId(params.runId, nextSegment),
            params: {
              ...params,
              cursorOrganizationId: lastOrganizationId,
              segment: nextSegment,
            },
          },
        ]);
        return { continued: true, prepared: prepared.length };
      }

      const completed = await this.env.CONTROL_DB.prepare(
        `UPDATE fleet_schema_preparations
         SET status = 'completed', processed_count = processed_count + ?,
             cursor_organization_id = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND status = 'running'`,
      )
        .bind(prepared.length, lastOrganizationId, updatedAt, updatedAt, params.runId)
        .run();
      if (completed.meta.changes !== 1) {
        const existing = completedRunSchema.safeParse(
          await this.env.CONTROL_DB.prepare(
            `SELECT status, target_version AS targetVersion
             FROM fleet_schema_preparations WHERE id = ?`,
          )
            .bind(params.runId)
            .first(),
        );
        if (!existing.success || existing.data.targetVersion !== params.targetVersion) {
          throw new Error("The fleet schema-preparation run could not be completed.");
        }
      }
      await this.env.CONTROL_DB.prepare(
        `INSERT OR IGNORE INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         SELECT ?, initiated_by, NULL, 'fleet_schema.preparation.completed',
           'fleet_schema_preparation', id, request_id, ?, ?
         FROM fleet_schema_preparations WHERE id = ? AND status = 'completed'`,
      )
        .bind(
          `fleet-schema-completed:${params.runId}`,
          JSON.stringify({ targetVersion: params.targetVersion }),
          updatedAt,
          params.runId,
        )
        .run();
      return { continued: false, prepared: prepared.length };
    });
  }
}
