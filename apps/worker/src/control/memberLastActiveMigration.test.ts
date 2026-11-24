import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("adds nullable lastActiveAt to member while preserving existing memberships", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of [
      "0001_initial.sql",
      "0002_better_auth.sql",
      "0003_provisioning.sql",
      "0004_organization_mfa.sql",
      "0005_profile_link.sql",
      "0008_integer_timestamps.sql",
      "0018_passkey_authentication.sql",
    ]) {
      db.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"));
    }

    db.prepare(
      `INSERT INTO organizations (id, slug, name, lifecycle_state, durable_object_key, created_at, updated_at)
       VALUES ('org-1', 'alpha', 'Alpha Choir', 'active', 'org-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-1', 'Singer One', 'singer@example.test', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
       VALUES ('mem-1', 'org-1', 'user-1', 'member', '2026-01-02T00:00:00.000Z', '11111111-1111-4111-8111-111111111111')`,
    ).run();

    db.exec(
      readFileSync(new URL("./migrations/0026_member_last_active_at.sql", import.meta.url), "utf8"),
    );

    const beforeUpdate = db
      .prepare(
        "SELECT id, organizationId, userId, profileId, lastActiveAt FROM member WHERE id = ?",
      )
      .get("mem-1");
    expect(beforeUpdate).toEqual({
      id: "mem-1",
      lastActiveAt: null,
      organizationId: "org-1",
      profileId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
    });

    const timestamp = 1_780_000_000_000;
    db.prepare("UPDATE member SET lastActiveAt = ? WHERE id = ?").run(timestamp, "mem-1");
    const afterUpdate = db.prepare("SELECT lastActiveAt FROM member WHERE id = ?").get("mem-1");
    expect(afterUpdate).toEqual({ lastActiveAt: timestamp });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
