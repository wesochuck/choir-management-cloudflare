import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createContactTestAdapter, DEFAULT_CONTACT_TEST_ORG_ID } from "../contactTestkit";
import { organizationSchemaMigrations } from "./migrations";

function setupThrough(version: number): ReturnType<typeof createContactTestAdapter> {
  const db = new DatabaseSync(":memory:");
  const adapter = createContactTestAdapter(db);
  // Statements only: seed apply() callbacks populate template content that
  // this migration-shape test does not need.
  adapter.storage.transactionSync(() => {
    for (const migration of organizationSchemaMigrations) {
      if (migration.version > version) break;
      for (const statement of migration.statements) {
        adapter.storage.sql.exec(statement);
      }
    }
  });
  adapter.storage.sql.exec(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, timezone, created_at, updated_at)
     VALUES (?, 'Test Choir', 'test-choir', 'America/New_York', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    DEFAULT_CONTACT_TEST_ORG_ID,
  );
  return adapter;
}

function applyVersion(adapter: ReturnType<typeof createContactTestAdapter>, version: number): void {
  const migration = organizationSchemaMigrations.find((entry) => entry.version === version);
  expect(migration).toBeDefined();
  adapter.storage.transactionSync(() => {
    for (const statement of migration?.statements ?? []) {
      adapter.storage.sql.exec(statement);
    }
  });
}

function readTaskApplicable(
  adapter: ReturnType<typeof createContactTestAdapter>,
  id: string,
): number | null {
  const rows = adapter.storage.sql
    .exec<{ readonly applicable: number }>(
      "SELECT applicable FROM organization_compliance_tasks WHERE id = ?",
      id,
    )
    .toArray();
  return rows[0]?.applicable ?? null;
}

describe("organization schema migrations", () => {
  it("v106 clamps legacy applicable values outside 0/1 instead of failing the DO barrier", () => {
    const adapter = setupThrough(105);
    adapter.storage.sql.exec(
      `INSERT INTO organization_compliance_tasks
        (id, kind, title, applicable, recurrence_months, next_due_date,
         last_completed_date, next_reminder_at, reminder_interval_days,
         created_at, updated_at)
       VALUES
         ('legacy-dirty', 'dirty_kind', 'Dirty', 2, 12, NULL, NULL, NULL, 7,
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
         ('legacy-clean', 'clean_kind', 'Clean', 1, 12, NULL, NULL, NULL, 7,
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );

    applyVersion(adapter, 106);

    // Readers treat only 1 as applicable, so clamping anything else to 0
    // preserves every existing read while satisfying the new CHECK.
    expect(readTaskApplicable(adapter, "legacy-dirty")).toBe(0);
    expect(readTaskApplicable(adapter, "legacy-clean")).toBe(1);
  });

  it("v106 succeeds when tasks have existing completions under enforced foreign keys", () => {
    const adapter = setupThrough(105);
    adapter.db.exec("PRAGMA foreign_keys = ON");
    adapter.storage.sql.exec(
      `INSERT INTO organization_compliance_tasks
        (id, kind, title, applicable, recurrence_months, next_due_date,
         last_completed_date, next_reminder_at, reminder_interval_days,
         created_at, updated_at)
       VALUES
         ('task-1', 'kind_1', 'Task 1', 1, 12, NULL, NULL, NULL, 7,
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    adapter.storage.sql.exec(
      `INSERT INTO organization_compliance_completions
        (id, task_id, cycle_due_date, completed_date, completed_by_user_id, created_at)
       VALUES
         ('comp-1', 'task-1', '2026-01-01', '2026-01-01', 'user-1', '2026-01-01T00:00:00Z')`,
    );

    expect(() => {
      applyVersion(adapter, 106);
    }).not.toThrow();
  });
});
