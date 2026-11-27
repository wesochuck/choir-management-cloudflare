import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { toSupportedValue } from "../organization/contactTestkit";
import {
  authorizeOrganization,
  authorizeOrganizationMember,
  MEMBER_ACTIVITY_TOUCH_INTERVAL_MS,
  type OrganizationAuthDatabase,
} from "./authorizeOrganization";

function readMemberLastActiveAt(raw: DatabaseSync, memberId: string): number | null {
  const row: unknown = raw.prepare("SELECT lastActiveAt FROM member WHERE id = ?").get(memberId);
  if (typeof row === "object" && row !== null && "lastActiveAt" in row) {
    return typeof row.lastActiveAt === "number" ? row.lastActiveAt : null;
  }
  return null;
}

function createControlD1Harness(): {
  readonly close: () => void;
  readonly database: OrganizationAuthDatabase;
  readonly raw: DatabaseSync;
} {
  const raw = new DatabaseSync(":memory:");
  const directory = new URL("../control/migrations/", import.meta.url);
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    raw.exec(readFileSync(new URL(file, directory), "utf8"));
  }

  const database: OrganizationAuthDatabase = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          const boundValues: SQLInputValue[] = values.map(toSupportedValue);
          return {
            first<T = Record<string, unknown>>() {
              const row = raw.prepare(query).get(...boundValues);
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Node SQLite test adapter mirrors D1's caller-declared row shape.
              return Promise.resolve((row ?? null) as T | null);
            },
            run() {
              const info = raw.prepare(query).run(...boundValues);
              return Promise.resolve({
                meta: { changes: Number(info.changes) },
                results: [],
                success: true,
              });
            },
          };
        },
      };
    },
  };

  return {
    close: () => {
      raw.close();
    },
    database,
    raw,
  };
}

describe("authorizeOrganization", () => {
  const membership = {
    active: true,
    mfaRequired: false,
    organizationId: "organization-alpha",
    profileLinked: true,
    role: "administrator",
    userId: "user-1",
  } as const;

  it("accepts a membership only for the host-resolved Organization", () => {
    expect(authorizeOrganization("organization-alpha", membership)).toEqual({
      ok: true,
      value: membership,
    });
  });

  it("rejects a membership from another Organization", () => {
    expect(authorizeOrganization("organization-bravo", membership)).toMatchObject({
      error: { code: "forbidden" },
      ok: false,
    });
  });
});

describe("authorizeOrganizationMember lastActiveAt tracking", () => {
  it("records org-scoped lastActiveAt, throttles updates within the window, and never touches other orgs", async () => {
    const harness = createControlD1Harness();
    try {
      const { database, raw } = harness;
      raw
        .prepare(
          `INSERT INTO organizations (id, slug, name, lifecycle_state, durable_object_key, created_at, updated_at, mfa_required)
           VALUES
             ('org-alpha', 'alpha', 'Alpha Choir', 'active', 'org-alpha', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0),
             ('org-bravo', 'bravo', 'Bravo Choir', 'active', 'org-bravo', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
           VALUES ('user-1', 'Singer One', 'singer@example.test', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO member (id, organizationId, userId, role, createdAt)
           VALUES
             ('mem-alpha', 'org-alpha', 'user-1', 'member', '2026-01-02T00:00:00.000Z'),
             ('mem-bravo', 'org-bravo', 'user-1', 'member', '2026-01-02T00:00:00.000Z')`,
        )
        .run();

      const t0 = new Date("2026-06-01T12:00:00.000Z");
      const first = await authorizeOrganizationMember(database, "org-alpha", "sess-1", "user-1", {
        now: t0,
      });
      expect(first.ok).toBe(true);

      expect(readMemberLastActiveAt(raw, "mem-alpha")).toBe(t0.getTime());
      expect(readMemberLastActiveAt(raw, "mem-bravo")).toBeNull();

      // Within the 15-minute throttle window, lastActiveAt does not rewrite.
      const tWithin = new Date(t0.getTime() + MEMBER_ACTIVITY_TOUCH_INTERVAL_MS - 1_000);
      await authorizeOrganizationMember(database, "org-alpha", "sess-1", "user-1", {
        now: tWithin,
      });
      expect(readMemberLastActiveAt(raw, "mem-alpha")).toBe(t0.getTime());

      // Once the throttle window elapses, lastActiveAt advances.
      const tLater = new Date(t0.getTime() + MEMBER_ACTIVITY_TOUCH_INTERVAL_MS);
      await authorizeOrganizationMember(database, "org-alpha", "sess-1", "user-1", {
        now: tLater,
      });
      expect(readMemberLastActiveAt(raw, "mem-alpha")).toBe(tLater.getTime());
    } finally {
      harness.close();
    }
  });

  it("does not stamp lastActiveAt when MFA is required and not yet satisfied", async () => {
    const harness = createControlD1Harness();
    try {
      const { database, raw } = harness;
      raw
        .prepare(
          `INSERT INTO organizations (id, slug, name, lifecycle_state, durable_object_key, created_at, updated_at, mfa_required)
           VALUES ('org-mfa', 'mfa', 'MFA Choir', 'active', 'org-mfa', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
           VALUES ('user-1', 'Admin One', 'admin@example.test', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO member (id, organizationId, userId, role, createdAt)
           VALUES ('mem-mfa', 'org-mfa', 'user-1', 'admin', '2026-01-02T00:00:00.000Z')`,
        )
        .run();

      const t0 = new Date("2026-06-01T12:00:00.000Z");
      const statusCheck = await authorizeOrganizationMember(
        database,
        "org-mfa",
        "sess-1",
        "user-1",
        { enforceMfa: false, now: t0 },
      );
      expect(statusCheck.ok).toBe(true);
      expect(readMemberLastActiveAt(raw, "mem-mfa")).toBeNull();
    } finally {
      harness.close();
    }
  });
});
