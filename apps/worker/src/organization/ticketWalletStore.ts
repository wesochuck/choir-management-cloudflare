import { identityMatches } from "./communicationStore/shared";

interface OrderKey {
  organizationId: string;
  purchaseId: string;
}

export function claimTicketWalletPass(
  storage: DurableObjectStorage,
  { organizationId, purchaseId, eventIds }: OrderKey & { eventIds: string[] },
) {
  const organization = storage.sql
    .exec<{ name: string }>(
      "SELECT name FROM organization_metadata WHERE organization_id = ?",
      organizationId,
    )
    .toArray()[0];
  const paid = storage.sql
    .exec("SELECT 1 FROM ticket_purchases WHERE id = ? AND status = 'paid'", purchaseId)
    .toArray()[0];
  if (!organization || !paid) return { state: "unavailable" } as const;
  const claimed = storage.sql
    .exec(
      `INSERT INTO ticket_wallet_passes (purchase_id) VALUES (?)
     ON CONFLICT (purchase_id) DO UPDATE SET retry_after = NULL
     WHERE share_url IS NULL AND retry_after <= ? RETURNING purchase_id`,
      purchaseId,
      Date.now(),
    )
    .toArray()[0];
  if (!claimed) {
    const pass = storage.sql
      .exec<{ shareUrl: string | null }>(
        "SELECT share_url AS shareUrl FROM ticket_wallet_passes WHERE purchase_id = ?",
        purchaseId,
      )
      .one();
    return pass.shareUrl
      ? ({ state: "ready", shareUrl: pass.shareUrl } as const)
      : ({ state: "unavailable" } as const);
  }
  const ids = [...new Set(eventIds)].slice(0, 100);
  const details = storage.sql
    .exec<{ id: string; details: string }>(
      `SELECT id, substr(public_details,1,2049) AS details FROM events
     WHERE type='Performance' AND id IN (${ids.map(() => "?").join(",")})`,
      ...ids,
    )
    .toArray();
  return { state: "claimed", organizationName: organization.name, details } as const;
}

export function finishTicketWalletPass(
  storage: DurableObjectStorage,
  input: OrderKey & ({ shareUrl: string } | { retryAfter: number }),
) {
  if (!identityMatches(storage, input.organizationId)) throw new Error("Organization mismatch");
  const updated = storage.sql
    .exec(
      `UPDATE ticket_wallet_passes SET share_url = ?, retry_after = ?
       WHERE purchase_id = ? AND share_url IS NULL AND retry_after IS NULL
         AND EXISTS (SELECT 1 FROM ticket_purchases WHERE id = ? AND status = 'paid')
       RETURNING purchase_id`,
      "shareUrl" in input ? input.shareUrl : null,
      "retryAfter" in input ? input.retryAfter : null,
      input.purchaseId,
      input.purchaseId,
    )
    .toArray();
  return updated.length === 1;
}
