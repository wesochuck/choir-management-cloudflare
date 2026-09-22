import type { D1Database } from "@cloudflare/workers-types";

export interface StripeAccountOrganization {
  readonly accountId: string;
  readonly organizationId: string;
  readonly status: "active" | "disabled" | "pending";
}

export async function upsertStripeAccountOrganization(
  db: D1Database,
  input: {
    readonly accountId: string;
    readonly organizationId: string;
    readonly status: "active" | "disabled" | "pending";
    readonly now?: string;
  },
): Promise<void> {
  const now = input.now ?? new Date().toISOString();
  const existing = await db
    .prepare(
      `SELECT organization_id AS organizationId
       FROM stripe_connected_accounts WHERE account_id = ? LIMIT 1`,
    )
    .bind(input.accountId)
    .first<{ readonly organizationId: string }>();
  if (existing && existing.organizationId !== input.organizationId) {
    throw new Error("stripe_account_organization_conflict");
  }
  await db
    .prepare(
      `INSERT INTO stripe_connected_accounts
        (account_id, organization_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`,
    )
    .bind(input.accountId, input.organizationId, input.status, now, now)
    .run();
}

export async function resolveOrganizationForStripeAccount(
  db: D1Database,
  accountId: string,
): Promise<StripeAccountOrganization | null> {
  const rows = await db
    .prepare(
      `SELECT account_id AS accountId, organization_id AS organizationId, status
       FROM stripe_connected_accounts WHERE account_id = ? LIMIT 2`,
    )
    .bind(accountId)
    .all<StripeAccountOrganization>();
  if (rows.results.length !== 1) return null;
  const row = rows.results[0];
  if (!row || !["active", "disabled", "pending"].includes(row.status)) return null;
  return row;
}

export async function removeStripeAccountOrganization(
  db: D1Database,
  input: {
    readonly accountId: string;
    readonly organizationId: string;
  },
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM stripe_connected_accounts WHERE account_id = ? AND organization_id = ?`)
    .bind(input.accountId, input.organizationId)
    .run();
  return result.meta.changes > 0;
}
