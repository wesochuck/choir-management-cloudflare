import { suppressCommunicationBatch } from "./suppression";
import { z } from "zod";
import { identityMatches } from "./shared";
import { wakeOrganizationAlarm } from "../scheduler";

export const communicationBatchInputSchema = z.object({
  organizationId: z.string().min(1).max(128),
  jobId: z.uuid(),
});

export type CommunicationBatchInput = z.infer<typeof communicationBatchInputSchema>;

/** A durable, idempotent handoff after one bounded provider batch has finished. */
export async function finishCommunicationBatch(
  storage: DurableObjectStorage,
  input: CommunicationBatchInput,
): Promise<{ readonly scheduled: boolean }> {
  const parsed = communicationBatchInputSchema.parse(input);
  if (!identityMatches(storage, parsed.organizationId)) throw new Error("organization_not_found");
  const scheduled = storage.transactionSync(() => {
    const job = storage.sql
      .exec<{ readonly idempotencyKey: string }>(
        "SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox WHERE job_id = ? AND kind = 'communication_delivery' LIMIT 1",
        parsed.jobId,
      )
      .toArray()
      .at(0);
    const messageId = job?.idempotencyKey.split(":")[1];
    if (!messageId) throw new Error("communication_job_not_found");
    const unfinished =
      storage.sql
        .exec<{ readonly id: string }>(
          "SELECT id FROM communication_deliveries WHERE message_id = ? AND delivery_job_id = ? AND status IN ('queued', 'processing') LIMIT 1",
          messageId,
          parsed.jobId,
        )
        .toArray().length > 0;
    if (unfinished) throw new Error("communication_batch_unfinished");
    const pending =
      storage.sql
        .exec<{ readonly id: string }>(
          `SELECT d.id FROM communication_deliveries d
       WHERE d.message_id = ? AND d.delivery_job_id IS NULL AND d.status IN ('queued', 'processing')
         AND EXISTS (SELECT 1 FROM communication_messages m WHERE m.id = d.message_id AND m.canceled_at IS NULL)
       LIMIT 1`,
          messageId,
        )
        .toArray().length > 0;
    if (!pending) {
      storage.sql.exec(
        `UPDATE communication_messages SET
           status = CASE WHEN EXISTS (SELECT 1 FROM communication_deliveries WHERE message_id = ? AND status IN ('sent', 'suppressed')) THEN 'Sent' ELSE 'Failed' END,
           sent_at = ?, updated_at = ?
         WHERE id = ? AND status = 'Queued' AND canceled_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM communication_deliveries WHERE message_id = ? AND status IN ('queued', 'processing'))`,
        messageId,
        new Date().toISOString(),
        new Date().toISOString(),
        messageId,
        messageId,
      );
      return false;
    }
    const now = new Date().toISOString();
    const inserted = storage.sql.exec(
      `INSERT OR IGNORE INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'communication_delivery', ?, ?, ?)`,
      crypto.randomUUID(),
      `communication:${messageId}:after:${parsed.jobId}`,
      now,
      now,
    );
    return inserted.rowsWritten > 0;
  });
  // Replays also repair a failed alarm wake after the continuation was committed.
  await wakeOrganizationAlarm(storage);
  return { scheduled };
}

export interface CommunicationDeliveryCheckInput extends CommunicationBatchInput {
  readonly deliveryId: string;
}

export function checkCommunicationDelivery(
  storage: DurableObjectStorage,
  input: CommunicationDeliveryCheckInput,
): boolean {
  const parsed = communicationBatchInputSchema.extend({ deliveryId: z.uuid() }).parse(input);
  if (!identityMatches(storage, parsed.organizationId)) throw new Error("organization_not_found");
  return storage.transactionSync(() => {
    const row = storage.sql
      .exec<{ messageId: string; ticketServiceNotice: number }>(
        `SELECT d.message_id AS messageId,
        CASE WHEN json_extract(m.audience_json, '$.ticketBuyerMode') = 'ticket_service' THEN 1 ELSE 0 END AS ticketServiceNotice
       FROM communication_deliveries d JOIN communication_messages m ON m.id = d.message_id
       WHERE d.id = ? AND d.delivery_job_id = ? AND d.status = 'processing' AND m.canceled_at IS NULL`,
        parsed.deliveryId,
        parsed.jobId,
      )
      .toArray()
      .at(0);
    if (!row) return false;
    suppressCommunicationBatch(
      storage,
      row.messageId,
      parsed.jobId,
      row.ticketServiceNotice === 1,
      parsed.deliveryId,
    );
    return (
      storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM communication_deliveries WHERE id = ?",
          parsed.deliveryId,
        )
        .one().status === "processing"
    );
  });
}
