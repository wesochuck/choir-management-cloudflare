import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("D1 profile reconciliations migrations", () => {
  it("applies forward-only schema migrations 0022-0023 cleanly over prior migrations", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const migrationDir = new URL("./migrations/", import.meta.url);
      const files = readdirSync(migrationDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      for (const file of files) {
        db.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"));
      }

      // Check organization_profile_reconciliations exists
      const tableInfo = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organization_profile_reconciliations'",
        )
        .all();
      expect(tableInfo.length).toBe(1);

      // Check canonical_profile_id column exists on organization_roster_invite_enrollments
      const cols = db.prepare("PRAGMA table_info(organization_roster_invite_enrollments)").all();
      expect(
        cols.some((c) => typeof c === "object" && "name" in c && c.name === "canonical_profile_id"),
      ).toBe(true);

      // Check indexes exist
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'organization_profile_reconciliations'",
        )
        .all();
      const indexNames = indexes.map((row) =>
        typeof row === "object" && "name" in row ? String(row.name) : "",
      );
      expect(indexNames).toContain("idx_profile_reconciliations_org_state");
      expect(indexNames).toContain("idx_profile_reconciliations_idempotency");

      const reconCols = db.prepare("PRAGMA table_info(organization_profile_reconciliations)").all();
      expect(
        reconCols.some(
          (c) => typeof c === "object" && "name" in c && c.name === "field_choices_json",
        ),
      ).toBe(true);
    } finally {
      db.close();
    }
  });
});
