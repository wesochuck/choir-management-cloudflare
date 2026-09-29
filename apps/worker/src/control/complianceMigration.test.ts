import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("expands email route kinds while preserving prior identities, states and constraints", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of ["0001_initial.sql", "0010_email_feedback.sql"]) {
      db.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"));
    }
    for (const state of ["pending", "accepted", "unknown"]) {
      db.prepare(
        `INSERT INTO email_provider_routes
        (id, provider, source_kind, source_id, destination, provider_message_id,
         state, created_at, accepted_at, updated_at)
        VALUES (?, 'cloudflare_email', 'platform_auth', ?, 'owner@example.test', ?, ?, 'created', ?, 'updated')`,
      ).run(
        state,
        state,
        state === "accepted" ? "provider-id" : null,
        state,
        state === "accepted" ? "accepted-at" : null,
      );
    }
    const before = db.prepare("SELECT * FROM email_provider_routes ORDER BY id").all();
    db.exec(
      readFileSync(
        new URL("./migrations/0021_compliance_email_routes.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(db.prepare("SELECT * FROM email_provider_routes ORDER BY id").all()).toEqual(before);
    const insert = db.prepare(`INSERT INTO email_provider_routes
      (id, provider, source_kind, source_id, destination, state, created_at, updated_at)
      VALUES (?, 'cloudflare_email', ?, ?, 'owner@example.test', 'pending', 'created', 'updated')`);
    expect(() =>
      insert.run("compliance", "compliance_reminder", "occurrence-recipient"),
    ).not.toThrow();
    expect(() => insert.run("duplicate", "compliance_reminder", "occurrence-recipient")).toThrow(
      /UNIQUE/,
    );
    expect(() => insert.run("invalid", "invalid_kind", "invalid")).toThrow(/CHECK/);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'email_provider_routes'",
        )
        .all(),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "email_provider_routes_provider_message_id" }),
        expect.objectContaining({ name: "email_provider_routes_pending" }),
      ]),
    );
  } finally {
    db.close();
  }
});
