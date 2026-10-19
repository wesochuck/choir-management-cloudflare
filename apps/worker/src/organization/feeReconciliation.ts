import { z } from "zod";

const feeReconciliationInputSchema = z.object({
  organizationId: z.string().min(1).max(128),
  providerPaymentId: z
    .string()
    .regex(/^(?:pi|ch)_[A-Za-z0-9_-]+$/)
    .max(256),
});

const FEE_RECONCILIATION_KEY_PREFIX = "reconcile-fee:";
const FEE_RECONCILIATION_RECOVERY_LIMIT = 3;
const FEE_RECONCILIATION_RECOVERY_DELAY_MS = 60 * 60 * 1_000;

interface OrganizationIdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface FeeReconciliationLedgerRow {
  readonly [column: string]: SqlStorageValue;
  readonly completedAt: string | null;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly kind: string;
  readonly status: "claimed" | "completed" | "failed";
  readonly terminalAt: string | null;
}

interface FeeReconciliationOutboxRow {
  readonly [column: string]: SqlStorageValue;
  readonly enqueuedAt: string | null;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly kind: string;
}

interface FeeReconciliationGeneration {
  readonly idempotencyKey: string;
  ledger: FeeReconciliationLedgerRow | null;
  outbox: FeeReconciliationOutboxRow | null;
}

interface PaymentFeeStatusInput {
  readonly organizationId: string;
  readonly providerPaymentId: string;
}

export type PaymentFeeReconciliationStatus =
  | { readonly code: "organization_identity_conflict"; readonly status: "rejected" }
  | { readonly status: "not_found" | "unreconciled" | "reconciled" };

export type PaymentFeeReconciliationScheduleResult =
  | {
      readonly code:
        "fee_reconciliation_identity_conflict" | "fee_reconciliation_outbox_repair_conflict";
      readonly status: "rejected";
    }
  | { readonly code: "invalid_payment_id"; readonly status: "rejected" }
  | { readonly code: "organization_identity_conflict"; readonly status: "rejected" }
  | { readonly status: "already_reconciled"; readonly generation: number }
  | { readonly status: "payment_not_found" }
  | {
      readonly generation: number;
      readonly idempotencyKey: string;
      readonly jobId: string;
      readonly status: "pending" | "scheduled";
      readonly wakeScheduler: boolean;
    }
  | { readonly generation: number; readonly status: "recovery_capped" }
  | {
      readonly generation: number;
      readonly retryAt: string;
      readonly status: "recovery_wait";
    };

interface ParsedFeeReconciliationKey {
  readonly generation: number;
  readonly providerPaymentId: string;
}

function feeReconciliationIdempotencyKey(providerPaymentId: string, generation: number): string {
  return generation === 0
    ? `${FEE_RECONCILIATION_KEY_PREFIX}${providerPaymentId}`
    : `${FEE_RECONCILIATION_KEY_PREFIX}${providerPaymentId}:recovery:${String(generation)}`;
}

export function parseFeeReconciliationIdempotencyKey(
  idempotencyKey: string,
): ParsedFeeReconciliationKey | null {
  if (!idempotencyKey.startsWith(FEE_RECONCILIATION_KEY_PREFIX)) return null;
  const value = idempotencyKey.slice(FEE_RECONCILIATION_KEY_PREFIX.length);
  const recoveryMarker = ":recovery:";
  const recoveryAt = value.lastIndexOf(recoveryMarker);
  const providerPaymentId = recoveryAt === -1 ? value : value.slice(0, recoveryAt);
  const generationText = recoveryAt === -1 ? "0" : value.slice(recoveryAt + recoveryMarker.length);
  const parsedGeneration = Number(generationText);
  if (
    !/^(?:pi|ch)_[A-Za-z0-9_-]+$/.test(providerPaymentId) ||
    !Number.isInteger(parsedGeneration) ||
    parsedGeneration < 0 ||
    parsedGeneration > FEE_RECONCILIATION_RECOVERY_LIMIT ||
    (recoveryAt !== -1 && parsedGeneration === 0)
  ) {
    return null;
  }
  return { generation: parsedGeneration, providerPaymentId };
}

function readOrganizationIdentity(storage: DurableObjectStorage): string | null {
  return (
    storage.sql
      .exec<OrganizationIdentityRow>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId ?? null
  );
}

function paymentFeeIsRecorded(storage: DurableObjectStorage, providerPaymentId: string): boolean {
  const rows = storage.sql
    .exec<{ readonly processorFeeCents: number | null }>(
      `SELECT processor_fee_cents AS processorFeeCents
       FROM payment_attempts
       WHERE provider_payment_id = ? AND status IN ('paid', 'refunded')`,
      providerPaymentId,
    )
    .toArray();
  return rows.length > 0 && rows.every((row) => row.processorFeeCents !== null);
}

export function readPaymentFeeReconciliationStatus(
  storage: DurableObjectStorage,
  input: PaymentFeeStatusInput,
): PaymentFeeReconciliationStatus {
  const parsed = feeReconciliationInputSchema.safeParse(input);
  if (!parsed.success) return { status: "not_found" };
  if (readOrganizationIdentity(storage) !== parsed.data.organizationId) {
    return { code: "organization_identity_conflict", status: "rejected" };
  }
  const rows = storage.sql
    .exec<{ readonly processorFeeCents: number | null }>(
      `SELECT processor_fee_cents AS processorFeeCents
       FROM payment_attempts
       WHERE provider_payment_id = ? AND status IN ('paid', 'refunded')`,
      parsed.data.providerPaymentId,
    )
    .toArray();
  if (rows.length === 0) return { status: "not_found" };
  return rows.every((row) => row.processorFeeCents !== null)
    ? { status: "reconciled" }
    : { status: "unreconciled" };
}

function readFeeReconciliationGenerations(
  storage: DurableObjectStorage,
  providerPaymentId: string,
): Map<number, FeeReconciliationGeneration> | null {
  const baseKey = feeReconciliationIdempotencyKey(providerPaymentId, 0);
  const recoveryPrefix = `${baseKey}:recovery:`;
  const recoveryUpperBound = `${baseKey}:recovery;`;
  const ledgerRows = storage.sql
    .exec<FeeReconciliationLedgerRow>(
      `SELECT idempotency_key AS idempotencyKey, job_id AS jobId, kind, status,
              terminal_at AS terminalAt, completed_at AS completedAt
       FROM job_ledger
       WHERE idempotency_key = ? OR
             (idempotency_key >= ? AND idempotency_key < ?)
       ORDER BY idempotency_key DESC LIMIT 8`,
      baseKey,
      recoveryPrefix,
      recoveryUpperBound,
    )
    .toArray();
  const outboxRows = storage.sql
    .exec<FeeReconciliationOutboxRow>(
      `SELECT idempotency_key AS idempotencyKey, job_id AS jobId, kind,
              enqueued_at AS enqueuedAt
       FROM scheduled_job_outbox
       WHERE idempotency_key = ? OR
             (idempotency_key >= ? AND idempotency_key < ?)
       ORDER BY idempotency_key DESC LIMIT 8`,
      baseKey,
      recoveryPrefix,
      recoveryUpperBound,
    )
    .toArray();

  const generations = new Map<number, FeeReconciliationGeneration>();
  for (const row of ledgerRows) {
    const parsedKey = parseFeeReconciliationIdempotencyKey(row.idempotencyKey);
    if (parsedKey?.providerPaymentId !== providerPaymentId) return null;
    const existing = generations.get(parsedKey.generation);
    if (existing && existing.idempotencyKey !== row.idempotencyKey) return null;
    generations.set(parsedKey.generation, {
      idempotencyKey: row.idempotencyKey,
      ledger: row,
      outbox: existing?.outbox ?? null,
    });
  }
  for (const row of outboxRows) {
    const parsedKey = parseFeeReconciliationIdempotencyKey(row.idempotencyKey);
    if (parsedKey?.providerPaymentId !== providerPaymentId) return null;
    const existing = generations.get(parsedKey.generation);
    if (existing && existing.idempotencyKey !== row.idempotencyKey) return null;
    generations.set(parsedKey.generation, {
      idempotencyKey: row.idempotencyKey,
      ledger: existing?.ledger ?? null,
      outbox: row,
    });
  }
  return generations;
}

function latestGeneration(
  generations: ReadonlyMap<number, FeeReconciliationGeneration>,
): { readonly generation: number; readonly record: FeeReconciliationGeneration } | null {
  let latest: { readonly generation: number; readonly record: FeeReconciliationGeneration } | null =
    null;
  for (const [generation, record] of generations) {
    if (!latest || generation > latest.generation) latest = { generation, record };
  }
  return latest;
}

function ensureFeeReconciliationOutbox(
  storage: DurableObjectStorage,
  input: {
    readonly idempotencyKey: string;
    readonly jobId: string;
    readonly now: Date;
  },
): boolean | null {
  const existingByJobId = storage.sql
    .exec<{ readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND idempotency_key != ? LIMIT 1`,
      input.jobId,
      input.idempotencyKey,
    )
    .toArray()
    .at(0);
  if (existingByJobId) return null;

  const outbox = storage.sql
    .exec<FeeReconciliationOutboxRow>(
      `SELECT idempotency_key AS idempotencyKey, job_id AS jobId, kind,
              enqueued_at AS enqueuedAt
       FROM scheduled_job_outbox WHERE idempotency_key = ? LIMIT 1`,
      input.idempotencyKey,
    )
    .toArray()
    .at(0);
  const nowIso = input.now.toISOString();
  if (!outbox) {
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox
        (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'payment_fee_reconciliation', ?, ?, ?)`,
      input.jobId,
      input.idempotencyKey,
      nowIso,
      nowIso,
    );
    return true;
  }
  if (outbox.kind !== "payment_fee_reconciliation") return null;
  if (outbox.jobId === input.jobId) return false;

  storage.sql.exec(
    `UPDATE scheduled_job_outbox
     SET job_id = ?, due_at = ?, enqueued_at = NULL
     WHERE idempotency_key = ? AND job_id = ?`,
    input.jobId,
    nowIso,
    input.idempotencyKey,
    outbox.jobId,
  );
  const repaired = storage.sql
    .exec<{ readonly jobId: string }>(
      `SELECT job_id AS jobId FROM scheduled_job_outbox WHERE idempotency_key = ? LIMIT 1`,
      input.idempotencyKey,
    )
    .toArray()
    .at(0);
  return repaired?.jobId === input.jobId ? true : null;
}

function scheduleNewGeneration(
  storage: DurableObjectStorage,
  providerPaymentId: string,
  generation: number,
  now: Date,
): PaymentFeeReconciliationScheduleResult {
  if (generation > FEE_RECONCILIATION_RECOVERY_LIMIT) {
    return { generation: generation - 1, status: "recovery_capped" };
  }
  const idempotencyKey = feeReconciliationIdempotencyKey(providerPaymentId, generation);
  const jobId = crypto.randomUUID();
  const outboxCreated = ensureFeeReconciliationOutbox(storage, {
    idempotencyKey,
    jobId,
    now,
  });
  if (outboxCreated === null) {
    return { code: "fee_reconciliation_identity_conflict", status: "rejected" };
  }
  const canonical = storage.sql
    .exec<FeeReconciliationOutboxRow>(
      `SELECT idempotency_key AS idempotencyKey, job_id AS jobId, kind,
              enqueued_at AS enqueuedAt
       FROM scheduled_job_outbox WHERE idempotency_key = ? LIMIT 1`,
      idempotencyKey,
    )
    .toArray()
    .at(0);
  if (canonical?.kind !== "payment_fee_reconciliation") {
    return { code: "fee_reconciliation_identity_conflict", status: "rejected" };
  }
  return {
    generation,
    idempotencyKey,
    jobId: canonical.jobId,
    status: outboxCreated ? "scheduled" : "pending",
    wakeScheduler: outboxCreated,
  };
}

/**
 * Converges webhook and hourly-scheduler fee work on the Organization-owned outbox identity.
 * The caller must keep a DO transaction around this helper when it is not already in one.
 */
export function schedulePaymentFeeReconciliationInStore(
  storage: DurableObjectStorage,
  input: {
    readonly now?: Date | undefined;
    readonly organizationId: string;
    readonly providerPaymentId: string;
  },
): PaymentFeeReconciliationScheduleResult {
  const parsed = feeReconciliationInputSchema.safeParse(input);
  if (!parsed.success) return { code: "invalid_payment_id", status: "rejected" };
  if (readOrganizationIdentity(storage) !== parsed.data.organizationId) {
    return { code: "organization_identity_conflict", status: "rejected" };
  }
  const providerPaymentId = parsed.data.providerPaymentId;
  const reconciled = alreadyReconciledResult(storage, providerPaymentId);
  if (reconciled) return reconciled;
  if (!hasPaidOrRefundedPayment(storage, providerPaymentId)) return { status: "payment_not_found" };

  const generations = readFeeReconciliationGenerations(storage, providerPaymentId);
  if (!generations) {
    return { code: "fee_reconciliation_identity_conflict", status: "rejected" };
  }
  const latest = latestGeneration(generations);
  const now = input.now ?? new Date();
  return latest
    ? continueCurrentGeneration(storage, providerPaymentId, latest, now)
    : scheduleNewGeneration(storage, providerPaymentId, 0, now);
}

function alreadyReconciledResult(
  storage: DurableObjectStorage,
  providerPaymentId: string,
): PaymentFeeReconciliationScheduleResult | null {
  if (paymentFeeIsRecorded(storage, providerPaymentId)) {
    const generations = readFeeReconciliationGenerations(storage, providerPaymentId);
    const latest = generations ? latestGeneration(generations) : null;
    return { generation: latest?.generation ?? 0, status: "already_reconciled" };
  }
  return null;
}

function hasPaidOrRefundedPayment(
  storage: DurableObjectStorage,
  providerPaymentId: string,
): boolean {
  return (
    storage.sql
      .exec<{ readonly payment_exists: number }>(
        `SELECT 1 AS payment_exists
       FROM payment_attempts
       WHERE provider_payment_id = ? AND status IN ('paid', 'refunded')
       LIMIT 1`,
        providerPaymentId,
      )
      .toArray().length > 0
  );
}

function continueCurrentGeneration(
  storage: DurableObjectStorage,
  providerPaymentId: string,
  latest: { readonly generation: number; readonly record: FeeReconciliationGeneration },
  now: Date,
): PaymentFeeReconciliationScheduleResult {
  const current = latest.record;
  if (!isValidFeeReconciliationGeneration(current)) {
    return { code: "fee_reconciliation_identity_conflict", status: "rejected" };
  }

  const recovery = scheduleRecoveryAfterTerminalGeneration(
    storage,
    providerPaymentId,
    latest.generation,
    current,
    now,
  );
  if (recovery) return recovery;

  const jobIdentity = resolveCurrentJobIdentity(storage, current, now);
  if ("code" in jobIdentity) return jobIdentity;
  return {
    generation: latest.generation,
    idempotencyKey: current.idempotencyKey,
    jobId: jobIdentity.jobId,
    status: current.ledger || current.outbox ? "pending" : "scheduled",
    wakeScheduler: jobIdentity.wakeScheduler,
  };
}

function resolveCurrentJobIdentity(
  storage: DurableObjectStorage,
  current: FeeReconciliationGeneration,
  now: Date,
):
  | { readonly jobId: string; readonly wakeScheduler: boolean }
  | {
      readonly code:
        "fee_reconciliation_identity_conflict" | "fee_reconciliation_outbox_repair_conflict";
      readonly status: "rejected";
    } {
  let jobId = current.ledger?.jobId ?? current.outbox?.jobId;
  if (!jobId) return { code: "fee_reconciliation_identity_conflict", status: "rejected" };
  let wakeScheduler = false;
  if (current.ledger && current.outbox && current.ledger.jobId !== current.outbox.jobId) {
    const repaired = ensureFeeReconciliationOutbox(storage, {
      idempotencyKey: current.idempotencyKey,
      jobId: current.ledger.jobId,
      now,
    });
    if (repaired === null) {
      return { code: "fee_reconciliation_outbox_repair_conflict", status: "rejected" };
    }
    wakeScheduler = repaired;
    jobId = current.ledger.jobId;
  } else if (current.ledger && !current.outbox) {
    const created = ensureFeeReconciliationOutbox(storage, {
      idempotencyKey: current.idempotencyKey,
      jobId: current.ledger.jobId,
      now,
    });
    if (created === null) {
      return { code: "fee_reconciliation_identity_conflict", status: "rejected" };
    }
    wakeScheduler = created;
  }
  return { jobId, wakeScheduler };
}

function isValidFeeReconciliationGeneration(current: FeeReconciliationGeneration): boolean {
  if (
    current.ledger &&
    (current.ledger.kind !== "payment_fee_reconciliation" ||
      current.ledger.idempotencyKey !== current.idempotencyKey)
  ) {
    return false;
  }
  return !current.outbox || current.outbox.kind === "payment_fee_reconciliation";
}

function scheduleRecoveryAfterTerminalGeneration(
  storage: DurableObjectStorage,
  providerPaymentId: string,
  generation: number,
  current: FeeReconciliationGeneration,
  now: Date,
): PaymentFeeReconciliationScheduleResult | null {
  if (
    !current.ledger ||
    (current.ledger.status !== "completed" && current.ledger.terminalAt === null)
  ) {
    return null;
  }
  const completedAt = current.ledger.terminalAt ?? current.ledger.completedAt;
  if (!completedAt) {
    return { code: "fee_reconciliation_identity_conflict", status: "rejected" };
  }
  const completedAtTime = new Date(completedAt).getTime();
  if (!Number.isFinite(completedAtTime)) {
    return { code: "fee_reconciliation_identity_conflict", status: "rejected" };
  }
  const retryAt = new Date(completedAtTime + FEE_RECONCILIATION_RECOVERY_DELAY_MS);
  if (retryAt.getTime() > now.getTime()) {
    return { generation, retryAt: retryAt.toISOString(), status: "recovery_wait" };
  }
  if (generation >= FEE_RECONCILIATION_RECOVERY_LIMIT) {
    return { generation, status: "recovery_capped" };
  }
  return scheduleNewGeneration(storage, providerPaymentId, generation + 1, now);
}
