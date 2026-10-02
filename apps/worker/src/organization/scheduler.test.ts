import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { computePrefixUpperBound } from "./scheduler";
import { organizationSchemaMigrations } from "./schema/migrations";

function seedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE IF NOT EXISTS organization_schema_migrations (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT`);
  for (const migration of organizationSchemaMigrations) {
    for (const statement of migration.statements) {
      db.exec(statement);
    }
  }
  return db;
}

interface QueryPlanRow {
  readonly detail: string;
}

describe("scheduler event reminder history lookups", () => {
  describe("computePrefixUpperBound", () => {
    it("computes the exclusive upper bound for colon-terminated prefixes", () => {
      expect(computePrefixUpperBound("event-reminder:org:event:retry:")).toBe(
        "event-reminder:org:event:retry;",
      );
      expect(computePrefixUpperBound("abc:")).toBe("abc;");
      expect(computePrefixUpperBound("a")).toBe("b");
    });

    it("throws for empty prefix", () => {
      expect(() => computePrefixUpperBound("")).toThrow("Prefix must not be empty");
    });
  });

  describe("query plan verification", () => {
    it("uses unique index on scheduled_job_outbox without table scans", () => {
      const db = seedDatabase();
      const baseKey = "event-reminder:org-1:event-1";
      const retryPrefix = `${baseKey}:retry:`;
      const upperBound = computePrefixUpperBound(retryPrefix);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query inspection
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT o.job_id AS jobId, l.status, l.terminal_at AS terminalAt
           FROM scheduled_job_outbox o
           LEFT JOIN job_ledger l ON l.job_id = o.job_id
           WHERE o.kind = 'event_reminder'
             AND (
               o.idempotency_key = ?
               OR (o.idempotency_key >= ? AND o.idempotency_key < ?)
             )
           ORDER BY o.created_at, o.job_id`,
        )
        .all(baseKey, retryPrefix, upperBound) as unknown as QueryPlanRow[];

      const outboxScans = plan.filter((row) => row.detail.includes("SCAN o"));
      expect(outboxScans).toHaveLength(0);

      const outboxSearches = plan.filter(
        (row) => row.detail.includes("SEARCH o USING INDEX") || row.detail.includes("SEARCH o"),
      );
      expect(outboxSearches.length).toBeGreaterThan(0);
    });

    it("uses primary key index on job_ledger without table scans", () => {
      const db = seedDatabase();
      const baseKey = "event-reminder:org-1:event-1";
      const retryPrefix = `${baseKey}:retry:`;
      const upperBound = computePrefixUpperBound(retryPrefix);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query inspection
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT COUNT(*) AS count FROM job_ledger
           WHERE kind = 'event_reminder'
             AND (
               idempotency_key = ?
               OR (idempotency_key >= ? AND idempotency_key < ?)
             )`,
        )
        .all(baseKey, retryPrefix, upperBound) as unknown as QueryPlanRow[];

      const ledgerScans = plan.filter((row) => row.detail.includes("SCAN job_ledger"));
      expect(ledgerScans).toHaveLength(0);

      const ledgerSearches = plan.filter(
        (row) =>
          row.detail.includes("SEARCH job_ledger USING INDEX") ||
          row.detail.includes("SEARCH job_ledger"),
      );
      expect(ledgerSearches.length).toBeGreaterThan(0);
    });
  });

  describe("functional correctness and prefix collision safety", () => {
    it("correctly matches base and retry keys while ignoring near-prefix collisions and other kinds/orgs", () => {
      const db = seedDatabase();
      const now = new Date().toISOString();

      const insertOutbox = db.prepare(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const insertLedger = db.prepare(
        `INSERT INTO job_ledger (idempotency_key, job_id, kind, status, attempt, claimed_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      // Target event: event-1
      const baseKey = "event-reminder:org-1:event-1";
      const retry0 = `${baseKey}:retry:0`;
      const retry1 = `${baseKey}:retry:1`;

      insertOutbox.run("job-1-base", "event_reminder", baseKey, now, now);
      insertOutbox.run("job-1-retry0", "event_reminder", retry0, now, now);
      insertOutbox.run("job-1-retry1", "event_reminder", retry1, now, now);

      insertLedger.run(baseKey, "job-1-base", "event_reminder", "failed", 1, now, now);
      insertLedger.run(retry0, "job-1-retry0", "event_reminder", "failed", 1, now, now);
      insertLedger.run(retry1, "job-1-retry1", "event_reminder", "failed", 1, now, now);

      // Near-prefix collision: event-10 (starts with event-1)
      const nearCollisionBase = "event-reminder:org-1:event-10";
      const nearCollisionRetry = `${nearCollisionBase}:retry:0`;
      insertOutbox.run("job-10-base", "event_reminder", nearCollisionBase, now, now);
      insertOutbox.run("job-10-retry", "event_reminder", nearCollisionRetry, now, now);
      insertLedger.run(nearCollisionBase, "job-10-base", "event_reminder", "failed", 1, now, now);
      insertLedger.run(nearCollisionRetry, "job-10-retry", "event_reminder", "failed", 1, now, now);

      // Other org: org-2 with event-1
      const otherOrgBase = "event-reminder:org-2:event-1";
      insertOutbox.run("job-org2", "event_reminder", otherOrgBase, now, now);
      insertLedger.run(otherOrgBase, "job-org2", "event_reminder", "failed", 1, now, now);

      // Other kind: roster_sync with same key format
      const otherKindKey = "roster_sync:org-1:event-1";
      insertOutbox.run("job-roster", "roster_sync", otherKindKey, now, now);
      insertLedger.run(otherKindKey, "job-roster", "roster_sync", "failed", 1, now, now);

      // Seed 200 unrelated history rows
      for (let i = 0; i < 200; i++) {
        const randKey = `unrelated:job:${String(i)}`;
        insertOutbox.run(`unrelated-outbox-${String(i)}`, "unrelated", randKey, now, now);
        insertLedger.run(
          randKey,
          `unrelated-outbox-${String(i)}`,
          "unrelated",
          "completed",
          1,
          now,
          now,
        );
      }

      // Query target event-1
      const retryPrefix = `${baseKey}:retry:`;
      const upperBound = computePrefixUpperBound(retryPrefix);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query
      const matchedOutbox = db
        .prepare(
          `SELECT o.job_id AS jobId
           FROM scheduled_job_outbox o
           LEFT JOIN job_ledger l ON l.job_id = o.job_id
           WHERE o.kind = 'event_reminder'
             AND (
               o.idempotency_key = ?
               OR (o.idempotency_key >= ? AND o.idempotency_key < ?)
             )
           ORDER BY o.created_at, o.job_id`,
        )
        .all(baseKey, retryPrefix, upperBound) as { jobId: string }[];

      expect(matchedOutbox.map((r) => r.jobId)).toEqual([
        "job-1-base",
        "job-1-retry0",
        "job-1-retry1",
      ]);

      const ledgerRow = db
        .prepare(
          `SELECT COUNT(*) AS count FROM job_ledger
           WHERE kind = 'event_reminder'
             AND (
               idempotency_key = ?
               OR (idempotency_key >= ? AND idempotency_key < ?)
             )`,
        )
        .get(baseKey, retryPrefix, upperBound);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query inspection
      const ledgerCount = (ledgerRow as { count: number }).count;

      expect(ledgerCount).toBe(3);
    });
  });
});

it("uses the pending-job index to select only jobs that are due", () => {
  const db = seedDatabase();
  try {
    const duePlan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT job_id FROM scheduled_job_outbox WHERE enqueued_at IS NULL AND due_at <= ? ORDER BY due_at, job_id LIMIT 10",
      )
      .all("2024-03-10T12:00:00Z");
    expect(
      duePlan.some(
        (row) =>
          typeof row.detail === "string" && row.detail.includes("idx_scheduled_job_outbox_pending"),
      ),
    ).toBe(true);
  } finally {
    db.close();
  }
});
