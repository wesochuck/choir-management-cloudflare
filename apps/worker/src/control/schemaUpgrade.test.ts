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
  {
    file: "0027_member_website_editor.sql",
    exercise: (db: DatabaseSync, upgrade: () => void) => {
      db.exec(`
        INSERT INTO organizations (id, slug, name, lifecycle_state, durable_object_key, created_at, updated_at)
          VALUES ('org', 'alpha', 'Alpha', 'active', 'org', '2026-01-01', '2026-01-01');
        INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
          VALUES ('user', 'Singer', 'singer@example.test', 1, 1, 1),
                 ('editor', 'Editor', 'editor@example.test', 1, 1, 1);
        INSERT INTO member (id, organizationId, userId, role, createdAt, profileId, lastActiveAt)
          VALUES ('member', 'org', 'user', 'member', 1, 'profile', 2);
        INSERT INTO invitation (id, organizationId, email, role, status, expiresAt, createdAt, inviterId)
          VALUES ('invite', 'org', 'editor@example.test', 'member', 'pending', 2, 1, 'user');
        INSERT INTO organization_roster_invite_links
          (id, organization_id, label, created_by_user_id, created_at, expires_at, nonce)
          VALUES ('link', 'org', 'Join', 'user', 1, 2, 'nonce');
        INSERT INTO organization_roster_invite_enrollments
          (id, organization_id, link_id, user_id, profile_id, membership_id, idempotency_key,
           request_digest, state, reservation_lease_expires_at, created_at, updated_at, canonical_profile_id, profile_mode)
          VALUES ('enrollment', 'org', 'link', 'user', 'profile', 'member', 'key', 'digest', 'completed', 2, 1, 1, 'profile', 'existing');
        INSERT INTO organization_profile_reconciliations
          (id, organization_id, membership_id, source_profile_id, target_profile_id, idempotency_key,
           state, preview_revision, request_digest, actor_user_id, created_at, updated_at, field_choices_json)
          VALUES ('reconcile', 'org', 'member', 'source', 'profile', 'key', 'completed', 'revision', 'digest', 'user', 1, 1, '{}');
      `);
      const readPrevious = () => [
        db.prepare("SELECT id, role, profileId, lastActiveAt FROM member").all(),
        db.prepare("SELECT * FROM invitation").all(),
        db.prepare("SELECT * FROM organization_roster_invite_enrollments").all(),
        db.prepare("SELECT * FROM organization_profile_reconciliations").all(),
      ];
      const prior = readPrevious();
      upgrade();
      expect(readPrevious()).toEqual(prior);
      db.exec(`
        UPDATE member SET websiteEditor = 1 WHERE id = 'member';
        UPDATE invitation SET role = 'website_editor' WHERE id = 'invite';
        INSERT INTO member (id, organizationId, userId, role, createdAt)
          VALUES ('editor', 'org', 'editor', 'website_editor', 1);
      `);
      expect(
        db.prepare("SELECT role, websiteEditor FROM member WHERE id = 'member'").get(),
      ).toEqual({ role: "member", websiteEditor: 1 });
      expect(() => {
        db.exec("UPDATE member SET profileId = 'other' WHERE id = 'editor'");
      }).toThrow();
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
