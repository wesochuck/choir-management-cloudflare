import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { toSupportedValue } from "./contactTestkit";
import {
  composeOrganizationProfileActivity,
  readOrganizationProfilePortalActivity,
  type PortalActivityDatabase,
} from "./profileActivity";
import type { ProfileActivityStoreData } from "./profileActivityStore";

function createControlDbHarness(): {
  readonly close: () => void;
  readonly database: PortalActivityDatabase;
  readonly raw: DatabaseSync;
} {
  const raw = new DatabaseSync(":memory:");
  for (const file of [
    "0001_initial.sql",
    "0002_better_auth.sql",
    "0003_provisioning.sql",
    "0004_organization_mfa.sql",
    "0005_profile_link.sql",
    "0008_integer_timestamps.sql",
    "0017_organization_roster_invite_links.sql",
    "0018_passkey_authentication.sql",
    "0024_roster_invite_profile_mode.sql",
    "0026_member_last_active_at.sql",
  ]) {
    raw.exec(readFileSync(new URL(`../control/migrations/${file}`, import.meta.url), "utf8"));
  }

  const database: PortalActivityDatabase = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          const boundValues: SQLInputValue[] = values.map(toSupportedValue);
          return {
            all() {
              const rows: unknown[] = raw.prepare(query).all(...boundValues);
              return Promise.resolve({ results: rows });
            },
            first() {
              const row: unknown = raw.prepare(query).get(...boundValues);
              return Promise.resolve(row ?? null);
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

describe("readOrganizationProfilePortalActivity", () => {
  const profileId = "11111111-1111-4111-8111-111111111111";

  it("reads org-scoped lastActiveAt, auth readiness, and invite-link enrollment without cross-org leakage", async () => {
    const harness = createControlDbHarness();
    try {
      const { database, raw } = harness;
      raw
        .prepare(
          `INSERT INTO organizations (id, slug, name, lifecycle_state, durable_object_key, created_at, updated_at)
           VALUES
             ('org-alpha', 'alpha', 'Alpha Choir', 'active', 'org-alpha', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
             ('org-bravo', 'bravo', 'Bravo Choir', 'active', 'org-bravo', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
           VALUES ('user-1', 'John Long', 'john@example.test', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
           VALUES ('user-admin', 'Admin', 'admin@example.test', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      const alphaLastActive = new Date("2026-06-10T15:00:00.000Z").getTime();
      const bravoLastActive = new Date("2026-06-12T18:00:00.000Z").getTime();
      raw
        .prepare(
          `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId, lastActiveAt)
           VALUES
             ('mem-alpha', 'org-alpha', 'user-1', 'member', '2026-01-15T12:00:00.000Z', ?, ?),
             ('mem-bravo', 'org-bravo', 'user-1', 'admin', '2026-02-01T12:00:00.000Z', ?, ?)`,
        )
        .run(profileId, alphaLastActive, profileId, bravoLastActive);
      raw
        .prepare(
          `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
           VALUES
             ('acc-1', 'user-1', 'credential', 'user-1', 'hashed-pw', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
             ('acc-2', 'google-1', 'google', 'user-1', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, createdAt)
           VALUES ('pk-1', 'MacBook', 'pub', 'user-1', 'cred-1', 1, 'multiDevice', 1, 1780000000000)`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO organization_roster_invite_links
            (id, organization_id, label, created_by_user_id, created_at, expires_at, nonce)
           VALUES ('link-1', 'org-alpha', 'Spring Invite', 'user-admin', 1770000000000, 1790000000000, 'nonce-1')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO organization_roster_invite_enrollments
            (id, organization_id, link_id, user_id, profile_id, membership_id, idempotency_key, request_digest, state, reservation_lease_expires_at, created_at, updated_at)
           VALUES ('enr-1', 'org-alpha', 'link-1', 'user-1', ?, 'mem-alpha', 'idem-1', 'digest-1', 'completed', 1780000000000, 1770000001000, 1770000002000)`,
        )
        .run(profileId);

      const alphaResult = await readOrganizationProfilePortalActivity(database, {
        contactEmail: "john@example.test",
        organizationId: "org-alpha",
        profileId,
      });

      expect(alphaResult.linkedUserId).toBe("user-1");
      expect(alphaResult.portal).toEqual({
        emailVerified: true,
        hasGoogleAccount: true,
        hasPassword: true,
        joinedAt: "2026-01-15T12:00:00.000Z",
        joinedViaInviteLink: true,
        lastActiveAt: "2026-06-10T15:00:00.000Z",
        linked: true,
        passkeyCount: 1,
        pendingInvitation: null,
        role: "member",
        twoFactorEnabled: true,
      });

      const bravoResult = await readOrganizationProfilePortalActivity(database, {
        contactEmail: "john@example.test",
        organizationId: "org-bravo",
        profileId,
      });
      expect(bravoResult.portal.lastActiveAt).toBe("2026-06-12T18:00:00.000Z");
      expect(bravoResult.portal.role).toBe("administrator");
      expect(bravoResult.portal.joinedViaInviteLink).toBe(false);
    } finally {
      harness.close();
    }
  });

  it("returns active pending invitation for unlinked profiles and ignores expired or other-org invites", async () => {
    const harness = createControlDbHarness();
    try {
      const { database, raw } = harness;
      raw
        .prepare(
          `INSERT INTO organizations (id, slug, name, lifecycle_state, durable_object_key, created_at, updated_at)
           VALUES
             ('org-alpha', 'alpha', 'Alpha Choir', 'active', 'org-alpha', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
             ('org-bravo', 'bravo', 'Bravo Choir', 'active', 'org-bravo', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
           VALUES ('user-admin', 'Admin', 'admin@example.test', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO invitation (id, organizationId, email, role, status, expiresAt, createdAt, inviterId)
           VALUES
             ('inv-expired', 'org-alpha', 'unlinked@example.test', 'member', 'pending', '2026-05-01T00:00:00.000Z', '2026-04-20T00:00:00.000Z', 'user-admin'),
             ('inv-active', 'org-alpha', 'Unlinked@Example.Test', 'admin', 'pending', '2026-06-20T00:00:00.000Z', '2026-06-12T00:00:00.000Z', 'user-admin'),
             ('inv-other', 'org-bravo', 'unlinked@example.test', 'owner', 'pending', '2026-06-25T00:00:00.000Z', '2026-06-13T00:00:00.000Z', 'user-admin')`,
        )
        .run();

      const result = await readOrganizationProfilePortalActivity(database, {
        contactEmail: "unlinked@example.test",
        now: new Date("2026-06-15T00:00:00.000Z"),
        organizationId: "org-alpha",
        profileId,
      });

      expect(result.linkedUserId).toBeNull();
      expect(result.portal.linked).toBe(false);
      expect(result.portal.pendingInvitation).toEqual({
        createdAt: "2026-06-12T00:00:00.000Z",
        expiresAt: "2026-06-20T00:00:00.000Z",
        role: "administrator",
      });
    } finally {
      harness.close();
    }
  });
});

describe("composeOrganizationProfileActivity", () => {
  it("merges portal and profile milestones, resolves actor types, and sorts newest first", () => {
    const storeData: ProfileActivityStoreData = {
      attendance: {
        lastAttendedEvent: null,
        recentRehearsals: { absentCount: 0, pendingCount: 0, presentCount: 0, totalCount: 0 },
      },
      emailHealth: {
        bounceReason: "",
        doNotEmail: false,
        lastBounceAt: null,
        lastDeliveredAt: null,
        providerEmailSuppressed: false,
      },
      lastPollResponseAt: null,
      lastRsvpResponseAt: "2026-06-05T14:00:00.000Z",
      primaryContactEmail: "john@example.test",
      profileCreatedAt: "2026-01-10T10:00:00.000Z",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileUpdatedAt: "2026-06-05T14:00:00.000Z",
      timeline: [
        {
          actorId: "user-1",
          actorType: "organization_member",
          automatic: false,
          detail: "Pending → Yes",
          id: "rsvp:1",
          kind: "rsvp_change",
          occurredAt: "2026-06-05T14:00:00.000Z",
          title: "RSVP updated for Spring Concert",
        },
        {
          actorId: "user-admin",
          actorType: "organization_member",
          automatic: false,
          detail: "Manual override",
          id: "status:1",
          kind: "status_change",
          occurredAt: "2026-06-06T12:00:00.000Z",
          title: "Status changed to Active",
        },
        {
          actorId: "",
          actorType: "system",
          automatic: true,
          detail: "Automatic rule",
          id: "status:2",
          kind: "status_change",
          occurredAt: "2026-06-04T12:00:00.000Z",
          title: "Status changed to On Break",
        },
      ],
    };

    const composed = composeOrganizationProfileActivity({
      linkedUserId: "user-1",
      portal: {
        emailVerified: true,
        hasGoogleAccount: false,
        hasPassword: true,
        joinedAt: "2026-01-15T12:00:00.000Z",
        joinedViaInviteLink: false,
        lastActiveAt: "2026-06-10T15:00:00.000Z",
        linked: true,
        passkeyCount: 0,
        pendingInvitation: null,
        role: "member",
        twoFactorEnabled: false,
      },
      requestId: "33333333-3333-4333-8333-333333333333",
      storeData,
    });

    expect(composed.timeline.map((item) => [item.id, item.actorType])).toEqual([
      ["status:1", "administrator"],
      ["rsvp:1", "member"],
      ["status:2", "system"],
      ["portal_joined", "member"],
      ["profile_created", null],
    ]);
  });
});
