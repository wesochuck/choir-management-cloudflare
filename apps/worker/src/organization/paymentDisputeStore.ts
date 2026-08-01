import { z } from "zod";

const operationSchema = z.object({
  action: z.literal("record_payment_dispute"),
  amountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  disputeStatus: z.string().min(1).max(80),
  organizationId: z.string().min(1).max(128),
  paymentType: z.enum(["ticket", "bundle", "donation", "dues", "unknown"]),
  providerPaymentId: z.string().min(1).max(256),
  providerSessionId: z.string().min(1).max(256),
  reason: z.string().trim().min(1).max(256),
  stripeEventId: z.string().min(1).max(256),
});

function identity(storage: DurableObjectStorage): string | null {
  return (
    storage.sql
      .exec<{ readonly organizationId: string }>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId ?? null
  );
}

export function recordPaymentDisputeInStore(
  storage: DurableObjectStorage,
  operationInput: unknown,
): Response {
  const operation = operationSchema.safeParse(operationInput);
  if (!operation.success)
    return Response.json({ code: "invalid_payment_dispute" }, { status: 400 });
  const parsedOperation = operation.data;
  if (identity(storage) !== parsedOperation.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const auditId = `stripe-dispute:${parsedOperation.stripeEventId}`;
  if (
    storage.sql.exec("SELECT id FROM audit_events WHERE id = ? LIMIT 1", auditId).toArray().length
  ) {
    return Response.json({ recorded: true, duplicate: true });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO payment_disputes
        (id, provider_dispute_id, provider_payment_id, payment_type,
         status, reason, amount_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_dispute_id) DO UPDATE SET
         status = excluded.status,
         reason = excluded.reason,
         amount_cents = excluded.amount_cents,
         updated_at = excluded.updated_at`,
      crypto.randomUUID(),
      parsedOperation.providerSessionId,
      parsedOperation.providerPaymentId,
      parsedOperation.paymentType,
      parsedOperation.disputeStatus,
      parsedOperation.reason,
      parsedOperation.amountCents,
      occurredAt,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'payment.dispute.recorded',
        'payment_dispute', ?, ?, ?, ?)`,
      auditId,
      parsedOperation.providerSessionId,
      parsedOperation.stripeEventId,
      JSON.stringify({
        amountCents: parsedOperation.amountCents,
        paymentType: parsedOperation.paymentType,
        providerPaymentId: parsedOperation.providerPaymentId,
        reason: parsedOperation.reason,
        status: parsedOperation.disputeStatus,
      }),
      occurredAt,
    );
  });
  return Response.json({ recorded: true });
}
