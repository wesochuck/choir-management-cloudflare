import { z } from "zod";
import {
  organizationNotificationReadAllResponseSchema,
  organizationNotificationReadResponseSchema,
  organizationNotificationsResponseSchema,
  organizationProfileResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import { insertNotificationReceipt } from "../src/organization/notificationInboxStore";

const USER_EMAIL = "member.notifications@example.test";
const OTHER_USER_EMAIL = "other.member@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const write = (host: string, path: string, cookie: string, body: unknown, method = "POST") =>
  writeJson(exports.default, host, path, cookie, body, method);
const api = organizationRequest;

const provision = (id: string, slug: string) =>
  provisionOrganization(database, stores, { id, slug, userId: "notifications-admin-user" });

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "notifications-admin-user", "admin@example.test", "Admin User");
  await seedAuthUser(database, "notifications-member-user", USER_EMAIL, "Notification Singer");
  await seedAuthUser(database, "other-member-user", OTHER_USER_EMAIL, "Other Singer");
  await provision("organization-alpha", "alpha");
});

afterEach(async () => {
  await reset();
});

describe("member notifications route integration", () => {
  it("authorizes personal inbox reads, sets private no-store, and marks read", async () => {
    // 1. Sign in as admin to create profiles and link members
    const adminCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      "admin@example.test",
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );

    const profileResponse1 = await write(
      "alpha.localhost",
      "/api/organization/profiles",
      adminCookie,
      {
        displayName: "Notification Singer",
        phone: "555-0101",
      },
    );
    const profile1 = organizationProfileResponseSchema.parse(await profileResponse1.json());

    const profileResponse2 = await write(
      "alpha.localhost",
      "/api/organization/profiles",
      adminCookie,
      {
        displayName: "Other Singer",
        phone: "555-0102",
      },
    );
    const profile2 = organizationProfileResponseSchema.parse(await profileResponse2.json());

    // Link user to profile1
    await database
      .prepare(
        "INSERT INTO member (id, organizationId, userId, role, profileId, createdAt) VALUES (?, ?, ?, 'member', ?, datetime('now'))",
      )
      .bind(crypto.randomUUID(), "organization-alpha", "notifications-member-user", profile1.id)
      .run();

    // Link other user to profile2
    await database
      .prepare(
        "INSERT INTO member (id, organizationId, userId, role, profileId, createdAt) VALUES (?, ?, ?, 'member', ?, datetime('now'))",
      )
      .bind(crypto.randomUUID(), "organization-alpha", "other-member-user", profile2.id)
      .run();

    // 2. Insert notifications in store for profile1 and profile2
    const storeStub = stores.get(stores.idFromName("organization-alpha"));
    const notice1Id = await runInDurableObject(storeStub, (_instance, state) => {
      const now = new Date().toISOString();
      insertNotificationReceipt(state.storage, {
        body: "You received a new donation of $50.00.",
        destinationPath: "/admin/donations",
        kind: "donation",
        now,
        originalOccurredAt: now,
        recipientProfileId: profile1.id,
        sourceKey: "donation:1",
        title: "Donation: John Donor",
      });
      const rows = state.storage.sql
        .exec<{ readonly id: string }>(
          "SELECT id FROM notification_receipts WHERE source_key = 'donation:1'",
        )
        .toArray();
      const firstRow = rows.at(0);
      expect(firstRow).toBeDefined();
      return firstRow?.id ?? "";
    });

    await runInDurableObject(storeStub, (_instance, state) => {
      const now = new Date().toISOString();
      insertNotificationReceipt(state.storage, {
        body: "Notice for other user.",
        destinationPath: "/admin/tickets",
        kind: "ticket_sale",
        now,
        originalOccurredAt: now,
        recipientProfileId: profile2.id,
        sourceKey: "ticket:1",
        title: "Ticket sale: Concert",
      });
    });

    // 3. Sign in as member-user
    const memberCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      USER_EMAIL,
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );

    // 4. GET /api/notifications
    const listResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/notifications", memberCookie),
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("cache-control")).toBe("private, no-store");

    const listData = organizationNotificationsResponseSchema.parse(await listResponse.json());
    expect(listData.unreadCount).toBe(1);
    expect(listData.notifications).toHaveLength(1);
    const firstNotice = listData.notifications.at(0);
    expect(firstNotice?.id).toBe(notice1Id);
    expect(firstNotice?.title).toBe("Donation: John Donor");
    expect(firstNotice?.readAt).toBeNull();

    // 5. POST /api/notifications/:id/read
    const readResponse = await write(
      "alpha.localhost",
      `/api/notifications/${notice1Id}/read`,
      memberCookie,
      {},
    );
    expect(readResponse.status).toBe(200);
    const readData = organizationNotificationReadResponseSchema.parse(await readResponse.json());
    expect(readData.success).toBe(true);
    expect(readData.notification.readAt).toBeTruthy();

    // Verify unread count is now 0
    const listAfterRead = await exports.default.fetch(
      api("alpha.localhost", "/api/notifications", memberCookie),
    );
    const listAfterData = organizationNotificationsResponseSchema.parse(await listAfterRead.json());
    expect(listAfterData.unreadCount).toBe(0);
    expect(listAfterData.notifications.at(0)?.readAt).toBeTruthy();

    // 6. Member cannot read other member's notification (404)
    const otherStoreNoticeId = await runInDurableObject(storeStub, (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ readonly id: string }>(
          "SELECT id FROM notification_receipts WHERE source_key = 'ticket:1'",
        )
        .toArray();
      const firstOther = rows.at(0);
      expect(firstOther).toBeDefined();
      return firstOther?.id ?? "";
    });

    const crossReadResponse = await write(
      "alpha.localhost",
      `/api/notifications/${otherStoreNoticeId}/read`,
      memberCookie,
      {},
    );
    expect(crossReadResponse.status).toBe(404);
  });

  it("marks all notifications as read up to the server boundary", async () => {
    const adminCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      "admin@example.test",
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );

    const profileResponse = await write(
      "alpha.localhost",
      "/api/organization/profiles",
      adminCookie,
      {
        displayName: "Notification Singer 2",
        phone: "555-0202",
      },
    );
    const profile = organizationProfileResponseSchema.parse(await profileResponse.json());

    await database
      .prepare(
        "INSERT INTO member (id, organizationId, userId, role, profileId, createdAt) VALUES (?, ?, ?, 'member', ?, datetime('now'))",
      )
      .bind(crypto.randomUUID(), "organization-alpha", "notifications-member-user", profile.id)
      .run();

    const storeStub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject(storeStub, (_instance, state) => {
      const t1 = "2026-10-01T10:00:00.000Z";
      const t2 = "2026-10-01T11:00:00.000Z";
      insertNotificationReceipt(state.storage, {
        body: "Inquiry 1",
        destinationPath: "/admin/auditions",
        kind: "audition",
        now: t1,
        originalOccurredAt: t1,
        recipientProfileId: profile.id,
        sourceKey: "audition:1",
        title: "Audition inquiry 1",
      });
      insertNotificationReceipt(state.storage, {
        body: "Inquiry 2",
        destinationPath: "/admin/auditions",
        kind: "audition",
        now: t2,
        originalOccurredAt: t2,
        recipientProfileId: profile.id,
        sourceKey: "audition:2",
        title: "Audition inquiry 2",
      });
    });

    const memberCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      USER_EMAIL,
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );

    const listRes = await exports.default.fetch(
      api("alpha.localhost", "/api/notifications", memberCookie),
    );
    const listData = organizationNotificationsResponseSchema.parse(await listRes.json());
    expect(listData.unreadCount).toBe(2);

    // Call read-all with boundary
    const readAllRes = await write("alpha.localhost", "/api/notifications/read-all", memberCookie, {
      boundary: listData.snapshotBoundary,
    });
    expect(readAllRes.status).toBe(200);
    const readAllData = organizationNotificationReadAllResponseSchema.parse(
      await readAllRes.json(),
    );
    expect(readAllData.markedCount).toBe(2);

    // Verify unread count is now 0
    const listAfterRes = await exports.default.fetch(
      api("alpha.localhost", "/api/notifications", memberCookie),
    );
    const listAfterData = organizationNotificationsResponseSchema.parse(await listAfterRes.json());
    expect(listAfterData.unreadCount).toBe(0);
  });

  it("fails closed when impersonating or when member has no linked profile", async () => {
    const adminCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      "admin@example.test",
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );

    // Create profile
    const profileRes = await write("alpha.localhost", "/api/organization/profiles", adminCookie, {
      displayName: "Target Singer",
      phone: "555-0303",
    });
    const targetProfile = organizationProfileResponseSchema.parse(await profileRes.json());

    // 1. Member with no linked profile gets 403
    await database
      .prepare(
        "INSERT INTO member (id, organizationId, userId, role, profileId, createdAt) VALUES (?, ?, ?, 'member', NULL, datetime('now'))",
      )
      .bind(crypto.randomUUID(), "organization-alpha", "notifications-member-user")
      .run();

    const memberCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      USER_EMAIL,
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );

    const unlinkedRes = await exports.default.fetch(
      api("alpha.localhost", "/api/notifications", memberCookie),
    );
    expect(unlinkedRes.status).toBe(403);
    const unlinkedJson = z.object({ code: z.string() }).parse(await unlinkedRes.json());
    expect(unlinkedJson.code).toBe("forbidden");

    // 2. Admin attempts to impersonate target profile and access notifications -> 403
    const startImpersonationRes = await write(
      "alpha.localhost",
      "/api/organization/impersonation",
      adminCookie,
      { profileId: targetProfile.id },
    );
    expect(startImpersonationRes.status).toBe(200);
    const setCookie = startImpersonationRes.headers.get("set-cookie") ?? "";
    const impersonationToken = setCookie.split(";")[0] ?? "";
    const combinedCookie = `${adminCookie}; ${impersonationToken}`;

    const impersonatedRes = await exports.default.fetch(
      api("alpha.localhost", "/api/notifications", combinedCookie),
    );
    expect(impersonatedRes.status).toBe(403);
    const impersonatedJson = z.object({ code: z.string() }).parse(await impersonatedRes.json());
    expect(impersonatedJson.code).toBe("forbidden");
  });
});
