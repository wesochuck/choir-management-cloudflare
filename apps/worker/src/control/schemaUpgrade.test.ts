import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const migrationDirectory = new URL("./migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const baseline = "0025_checkout_reminder_email_routes.sql";

const populatedUpgrades = [
  {
    file: "0026_member_last_active_at.sql",
    exercise: (db: DatabaseSync, upgrade: () => void) => {
      const date = "2026-01-01T00:00:00.000Z";
      db.prepare(
        `INSERT INTO organizations (id, slug, name, lifecycle_state, durable_object_key, created_at, updated_at)
         VALUES ('org-1', 'alpha', 'Alpha Choir', 'active', 'org-1', ?, ?)`,
      ).run(date, date);
      db.prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES ('user-1', 'Singer One', 'singer@example.test', 1, ?, ?)`,
      ).run(date, date);
      db.prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
         VALUES ('mem-1', 'org-1', 'user-1', 'member', ?, '11111111-1111-4111-8111-111111111111')`,
      ).run(date);

      // The membership projection used by code that predates lastActiveAt.
      const readMembership = () =>
        db
          .prepare("SELECT id, organizationId, profileId, userId, role FROM member WHERE id = ?")
          .get("mem-1");
      const membership = readMembership();
      expect(membership).toEqual({
        id: "mem-1",
        organizationId: "org-1",
        profileId: "11111111-1111-4111-8111-111111111111",
        role: "member",
        userId: "user-1",
      });

      upgrade();

      const readActivity = () =>
        db.prepare("SELECT lastActiveAt FROM member WHERE id = ?").get("mem-1");
      expect(readActivity()).toEqual({ lastActiveAt: null });
      const timestamp = 1_780_000_000_000;
      db.prepare("UPDATE member SET lastActiveAt = ? WHERE id = ?").run(timestamp, "mem-1");
      expect(readActivity()).toEqual({ lastActiveAt: timestamp });
      expect(readMembership()).toEqual(membership);
    },
  },
];

it("requires a populated upgrade and prior-schema compatibility case for each new D1 migration", () => {
  expect(migrationFiles).toContain(baseline);
  expect(migrationFiles.filter((file) => file > baseline)).toEqual(
    populatedUpgrades.map(({ file }) => file),
  );
});

it.each(populatedUpgrades)(
  "upgrades populated control-plane data with $file",
  ({ file, exercise }) => {
    const db = new DatabaseSync(":memory:");
    try {
      const apply = (name: string): void => {
        db.exec(readFileSync(new URL(name, migrationDirectory), "utf8"));
      };
      for (const migration of migrationFiles) {
        if (migration >= file) break;
        apply(migration);
      }
      exercise(db, () => {
        apply(file);
      });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  },
);
