import type { StatusAutomationActor } from "./types";

export function insertAudit(
  storage: DurableObjectStorage,
  actor: StatusAutomationActor,
  action: string,
  targetType: string,
  targetId: string,
  changeSummary: Readonly<Record<string, unknown>>,
  occurredAt: string,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    actor.actorType,
    actor.actorId,
    action,
    targetType,
    targetId,
    actor.requestId,
    JSON.stringify(changeSummary),
    occurredAt,
  );
}
