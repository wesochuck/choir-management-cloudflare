import { z } from "zod";

const paymentTypeSchema = z.enum(["ticket", "bundle", "donation", "dues"]);
const refundRequestSchema = z.object({
  action: z.literal("record_provider_refund_requested"),
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  paymentType: paymentTypeSchema,
  requestId: z.uuid(),
  resourceId: z.uuid(),
});

interface PaymentRefundTargetRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly attemptId: string;
  readonly paymentType: string;
  readonly providerPaymentId: string;
  readonly refundRequestedAt: string | null;
  readonly resourceId: string;
  readonly status: string;
}

function paymentAttemptForResource(
  storage: DurableObjectStorage,
  paymentType: string,
  resourceId: string,
): PaymentRefundTargetRow | undefined {
  return storage.sql
    .exec<PaymentRefundTargetRow>(
      `SELECT id AS attemptId, payment_type AS paymentType, resource_id AS resourceId,
        provider_payment_id AS providerPaymentId, amount_cents AS amountCents, status,
        refund_requested_at AS refundRequestedAt
       FROM payment_attempts
       WHERE payment_type = ? AND resource_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      paymentType,
      resourceId,
    )
    .toArray()
    .at(0);
}

function paymentAttemptForDuesMember(
  storage: DurableObjectStorage,
  duesId: string,
): PaymentRefundTargetRow | undefined {
  return storage.sql
    .exec<PaymentRefundTargetRow>(
      `SELECT pa.id AS attemptId, pa.payment_type AS paymentType,
        pa.resource_id AS resourceId, pa.provider_payment_id AS providerPaymentId,
        pa.amount_cents AS amountCents, pa.status,
        pa.refund_requested_at AS refundRequestedAt
       FROM dues d
       JOIN payment_attempts pa
         ON pa.payment_type = 'dues' AND pa.provider_payment_id = d.provider_payment_id
       WHERE d.id = ? AND d.status = 'paid' AND d.payment_method = 'online'
         AND d.provider_payment_id <> '' AND pa.status = 'paid'
       ORDER BY pa.created_at DESC LIMIT 1`,
      duesId,
    )
    .toArray()
    .at(0);
}

function paymentRefundTarget(
  storage: DurableObjectStorage,
  paymentType: string,
  resourceId: string,
): PaymentRefundTargetRow | undefined {
  const direct = paymentAttemptForResource(storage, paymentType, resourceId);
  if (direct || paymentType !== "dues") return direct;
  return paymentAttemptForDuesMember(storage, resourceId);
}

export function readPaymentRefundTargetFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  paymentTypeInput: string | null,
  resourceId: string | null,
): Response {
  const paymentType = paymentTypeSchema.safeParse(paymentTypeInput);
  const resource = z.uuid().safeParse(resourceId);
  const actualOrganizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (actualOrganizationId !== organizationId || !paymentType.success || !resource.success) {
    return Response.json({ code: "payment_refund_target_not_found" }, { status: 404 });
  }
  const target = paymentRefundTarget(storage, paymentType.data, resource.data);
  return target
    ? Response.json({
        amountCents: target.amountCents,
        paymentType: target.paymentType,
        providerPaymentId: target.providerPaymentId,
        refundRequested: target.refundRequestedAt !== null,
        resourceId: target.resourceId,
        status: target.status,
      })
    : Response.json({ code: "payment_refund_target_not_found" }, { status: 404 });
}

export function recordProviderRefundRequestedInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const request = refundRequestSchema.safeParse(input);
  if (!request.success) return Response.json({ code: "invalid_refund_request" }, { status: 400 });
  const organizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (organizationId !== request.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const target = paymentRefundTarget(storage, request.data.paymentType, request.data.resourceId);
  if (!target) return Response.json({ code: "payment_refund_target_not_found" }, { status: 404 });
  if (target.status === "refunded") return Response.json({ requested: true, duplicate: true });
  if (target.status !== "paid")
    return Response.json({ code: "payment_not_refundable" }, { status: 409 });
  if (target.refundRequestedAt) return Response.json({ requested: true, duplicate: true });
  const occurredAt = new Date().toISOString();
  storage.sql.exec(
    `UPDATE payment_attempts
     SET refund_requested_at = ?, updated_at = ?
     WHERE id = ? AND status = 'paid' AND refund_requested_at IS NULL`,
    occurredAt,
    occurredAt,
    target.attemptId,
  );
  const auditId = `payment-refund-request:${request.data.requestId}`;
  storage.sql.exec(
    `INSERT OR IGNORE INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, 'payment.refund.requested',
      'payment', ?, ?, ?, ?)`,
    auditId,
    request.data.actorUserId,
    request.data.resourceId,
    request.data.requestId,
    JSON.stringify({ paymentType: request.data.paymentType, resourceId: request.data.resourceId }),
    occurredAt,
  );
  return Response.json({ requested: true });
}
