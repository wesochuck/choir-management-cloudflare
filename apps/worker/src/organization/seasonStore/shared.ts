import type { duesCheckoutRequestSchema } from "@choir/contracts";
import type { z } from "zod";

import { PENDING_DUES_EXPIRY_MS, duesSelect, seasonSelect } from "./contracts";
import type { DuesRow, SeasonRow } from "./contracts";

export function duesByStripeOperation(
  storage: DurableObjectStorage,
  providerSessionId: string,
  checkoutRequestId?: string,
): DuesRow[] {
  return storage.sql
    .exec<DuesRow>(
      `${duesSelect}
       WHERE d.provider_session_id = ?
          OR (
            ? IS NOT NULL AND EXISTS (
              SELECT 1 FROM payment_attempts pa
              WHERE pa.payment_type = 'dues'
                AND pa.checkout_request_id = ?
                AND (
                  pa.provider_session_id = d.provider_session_id
                  OR pa.resource_id = d.id
                )
            )
          )
       ORDER BY d.id`,
      providerSessionId,
      checkoutRequestId ?? null,
      checkoutRequestId ?? null,
    )
    .toArray();
}

export interface DuesPaymentAttemptRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly providerSessionId: string;
  readonly status: "expired" | "paid" | "pending" | "refunded";
}

export function paymentAttemptByCheckoutRequest(
  storage: DurableObjectStorage,
  checkoutRequestId: string,
): DuesPaymentAttemptRow | undefined {
  return storage.sql
    .exec<DuesPaymentAttemptRow>(
      `SELECT amount_cents AS amountCents, provider_session_id AS providerSessionId, status
       FROM payment_attempts
       WHERE payment_type = 'dues' AND checkout_request_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      checkoutRequestId,
    )
    .toArray()
    .at(0);
}

export function duesForCheckoutRequest(
  storage: DurableObjectStorage,
  checkoutRequestId: string,
  providerSessionId: string,
): DuesRow[] {
  return duesByStripeOperation(storage, providerSessionId, checkoutRequestId);
}

export function sameDuesCheckout(
  rows: readonly DuesRow[],
  checkout: z.infer<typeof duesCheckoutRequestSchema>,
  recipientEmail: string | undefined,
  amountCents: number,
  feeCents: number,
): boolean {
  if (rows.length !== checkout.profileIds.length) return false;
  const expectedProfiles = new Set(checkout.profileIds);
  return (
    new Set(rows.map((row) => row.profileId)).size === expectedProfiles.size &&
    rows.every(
      (row) =>
        row.seasonId === checkout.seasonId &&
        expectedProfiles.has(row.profileId) &&
        row.amountCents === amountCents &&
        row.feeCents === feeCents &&
        row.payerEmail === (recipientEmail ?? "").toLowerCase(),
    )
  );
}

export function identity(
  storage: DurableObjectStorage,
): { readonly organizationId: string } | undefined {
  return storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
}

export function releaseStalePendingDuesAttempt(
  storage: DurableObjectStorage,
  duesId: string,
): boolean {
  const pendingAttempt = storage.sql
    .exec<{ readonly createdAt: string; readonly id: string }>(
      `SELECT id, created_at AS createdAt FROM payment_attempts
       WHERE payment_type = 'dues' AND resource_id = ? AND status = 'pending'
       LIMIT 1`,
      duesId,
    )
    .toArray()
    .at(0);
  if (!pendingAttempt) return true;
  const createdAt = new Date(pendingAttempt.createdAt).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt < PENDING_DUES_EXPIRY_MS) {
    return false;
  }
  const expiredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT OR IGNORE INTO dues_expirations (dues_id, stripe_event_id, expired_at)
       VALUES (?, ?, ?)`,
      duesId,
      `stale-cash-release:${duesId}`,
      expiredAt,
    );
    storage.sql.exec(
      `UPDATE payment_attempts
       SET status = 'expired', expired_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      expiredAt,
      expiredAt,
      pendingAttempt.id,
    );
  });
  return true;
}

export function seasonResult(row: SeasonRow) {
  return {
    createdAt: row.createdAt,
    duesAmountCents: row.duesAmountCents,
    endsAt: row.endsAt,
    id: row.id,
    isActive: row.isActive === 1,
    name: row.name,
    startsAt: row.startsAt,
    updatedAt: row.updatedAt,
  };
}

export function seasonById(storage: DurableObjectStorage, seasonId: string): SeasonRow | undefined {
  return storage.sql
    .exec<SeasonRow>(`${seasonSelect} WHERE s.id = ? LIMIT 1`, seasonId)
    .toArray()
    .at(0);
}
