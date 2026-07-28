import type { DurableObjectStorage } from "@cloudflare/workers-types";
import { transactionFeeSettingsSchema, type TransactionFeeSettings } from "@choir/contracts";

export const defaultTransactionFeeSettings: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: false,
  percentage: 2.9,
};

export function transactionFeeSettingsFromStore(
  storage: DurableObjectStorage,
): TransactionFeeSettings {
  try {
    const raw = storage.sql
      .exec<{ readonly settings: string }>(
        "SELECT transaction_fee_settings_json AS settings FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.settings;
    if (raw) {
      const parsed = transactionFeeSettingsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Keep existing Organizations usable while the setting is unavailable.
  }
  return defaultTransactionFeeSettings;
}

export function readTransactionFeeSettingsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (!organizationId || identity?.organizationId !== organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  return Response.json(transactionFeeSettingsFromStore(storage));
}

export function updateTransactionFeeSettingsInStore(
  storage: DurableObjectStorage,
  organizationId: string,
  settings: TransactionFeeSettings,
  actor: { readonly actorUserId: string; readonly requestId: string },
): Response {
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (identity?.organizationId !== organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET transaction_fee_settings_json = ?, updated_at = ?",
      JSON.stringify(settings),
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'transaction_fee.settings_updated',
         'organization', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      actor.actorUserId,
      organizationId,
      actor.requestId,
      JSON.stringify(settings),
      occurredAt,
    );
  });
  return Response.json(settings);
}
