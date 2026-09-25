import { reset, runInDurableObject } from "cloudflare:test";
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
      name: "Job Ledger Index Test Organization",
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

describe("job_ledger.job_id index for outbox joins and reminder recovery (#68)", () => {
  it("proves new organizations start at schema version 95 with idx_job_ledger_job_id", async () => {
    const stub = await provisionOrganization("org-ledger-schema-version");
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const version = state.storage.sql
        .exec<{ version: number }>(
          "SELECT version FROM organization_schema_migrations ORDER BY version DESC LIMIT 1",
        )
        .one().version;
      expect(version).toBe(currentOrganizationSchemaVersion);
      expect(version).toBeGreaterThanOrEqual(95);

      const indexExists = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_job_ledger_job_id'",
        )
        .one().count;
      expect(indexExists).toBe(1);
    });
  });

  it("applies forward migration 95 cleanly to an existing populated organization store", async () => {
    const stub = await provisionOrganization("org-ledger-migration-upgrade");
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      // Simulate store at version 94 with existing job_ledger data
      state.storage.sql.exec("DROP INDEX IF EXISTS idx_job_ledger_job_id");
      state.storage.sql.exec("DELETE FROM organization_schema_migrations WHERE version >= 95");

      const now = new Date().toISOString();
      for (let i = 1; i <= 20; i++) {
        state.storage.sql.exec(
          `INSERT INTO job_ledger
            (idempotency_key, job_id, kind, status, attempt, claimed_at, completed_at)
           VALUES (?, ?, 'event_reminder', 'completed', 1, ?, ?)`,
          `idemp-pre-${String(i)}`,
          `job-pre-${String(i)}`,
          now,
          now,
        );
      }

      const migration95 = organizationSchemaMigrations.find((m) => m.version === 95);
      if (!migration95) throw new Error("Migration 95 not found");

      applyOrganizationMigration(state.storage, migration95);

      const version = state.storage.sql
        .exec<{ version: number }>(
          "SELECT version FROM organization_schema_migrations ORDER BY version DESC LIMIT 1",
        )
        .one().version;
      expect(version).toBe(95);

      const indexExists = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_job_ledger_job_id'",
        )
        .one().count;
      expect(indexExists).toBe(1);
    });
  });

  it("uses idx_job_ledger_job_id for outbox joins and direct lookups with bounded row reads", async () => {
    const orgId = "org-ledger-perf-test";
    const stub = await provisionOrganization(orgId);
    const now = new Date().toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      // Seed representative data: 60 historical job_ledger entries
      for (let i = 1; i <= 60; i++) {
        state.storage.sql.exec(
          `INSERT INTO job_ledger
            (idempotency_key, job_id, kind, status, attempt, claimed_at, completed_at)
           VALUES (?, ?, 'event_reminder', ?, 1, ?, ?)`,
          `idemp-hist-${String(i)}`,
          `job-hist-${String(i)}`,
          i % 2 === 0 ? "completed" : "failed",
          now,
          now,
        );
      }

      // Small pending outbox set (3 event_reminder jobs)
      for (let i = 1; i <= 3; i++) {
        state.storage.sql.exec(
          `INSERT INTO scheduled_job_outbox
            (job_id, kind, idempotency_key, due_at, created_at)
           VALUES (?, 'event_reminder', ?, ?, ?)`,
          `job-hist-${String(i)}`,
          `event-reminder:${orgId}:event-${String(i)}`,
          now,
          now,
        );
      }

      // 1. EXPLAIN QUERY PLAN for event-reminder outbox -> job_ledger join
      const joinPlanCursor = state.storage.sql.exec<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT o.job_id AS jobId, l.status, l.terminal_at AS terminalAt
         FROM scheduled_job_outbox o
         LEFT JOIN job_ledger l ON l.job_id = o.job_id
         WHERE o.kind = 'event_reminder'
         ORDER BY o.created_at, o.job_id`,
      );
      const joinPlan = joinPlanCursor.toArray();
      const joinDetails = joinPlan.map((p) => p.detail).join(" ");
      expect(joinDetails).toMatch(/USING INDEX idx_job_ledger_job_id/);
      expect(joinDetails).not.toMatch(/SCAN TABLE job_ledger/);

      // 2. EXPLAIN QUERY PLAN for direct lookup by job_id
      const directPlanCursor = state.storage.sql.exec<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT status, attempt, last_error_code
         FROM job_ledger
         WHERE job_id = ?`,
        "job-hist-1",
      );
      const directPlan = directPlanCursor.toArray();
      const directDetails = directPlan.map((p) => p.detail).join(" ");
      expect(directDetails).toMatch(/USING INDEX idx_job_ledger_job_id/);
      expect(directDetails).not.toMatch(/SCAN TABLE job_ledger/);

      // 3. Measure row-read bounding for the join:
      // With 60 ledger rows, joining 3 outbox rows should read only the matched index/table entries,
      // not scanning all 60 ledger entries.
      const execCursor = state.storage.sql.exec<{ jobId: string; status: string }>(
        `SELECT o.job_id AS jobId, l.status
         FROM scheduled_job_outbox o
         LEFT JOIN job_ledger l ON l.job_id = o.job_id
         WHERE o.kind = 'event_reminder'
         ORDER BY o.created_at, o.job_id`,
      );
      const results = execCursor.toArray();
      expect(results).toHaveLength(3);
      expect(execCursor.rowsRead).toBeLessThanOrEqual(15);
      expect(execCursor.rowsRead).toBeLessThan(60);

      // 4. Verify write tradeoff: status-only update does not mutate indexed job_id
      const updateCursor = state.storage.sql.exec(
        `UPDATE job_ledger SET status = 'completed', completed_at = ? WHERE idempotency_key = ?`,
        now,
        "idemp-hist-1",
      );
      expect(updateCursor.rowsWritten).toBe(1);
    });
  });
});
