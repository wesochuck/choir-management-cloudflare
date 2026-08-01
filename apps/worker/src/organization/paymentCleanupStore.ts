import { z } from "zod";

const requestSchema = z.object({
  organizationId: z.string().min(1).max(128),
  now: z.iso.datetime().optional(),
});

export function expireStalePaymentsInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const request = requestSchema.safeParse(input);
  if (!request.success) return Response.json({ code: "invalid_payment_cleanup" }, { status: 400 });
  const organizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (organizationId !== request.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const now = request.data.now ?? new Date().toISOString();
  const cutoff = new Date(new Date(now).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let expired = 0;
  storage.transactionSync(() => {
    const tickets = storage.sql
      .exec<{ readonly id: string }>(
        `SELECT id FROM ticket_purchases WHERE status = 'pending' AND created_at < ?`,
        cutoff,
      )
      .toArray();
    storage.sql.exec(
      `UPDATE ticket_purchases SET status = 'expired', expired_at = ?, updated_at = ?
       WHERE status = 'pending' AND created_at < ?`,
      now,
      now,
      cutoff,
    );
    for (const ticket of tickets) {
      storage.sql.exec(
        `UPDATE payment_attempts SET status = 'expired', expired_at = ?, updated_at = ?
         WHERE resource_id = ? AND status = 'pending'`,
        now,
        now,
        ticket.id,
      );
    }
    const donations = storage.sql
      .exec<{ readonly id: string }>(
        `SELECT id FROM donations WHERE status = 'pending' AND created_at < ?`,
        cutoff,
      )
      .toArray();
    for (const donation of donations) {
      storage.sql.exec(
        `INSERT OR IGNORE INTO donation_expirations (donation_id, stripe_event_id, expired_at)
         VALUES (?, ?, ?)`,
        donation.id,
        `cleanup:${donation.id}`,
        now,
      );
      storage.sql.exec(
        `UPDATE payment_attempts SET status = 'expired', expired_at = ?, updated_at = ?
         WHERE resource_id = ? AND status = 'pending'`,
        now,
        now,
        donation.id,
      );
    }
    const dues = storage.sql
      .exec<{ readonly id: string }>(
        `SELECT id FROM dues WHERE status = 'pending' AND created_at < ?`,
        cutoff,
      )
      .toArray();
    for (const due of dues) {
      storage.sql.exec(
        `INSERT OR IGNORE INTO dues_expirations (dues_id, stripe_event_id, expired_at)
         VALUES (?, ?, ?)`,
        due.id,
        `cleanup:${due.id}`,
        now,
      );
    }
    storage.sql.exec(
      `UPDATE payment_attempts SET status = 'expired', expired_at = ?, updated_at = ?
       WHERE status = 'pending' AND created_at < ?`,
      now,
      now,
      cutoff,
    );
    expired = tickets.length + donations.length + dues.length;
    if (expired > 0) {
      storage.sql.exec(
        `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'system', 'scheduler', 'payment.pending_expired',
          'payment_cleanup', ?, ?, ?, ?)`,
        `payment-cleanup:${now}`,
        organizationId,
        `payment-cleanup:${now}`,
        JSON.stringify({ cutoff, expired }),
        now,
      );
    }
  });
  return Response.json({ expired });
}
