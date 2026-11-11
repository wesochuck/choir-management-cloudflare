import type { SqlStorageValue } from "@cloudflare/workers-types";
import { z } from "zod";
import { ticketNotificationDetailsSchema, ticketNotificationCancelSchema } from "@choir/contracts";

interface NotificationStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: unknown[]
    ): { toArray(): T[] };
  };
}

const scopeSchema = z.object({
  organizationId: z.string().min(1).max(128),
  notificationId: z.uuid(),
});
type Scope = z.infer<typeof scopeSchema>;

export function readTicketNotificationDetails(storage: NotificationStorage, input: Scope) {
  const scope = scopeSchema.parse(input);
  const identity = storage.sql
    .exec<{ organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (identity?.organizationId !== scope.organizationId) return null;
  const row = storage.sql
    .exec<{
      id: string;
      purchaseId: string;
      buyerName: string;
      recipientEmail: string;
      purchaseStatus: string;
      refundedAt: string | null;
      status: string;
      kind: string;
      scheduledAt: string;
      updatedAt: string;
      failureDetail: string;
      providerStatus: string | null;
      providerMessageId: string | null;
      jobStatus: string | null;
      jobAttempts: number | null;
      claimedAt: string | null;
    }>(
      `SELECT n.id,n.purchase_id AS purchaseId,p.buyer_name AS buyerName,
    n.destination AS recipientEmail,p.status AS purchaseStatus,p.refunded_at AS refundedAt,
    n.status,n.kind,n.scheduled_for AS scheduledAt,n.updated_at AS updatedAt,
    n.failure_detail AS failureDetail,n.provider_status AS providerStatus,
    n.provider_message_id AS providerMessageId,l.status AS jobStatus,
    l.attempt AS jobAttempts,l.claimed_at AS claimedAt
    FROM ticket_notifications n JOIN ticket_purchases p ON p.id=n.purchase_id
    LEFT JOIN job_ledger l ON l.idempotency_key=('ticket-notification:' || n.id)
    WHERE n.id=? LIMIT 1`,
      scope.notificationId,
    )
    .toArray()
    .at(0);
  if (!row) return null;
  const activeClaim =
    row.jobStatus === "claimed" &&
    row.claimedAt !== null &&
    Date.parse(row.claimedAt) > Date.now() - 15 * 60_000;
  return ticketNotificationDetailsSchema.parse({
    ...row,
    canCancel:
      !activeClaim &&
      row.providerMessageId === null &&
      ["queued", "processing", "failed"].includes(row.status),
  });
}

export function cancelTicketNotification(
  storage: NotificationStorage,
  input: Scope & {
    actorUserId: string;
    requestId: string;
    reason: string;
  },
) {
  const parsed = scopeSchema
    .extend({
      ...ticketNotificationCancelSchema.shape,
      actorUserId: z.string().min(1).max(128),
      requestId: z.uuid(),
    })
    .parse(input);
  const details = readTicketNotificationDetails(storage, input);
  if (!details) return { status: "not_found" as const };
  if (details.status === "suppressed") return { status: "canceled" as const };
  if (!details.canCancel) return { status: "conflict" as const };
  const now = new Date().toISOString();
  storage.sql.exec(
    `UPDATE ticket_notifications SET status='suppressed',failure_detail=?,updated_at=?
    WHERE id=? AND status IN ('queued','processing','failed')`,
    parsed.reason,
    now,
    input.notificationId,
  );
  storage.sql.exec(
    `INSERT INTO audit_events
    (id,actor_type,actor_id,action,target_type,target_id,request_id,change_summary,occurred_at)
    VALUES (?,'organization_member',?,'ticket.notification.canceled','ticket_notification',?,?,?,?)`,
    crypto.randomUUID(),
    input.actorUserId,
    input.notificationId,
    input.requestId,
    JSON.stringify({
      reason: parsed.reason,
      previousStatus: details.status,
      purchaseId: details.purchaseId,
    }),
    now,
  );
  return { status: "canceled" as const };
}

/** Called inside the refund transaction, using the purchase partition index. */
export function suppressRefundedTicketNotifications(
  storage: NotificationStorage,
  purchaseId: string,
  now: string,
) {
  storage.sql.exec(
    `UPDATE ticket_notifications SET status='suppressed',
    failure_detail='Order refunded before delivery',updated_at=?
    WHERE purchase_id=? AND kind IN ('confirmation','reminder')
      AND status IN ('queued','processing','failed')`,
    now,
    purchaseId,
  );
}

/** The failed job's key addresses exactly one notification; retries can reopen failed records. */
export function failTicketNotification(storage: NotificationStorage, key: string, now: string) {
  if (!key.startsWith("ticket-notification:")) return;
  storage.sql.exec(
    `UPDATE ticket_notifications SET status='failed',
    failure_detail='Delivery job failed. Review delivery details before retrying.',updated_at=?
    WHERE id=? AND status IN ('queued','processing')`,
    now,
    key.slice("ticket-notification:".length),
  );
}
