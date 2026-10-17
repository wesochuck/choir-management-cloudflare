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
  it("v115 adds empty footer defaults while preserving a populated website draft", () => {
    const adapter = setupThrough(114);
    adapter.storage.sql.exec(
      "UPDATE public_website_settings SET hero_headline = 'Existing choir' WHERE singleton = 1",
    );
    applyVersion(adapter, 115);
    const row = adapter.storage.sql
      .exec<{ hero_headline: string; footer_text: string; footer_embeds_json: string }>(
        "SELECT hero_headline, footer_text, footer_embeds_json FROM public_website_settings WHERE singleton = 1",
      )
      .toArray()
      .at(0);
    expect(row).toEqual({
      hero_headline: "Existing choir",
      footer_text: "",
      footer_embeds_json: "[]",
    });
  });
  it("v112 expands existing music rows and cleans saved movement references on reparent and delete", () => {
    const adapter = setupThrough(111);
    for (const [id, parentId] of [
      ["parent", null],
      ["child-a", "parent"],
      ["child-b", "parent"],
    ]) {
      adapter.storage.sql.exec(
        "INSERT INTO music_pieces (id, title, parent_id, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01', '2026-01-01')",
        id,
        id,
        parentId,
      );
    }
    applyVersion(adapter, 112);
    const order = () =>
      adapter.storage.sql
        .exec<{ readonly value: string }>(
          "SELECT movement_order_json AS value FROM music_pieces WHERE id = 'parent'",
        )
        .toArray()
        .at(0)?.value ?? "null";
    expect(JSON.parse(order())).toEqual([]);
    adapter.storage.sql.exec(
      "UPDATE music_pieces SET movement_order_json = ? WHERE id = 'parent'",
      JSON.stringify(["child-b", "child-a"]),
    );
    adapter.storage.sql.exec("UPDATE music_pieces SET parent_id = NULL WHERE id = 'child-a'");
    expect(JSON.parse(order())).toEqual(["child-b"]);
    adapter.storage.sql.exec("DELETE FROM music_pieces WHERE id = 'child-b'");
    expect(JSON.parse(order())).toEqual([]);
  });
  it("v107 carries the Ohio backfill on the migration path", () => {
    const versions = organizationSchemaMigrations.map((entry) => entry.version);
    expect(versions).toEqual([...versions].sort((left, right) => left - right));
    const v107 = organizationSchemaMigrations.find((entry) => entry.version === 107);
    expect(v107?.statements).toEqual([]);
    expect(typeof v107?.apply).toBe("function");
  });

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

  it("v111 migration is registered forward-only with apply hook", () => {
    const versions = organizationSchemaMigrations.map((entry) => entry.version);
    expect(versions).toEqual([...versions].sort((left, right) => left - right));
    const v111 = organizationSchemaMigrations.find((entry) => entry.version === 111);
    expect(v111?.statements).toEqual([]);
    expect(typeof v111?.apply).toBe("function");
  });
});
