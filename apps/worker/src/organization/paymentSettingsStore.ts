import {
  paymentActivationRequestSchema,
  paymentActivationSettingsSchema,
  paymentModuleIdSchema,
} from "@choir/contracts";
import { z } from "zod";

const identitySchema = z.object({
  organizationId: z.string().min(1).max(128),
  organizationName: z.string().min(1).max(120),
  paymentActivationJson: z.string(),
});

const manageOperationSchema = paymentActivationRequestSchema.extend({
  action: z.literal("update_payment_activation"),
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const defaultActivations = {
  donations: false,
  dues: false,
  tickets: false,
} as const;

function identity(storage: DurableObjectStorage) {
  return storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly organizationId: string;
      readonly organizationName: string;
      readonly paymentActivationJson: string;
    }>(
      `SELECT organization_id AS organizationId, name AS organizationName,
        payment_activation_json AS paymentActivationJson
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .map((row) => identitySchema.parse(row))
    .at(0);
}

export function parseActivations(raw: string): z.infer<typeof paymentActivationSettingsSchema> {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    value = defaultActivations;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return defaultActivations;
  }
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  return paymentActivationSettingsSchema.parse({
    donations: record.donations === true,
    dues: record.dues === true,
    tickets: record.tickets === true,
  });
}

export function readPaymentSettingsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const organization = identity(storage);
  if (organization?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    activations: parseActivations(organization.paymentActivationJson),
    organizationId: organization.organizationId,
    organizationName: organization.organizationName,
  });
}

export function updatePaymentActivationInStore(
  storage: DurableObjectStorage,
  operationInput: unknown,
): Response {
  const operation = manageOperationSchema.safeParse(operationInput);
  if (!operation.success) {
    return Response.json({ code: "invalid_payment_activation" }, { status: 400 });
  }
  const organization = identity(storage);
  if (organization?.organizationId !== operation.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const current = parseActivations(organization.paymentActivationJson);
  const next = paymentActivationSettingsSchema.parse({
    ...current,
    [paymentModuleIdSchema.parse(operation.data.moduleId)]: operation.data.enabled,
  });
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE organization_metadata
       SET payment_activation_json = ?, updated_at = ?
       WHERE organization_id = ?`,
      JSON.stringify(next),
      occurredAt,
      operation.data.organizationId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'payment.activation.updated',
        'payment_module', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.data.actorUserId,
      operation.data.moduleId,
      operation.data.requestId,
      JSON.stringify({ enabled: operation.data.enabled, moduleId: operation.data.moduleId }),
      occurredAt,
    );
  });
  return Response.json({ activations: next, organizationName: organization.organizationName });
}
