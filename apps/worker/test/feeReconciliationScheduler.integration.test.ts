import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { applyOrganizationMigration } from "../src/organization/migrations";
import {
  currentOrganizationSchemaVersion,
  organizationSchemaMigrations,
} from "../src/organization/schema";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

async function provisionOrganization(
  organizationId: string,
): Promise<DurableObjectStub<OrganizationStore>> {
  const objectId = organizationStore.idFromName(organizationId);
  const stub = organizationStore.get(objectId);
  const response = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: `${organizationId}.localhost`,
      canonicalStatus: "active",
      name: "Fee Reconciliation Test Organization",
      organizationId,
      requestId: crypto.randomUUID(),
      slug: organizationId,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return stub;
}

afterEach(async () => {
  await reset();
});

describe("Hourly fee reconciliation candidate scan hardening (#67)", () => {
  it("proves new organizations start at the updated schema version 94", async () => {
    const stub = await provisionOrganization("org-fee-schema-version");
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const version = state.storage.sql
        .exec<{ version: number }>(
          "SELECT version FROM organization_schema_migrations ORDER BY version DESC LIMIT 1",
        )
        .one().version;
      expect(version).toBe(currentOrganizationSchemaVersion);
      expect(version).toBe(94);
    });
  });

  it("applies migration 94 forward to an existing organization at version 93", async () => {
    const stub = await provisionOrganization("org-fee-migration-upgrade");
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      // Simulate organization before migration 94:
      state.storage.sql.exec("DROP INDEX IF EXISTS payment_attempts_unreconciled_fee");
      state.storage.sql.exec("DELETE FROM organization_schema_migrations WHERE version >= 94");

      const versionBefore = state.storage.sql
        .exec<{ version: number }>(
          "SELECT version FROM organization_schema_migrations ORDER BY version DESC LIMIT 1",
        )
        .one().version;
      expect(versionBefore).toBe(93);

      const migration94 = organizationSchemaMigrations.find((m) => m.version === 94);
      if (!migration94) throw new Error("Migration 94 not found");

      applyOrganizationMigration(state.storage, migration94);

      const versionAfter = state.storage.sql
        .exec<{ version: number }>(
          "SELECT version FROM organization_schema_migrations ORDER BY version DESC LIMIT 1",
        )
        .one().version;
      expect(versionAfter).toBe(94);

      // Verify index is present
      const indexExists = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'payment_attempts_unreconciled_fee'",
        )
        .one().count;
      expect(indexExists).toBe(1);
    });
  });

  it("uses the partial index payment_attempts_unreconciled_fee with bounded rowsRead and correct scheduling", async () => {
    const orgId = "org-fee-recon-test";
    const stub = await provisionOrganization(orgId);
    const now = new Date();
    const nowIso = now.toISOString();

    // Seed realistic fixture in payment_attempts
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      // 1. Majority of already reconciled Stripe attempts (50 rows)
      for (let i = 1; i <= 50; i++) {
        state.storage.sql.exec(
          `INSERT INTO payment_attempts
            (id, payment_type, resource_id, checkout_request_id, provider_session_id,
             provider_payment_id, status, amount_cents, processor_fee_cents,
             provider_balance_transaction_id, processor_fee_reconciled_at, created_at, updated_at)
           VALUES (?, 'ticket', 'res-1', 'req-1', ?, ?, 'paid', 5000, 175, 'txn_1', ?, ?, ?)`,
          `attempt-reconciled-${String(i)}`,
          `cs_reconciled_${String(i)}`,
          `pi_reconciled_${String(i)}`,
          nowIso,
          nowIso,
          nowIso,
        );
      }

      // 2. Fake payment attempts without fee (10 rows)
      for (let i = 1; i <= 10; i++) {
        state.storage.sql.exec(
          `INSERT INTO payment_attempts
            (id, payment_type, resource_id, checkout_request_id, provider_session_id,
             provider_payment_id, status, amount_cents, processor_fee_cents, created_at, updated_at)
           VALUES (?, 'ticket', 'res-1', 'req-1', ?, ?, 'paid', 5000, NULL, ?, ?)`,
          `attempt-fake-${String(i)}`,
          `cs_fake_${String(i)}`,
          `fake_payment_${String(i)}`,
          nowIso,
          nowIso,
        );
      }

      // 3. Pending and failed non-paid attempts (10 pending, 10 failed)
      for (let i = 1; i <= 10; i++) {
        state.storage.sql.exec(
          `INSERT INTO payment_attempts
            (id, payment_type, resource_id, checkout_request_id, provider_session_id,
             provider_payment_id, status, amount_cents, processor_fee_cents, created_at, updated_at)
           VALUES (?, 'ticket', 'res-1', 'req-1', ?, ?, 'pending', 5000, NULL, ?, ?)`,
          `attempt-pending-${String(i)}`,
          `cs_pending_${String(i)}`,
          `pi_pending_${String(i)}`,
          nowIso,
          nowIso,
        );
        state.storage.sql.exec(
          `INSERT INTO payment_attempts
            (id, payment_type, resource_id, checkout_request_id, provider_session_id,
             provider_payment_id, status, amount_cents, processor_fee_cents, created_at, updated_at)
           VALUES (?, 'ticket', 'res-1', 'req-1', ?, ?, 'expired', 5000, NULL, ?, ?)`,
          `attempt-expired-${String(i)}`,
          `cs_expired_${String(i)}`,
          `pi_expired_${String(i)}`,
          nowIso,
          nowIso,
        );
      }

      // 4. Eligible unreconciled paid and refunded attempts (3 distinct payment IDs, 4 rows total)
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, processor_fee_cents, created_at, updated_at)
         VALUES
          ('attempt-eligible-1', 'ticket', 'res-1', 'req-1', 'cs_eligible_1', 'pi_eligible_paid_1', 'paid', 5000, NULL, ?, ?),
          ('attempt-eligible-1-dup', 'ticket', 'res-1', 'req-1', 'cs_eligible_1_dup', 'pi_eligible_paid_1', 'paid', 5000, NULL, ?, ?),
          ('attempt-eligible-2', 'ticket', 'res-1', 'req-1', 'cs_eligible_2', 'pi_eligible_paid_2', 'paid', 3000, NULL, ?, ?),
          ('attempt-eligible-3-refunded', 'ticket', 'res-1', 'req-1', 'cs_eligible_3', 'pi_eligible_refunded_1', 'refunded', 4000, NULL, ?, ?)`,
        nowIso,
        nowIso,
        nowIso,
        nowIso,
        nowIso,
        nowIso,
        nowIso,
        nowIso,
      );
    });

    // 5. Query plan and row-read verification
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      // EXPLAIN QUERY PLAN
      const planCursor = state.storage.sql.exec<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT DISTINCT provider_payment_id AS providerPaymentId
         FROM payment_attempts
         WHERE status IN ('paid', 'refunded')
           AND processor_fee_cents IS NULL
           AND provider_payment_id NOT LIKE 'fake_%'
           AND provider_payment_id <> ''
         LIMIT 10`,
      );
      const plan = planCursor.toArray();
      const planDetails = plan.map((p) => p.detail).join(" ");
      expect(planDetails).toMatch(/USING INDEX payment_attempts_unreconciled_fee/);
      expect(planDetails).not.toMatch(/SCAN TABLE payment_attempts/);

      // Execute query and check rowsRead
      const cursor = state.storage.sql.exec<{ providerPaymentId: string }>(
        `SELECT DISTINCT provider_payment_id AS providerPaymentId
         FROM payment_attempts
         WHERE status IN ('paid', 'refunded')
           AND processor_fee_cents IS NULL
           AND provider_payment_id NOT LIKE 'fake_%'
           AND provider_payment_id <> ''
         LIMIT 10`,
      );
      const rows = cursor.toArray();
      expect(rows.map((r) => r.providerPaymentId).sort()).toEqual([
        "pi_eligible_paid_1",
        "pi_eligible_paid_2",
        "pi_eligible_refunded_1",
      ]);

      // Row reads must be bounded relative to eligible rows and far below total seeded count (~84 rows)
      expect(cursor.rowsRead).toBeLessThanOrEqual(15);
    });

    // 6. Test scheduler alarm reconciliation behavior
    const overdueAt = new Date(now.getTime() - 1_000).toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
        overdueAt,
        overdueAt,
      );
      return state.storage.setAlarm(now.getTime() + 60_000).then(() => undefined);
    });

    // Run alarm
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);

    // Read scheduled_job_outbox
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const jobs = state.storage.sql
        .exec<{ idempotencyKey: string; kind: string }>(
          "SELECT kind, idempotency_key AS idempotencyKey FROM scheduled_job_outbox WHERE kind = 'payment_fee_reconciliation' ORDER BY idempotencyKey",
        )
        .toArray();

      expect(jobs).toHaveLength(3);
      expect(jobs.map((j) => j.idempotencyKey)).toEqual([
        "reconcile-fee:pi_eligible_paid_1",
        "reconcile-fee:pi_eligible_paid_2",
        "reconcile-fee:pi_eligible_refunded_1",
      ]);
    });

    // 7. Repeated scheduler run must be idempotent (no duplicate jobs)
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
        overdueAt,
        overdueAt,
      );
      return state.storage.setAlarm(now.getTime() + 60_000).then(() => undefined);
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const jobs = state.storage.sql
        .exec<{ idempotencyKey: string; kind: string }>(
          "SELECT kind, idempotency_key AS idempotencyKey FROM scheduled_job_outbox WHERE kind = 'payment_fee_reconciliation'",
        )
        .toArray();

      expect(jobs).toHaveLength(3);
    });
  });
});
