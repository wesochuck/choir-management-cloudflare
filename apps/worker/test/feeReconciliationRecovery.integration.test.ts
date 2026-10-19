import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { schedulePaymentFeeReconciliationInStore } from "../src/organization/feeReconciliation";

const organizationStore = env.ORGANIZATION_STORE;

async function provisionOrganization(
  organizationId: string,
): Promise<DurableObjectStub<OrganizationStore>> {
  const stub = organizationStore.get(organizationStore.idFromName(organizationId));
  const response = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: `${organizationId}.localhost`,
      canonicalStatus: "active",
      name: "Fee Recovery Test Organization",
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

async function insertPaymentAttempt(
  stub: DurableObjectStub<OrganizationStore>,
  providerPaymentId: string,
  feeCents: number | null = null,
): Promise<void> {
  const now = new Date().toISOString();
  await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO payment_attempts
        (id, payment_type, resource_id, checkout_request_id, provider_session_id,
         provider_payment_id, status, amount_cents, processor_fee_cents, created_at, updated_at)
       VALUES (?, 'ticket', 'recovery-fixture', 'recovery-request', ?, ?, 'paid', 1200, ?, ?, ?)`,
      crypto.randomUUID(),
      `cs_${providerPaymentId}`,
      providerPaymentId,
      feeCents,
      now,
      now,
    );
  });
}

async function scheduleAt(
  stub: DurableObjectStub<OrganizationStore>,
  organizationId: string,
  providerPaymentId: string,
  now: Date,
) {
  return runInDurableObject<
    OrganizationStore,
    ReturnType<typeof schedulePaymentFeeReconciliationInStore>
  >(stub, (_instance, state) =>
    state.storage.transactionSync(() =>
      schedulePaymentFeeReconciliationInStore(state.storage, {
        now,
        organizationId,
        providerPaymentId,
      }),
    ),
  );
}

async function seedTerminalGeneration(
  stub: DurableObjectStub<OrganizationStore>,
  providerPaymentId: string,
  generation: number,
  terminalAt: string,
  options: {
    readonly outboxJobId?: string | undefined;
    readonly ledgerJobId?: string | undefined;
  } = {},
): Promise<void> {
  const now = new Date().toISOString();
  const baseKey = `reconcile-fee:${providerPaymentId}`;
  const idempotencyKey = generation === 0 ? baseKey : `${baseKey}:recovery:${String(generation)}`;
  const ledgerJobId = options.ledgerJobId ?? crypto.randomUUID();
  const outboxJobId = options.outboxJobId ?? ledgerJobId;
  await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO job_ledger
        (idempotency_key, job_id, kind, status, attempt, retry_count,
         claimed_at, completed_at, failed_at, terminal_at, last_error_code)
       VALUES (?, ?, 'payment_fee_reconciliation', 'failed', 10, 10, ?, NULL, ?, ?, 'queue_dead_lettered')`,
      idempotencyKey,
      ledgerJobId,
      now,
      terminalAt,
      terminalAt,
    );
    if (options.outboxJobId !== undefined) {
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox
          (job_id, kind, idempotency_key, due_at, created_at, enqueued_at)
         VALUES (?, 'payment_fee_reconciliation', ?, ?, ?, ?)`,
        outboxJobId,
        idempotencyKey,
        now,
        now,
        now,
      );
    }
  });
}

async function runSchedulerNow(stub: DurableObjectStub<OrganizationStore>): Promise<void> {
  const now = Date.now();
  await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
    const overdueAt = new Date(now - 1_000).toISOString();
    state.storage.sql.exec(
      "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
      overdueAt,
      overdueAt,
    );
    return state.storage.setAlarm(now + 60_000).then(() => undefined);
  });
  await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
}

afterEach(async () => reset());

describe("processing-fee reconciliation recovery", () => {
  it("converges webhook scheduling and the hourly scan on one canonical identity", async () => {
    const organizationId = "org-fee-recovery-converges";
    const providerPaymentId = "pi_shared_schedule";
    const stub = await provisionOrganization(organizationId);
    await insertPaymentAttempt(stub, providerPaymentId);

    const webhookDeferral = await stub.schedulePaymentFeeReconciliation({
      organizationId,
      providerPaymentId,
    });
    const webhookReplay = await stub.schedulePaymentFeeReconciliation({
      organizationId,
      providerPaymentId,
    });
    expect(webhookDeferral).toMatchObject({
      generation: 0,
      idempotencyKey: `reconcile-fee:${providerPaymentId}`,
      status: "scheduled",
    });
    expect(webhookReplay).toMatchObject({
      generation: 0,
      jobId: webhookDeferral.status === "scheduled" ? webhookDeferral.jobId : "",
      status: "pending",
    });

    await runSchedulerNow(stub);
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const outbox = state.storage.sql
        .exec<{ idempotencyKey: string; jobId: string }>(
          `SELECT idempotency_key AS idempotencyKey, job_id AS jobId
           FROM scheduled_job_outbox WHERE kind = 'payment_fee_reconciliation'`,
        )
        .toArray();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.idempotencyKey).toBe(`reconcile-fee:${providerPaymentId}`);
      expect(outbox[0]?.jobId).toBe(
        webhookDeferral.status === "scheduled" ? webhookDeferral.jobId : "",
      );
    });
  });

  it("repairs an active legacy identity mismatch and rejects cross-Organization scheduling", async () => {
    const organizationId = "org-fee-recovery-repair";
    const providerPaymentId = "ch_legacy_charge";
    const stub = await provisionOrganization(organizationId);
    await insertPaymentAttempt(stub, providerPaymentId);
    const now = new Date().toISOString();
    const canonicalJobId = crypto.randomUUID();
    const staleJobId = crypto.randomUUID();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO job_ledger
          (idempotency_key, job_id, kind, status, attempt, retry_count, claimed_at)
         VALUES (?, ?, 'payment_fee_reconciliation', 'claimed', 1, 0, ?)`,
        `reconcile-fee:${providerPaymentId}`,
        canonicalJobId,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox
          (job_id, kind, idempotency_key, due_at, created_at, enqueued_at)
         VALUES (?, 'payment_fee_reconciliation', ?, ?, ?, ?)`,
        staleJobId,
        `reconcile-fee:${providerPaymentId}`,
        now,
        now,
        now,
      );
    });

    const repaired = await stub.schedulePaymentFeeReconciliation({
      organizationId,
      providerPaymentId,
    });
    expect(repaired).toMatchObject({
      generation: 0,
      idempotencyKey: `reconcile-fee:${providerPaymentId}`,
      jobId: canonicalJobId,
      status: "pending",
      wakeScheduler: true,
    });
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ enqueuedAt: string | null; jobId: string }>(
          `SELECT job_id AS jobId, enqueued_at AS enqueuedAt
           FROM scheduled_job_outbox WHERE idempotency_key = ?`,
          `reconcile-fee:${providerPaymentId}`,
        )
        .one();
      expect(row).toEqual({ enqueuedAt: null, jobId: canonicalJobId });
    });

    const rejected = await stub.schedulePaymentFeeReconciliation({
      organizationId: "org-other-tenant",
      providerPaymentId,
    });
    expect(rejected).toEqual({ code: "organization_identity_conflict", status: "rejected" });
  });

  it("recovers exhausted webhook-only and mismatched legacy jobs without reopening their identity", async () => {
    const organizationId = "org-fee-recovery-legacy";
    const stub = await provisionOrganization(organizationId);
    const terminalAt = new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString();

    const webhookOnlyPaymentId = "pi_legacy_webhook_only";
    await insertPaymentAttempt(stub, webhookOnlyPaymentId);
    await seedTerminalGeneration(stub, webhookOnlyPaymentId, 0, terminalAt);
    const webhookOnlyRecovery = await stub.schedulePaymentFeeReconciliation({
      organizationId,
      providerPaymentId: webhookOnlyPaymentId,
    });
    expect(webhookOnlyRecovery).toMatchObject({
      generation: 1,
      idempotencyKey: `reconcile-fee:${webhookOnlyPaymentId}:recovery:1`,
      status: "scheduled",
    });

    const mismatchedPaymentId = "pi_legacy_outbox_mismatch";
    await insertPaymentAttempt(stub, mismatchedPaymentId);
    const ledgerJobId = crypto.randomUUID();
    const staleOutboxJobId = crypto.randomUUID();
    await seedTerminalGeneration(stub, mismatchedPaymentId, 0, terminalAt, {
      ledgerJobId,
      outboxJobId: staleOutboxJobId,
    });
    const mismatchedRecovery = await stub.schedulePaymentFeeReconciliation({
      organizationId,
      providerPaymentId: mismatchedPaymentId,
    });
    expect(mismatchedRecovery).toMatchObject({
      generation: 1,
      idempotencyKey: `reconcile-fee:${mismatchedPaymentId}:recovery:1`,
      status: "scheduled",
    });

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const identities = state.storage.sql
        .exec<{ idempotencyKey: string; jobId: string }>(
          `SELECT idempotency_key AS idempotencyKey, job_id AS jobId
           FROM scheduled_job_outbox
           WHERE idempotency_key IN (?, ?, ?, ?)
           ORDER BY idempotency_key`,
          `reconcile-fee:${webhookOnlyPaymentId}`,
          `reconcile-fee:${webhookOnlyPaymentId}:recovery:1`,
          `reconcile-fee:${mismatchedPaymentId}`,
          `reconcile-fee:${mismatchedPaymentId}:recovery:1`,
        )
        .toArray();
      expect(identities).toHaveLength(3);
      expect(
        identities.find((row) => row.idempotencyKey === `reconcile-fee:${mismatchedPaymentId}`)
          ?.jobId,
      ).toBe(staleOutboxJobId);
      expect(
        identities.find(
          (row) => row.idempotencyKey === `reconcile-fee:${mismatchedPaymentId}:recovery:1`,
        )?.jobId,
      ).not.toBe(ledgerJobId);
    });
  });

  it("waits an hour between bounded recovery generations and caps at three", async () => {
    const organizationId = "org-fee-recovery-cadence";
    const providerPaymentId = "pi_recovery_cadence";
    const stub = await provisionOrganization(organizationId);
    await insertPaymentAttempt(stub, providerPaymentId);
    const now = new Date("2026-10-18T12:00:00.000Z");
    const baseTerminalAt = new Date(now.getTime() - 59 * 60 * 1_000).toISOString();
    await seedTerminalGeneration(stub, providerPaymentId, 0, baseTerminalAt);

    const waiting = await scheduleAt(stub, organizationId, providerPaymentId, now);
    expect(waiting).toMatchObject({ generation: 0, status: "recovery_wait" });
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE job_ledger SET terminal_at = ? WHERE idempotency_key = ?`,
        new Date(now.getTime() - 61 * 60 * 1_000).toISOString(),
        `reconcile-fee:${providerPaymentId}`,
      );
    });

    for (let generation = 1; generation <= 3; generation++) {
      const scheduled = await scheduleAt(stub, organizationId, providerPaymentId, now);
      expect(scheduled).toMatchObject({
        generation,
        idempotencyKey: `reconcile-fee:${providerPaymentId}:recovery:${String(generation)}`,
        status: "scheduled",
      });
      await seedTerminalGeneration(
        stub,
        providerPaymentId,
        generation,
        new Date(now.getTime() - 61 * 60 * 1_000).toISOString(),
      );
    }

    const capped = await scheduleAt(stub, organizationId, providerPaymentId, now);
    expect(capped).toEqual({ generation: 3, status: "recovery_capped" });
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const count = state.storage.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM scheduled_job_outbox
           WHERE idempotency_key LIKE 'reconcile-fee:pi_recovery_cadence%'`,
        )
        .one().count;
      expect(count).toBe(3);
    });
  });

  it("stops scheduling once the fee is recorded and advances fairly past capped candidates", async () => {
    const organizationId = "org-fee-recovery-fair-scan";
    const providerPaymentId = "pi_00_stop_after_fee";
    const stub = await provisionOrganization(organizationId);
    await insertPaymentAttempt(stub, providerPaymentId);
    const initial = await stub.schedulePaymentFeeReconciliation({
      organizationId,
      providerPaymentId,
    });
    expect(initial.status).toBe("scheduled");
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE payment_attempts SET processor_fee_cents = 42 WHERE provider_payment_id = ?",
        providerPaymentId,
      );
    });
    const stopped = await stub.schedulePaymentFeeReconciliation({
      organizationId,
      providerPaymentId,
    });
    expect(stopped).toMatchObject({ generation: 0, status: "already_reconciled" });

    const fairOrganizationId = "org-fee-recovery-cursor";
    const fairStub = await provisionOrganization(fairOrganizationId);
    const terminalAt = new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString();
    for (let i = 0; i < 20; i++) {
      const paymentId = `pi_capped_${String(i).padStart(2, "0")}`;
      await insertPaymentAttempt(fairStub, paymentId);
      for (let generation = 0; generation <= 3; generation++) {
        await seedTerminalGeneration(fairStub, paymentId, generation, terminalAt);
      }
    }
    const laterPaymentId = "pi_zz_later_candidate";
    await insertPaymentAttempt(fairStub, laterPaymentId);

    await runSchedulerNow(fairStub);
    await runSchedulerNow(fairStub);
    await runSchedulerNow(fairStub);

    await runInDurableObject<OrganizationStore, undefined>(fairStub, (_instance, state) => {
      const outbox = state.storage.sql
        .exec<{ idempotencyKey: string }>(
          `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
           WHERE idempotency_key = ?`,
          `reconcile-fee:${laterPaymentId}`,
        )
        .toArray();
      expect(outbox).toHaveLength(1);

      const plan = state.storage.sql
        .exec<{ readonly detail: string }>(
          `EXPLAIN QUERY PLAN
           SELECT DISTINCT provider_payment_id AS providerPaymentId
           FROM payment_attempts
           WHERE provider_payment_id > ?
             AND status IN ('paid', 'refunded')
             AND processor_fee_cents IS NULL
             AND provider_payment_id NOT LIKE 'fake_%'
             AND provider_payment_id <> ''
           ORDER BY provider_payment_id
           LIMIT 10`,
          "pi_capped_09",
        )
        .toArray()
        .map((row) => row.detail)
        .join(" ");
      expect(plan).toMatch(/USING INDEX payment_attempts_unreconciled_fee/);

      const page = state.storage.sql.exec(
        `SELECT DISTINCT provider_payment_id AS providerPaymentId
         FROM payment_attempts
         WHERE provider_payment_id > ?
           AND status IN ('paid', 'refunded')
           AND processor_fee_cents IS NULL
           AND provider_payment_id NOT LIKE 'fake_%'
           AND provider_payment_id <> ''
         ORDER BY provider_payment_id
         LIMIT 10`,
        "pi_capped_09",
      );
      expect(page.toArray()).toHaveLength(10);
      expect(page.rowsRead).toBeLessThanOrEqual(12);
    });
  });
});
