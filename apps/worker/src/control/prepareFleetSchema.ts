import type { Env } from "../env";
import { currentOrganizationSchemaVersion } from "../organization/schema";
import type { FleetSchemaParams } from "../workflows/FleetSchemaWorkflow";

export class FleetSchemaPreparationError extends Error {
  constructor(readonly phase: "registry" | "workflow") {
    super(`Fleet schema preparation failed during ${phase}.`);
    this.name = "FleetSchemaPreparationError";
  }
}

export interface FleetSchemaPreparationStart {
  readonly runId: string;
  readonly startedAt: string;
  readonly targetVersion: number;
  readonly workflowId: string;
}

type FleetSchemaPreparationEnv = Pick<Env, "CONTROL_DB" | "FLEET_SCHEMA_WORKFLOW">;

export async function beginFleetSchemaPreparation(
  env: FleetSchemaPreparationEnv,
  input: { readonly actorUserId: string; readonly requestId: string },
  now = new Date(),
): Promise<FleetSchemaPreparationStart> {
  const runId = crypto.randomUUID();
  const workflowId = `fleet-schema-${runId}-0`;
  const startedAt = now.toISOString();
  try {
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        `INSERT INTO fleet_schema_preparations
          (id, target_version, status, processed_count, initiated_by,
           request_id, started_at, updated_at)
         VALUES (?, ?, 'running', 0, ?, ?, ?, ?)`,
      ).bind(
        runId,
        currentOrganizationSchemaVersion,
        input.actorUserId,
        input.requestId,
        startedAt,
        startedAt,
      ),
      env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, ?, NULL, 'fleet_schema.preparation.requested',
           'fleet_schema_preparation', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.actorUserId,
        runId,
        input.requestId,
        JSON.stringify({ targetVersion: currentOrganizationSchemaVersion, workflowId }),
        startedAt,
      ),
    ]);
  } catch {
    throw new FleetSchemaPreparationError("registry");
  }

  const params: FleetSchemaParams = {
    cursorOrganizationId: null,
    requestId: input.requestId,
    runId,
    segment: 0,
    targetVersion: currentOrganizationSchemaVersion,
  };
  try {
    await env.FLEET_SCHEMA_WORKFLOW.create({ id: workflowId, params });
  } catch {
    const failedAt = new Date().toISOString();
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        `UPDATE fleet_schema_preparations
         SET status = 'failed', failure_code = 'workflow_dispatch_failed',
             updated_at = ?, completed_at = ?
         WHERE id = ? AND status = 'running'`,
      ).bind(failedAt, failedAt, runId),
      env.CONTROL_DB.prepare(
        `INSERT OR IGNORE INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, ?, NULL, 'fleet_schema.preparation.dispatch_failed',
           'fleet_schema_preparation', ?, ?, ?, ?)`,
      ).bind(
        `fleet-schema-dispatch-failed:${input.requestId}`,
        input.actorUserId,
        runId,
        input.requestId,
        JSON.stringify({ workflowId }),
        failedAt,
      ),
    ]);
    throw new FleetSchemaPreparationError("workflow");
  }

  return { runId, startedAt, targetVersion: currentOrganizationSchemaVersion, workflowId };
}
