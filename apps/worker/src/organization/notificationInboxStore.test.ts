import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createContactTestAdapter, DEFAULT_CONTACT_TEST_ORG_ID } from "./contactTestkit";
import {
  cleanupExpiredNotificationReceipts,
  insertNotificationReceipt,
  listNotificationReceipts,
  markAllNotificationReceiptsRead,
  markNotificationReceiptRead,
  NOTIFICATION_RETENTION_MS,
} from "./notificationInboxStore";
import { organizationSchemaMigrations } from "./schema/migrations";

function setupStoreTestDb(): ReturnType<typeof createContactTestAdapter> {
  const db = new DatabaseSync(":memory:");
  const adapter = createContactTestAdapter(db);
  for (const migration of organizationSchemaMigrations) {
    for (const statement of migration.statements) {
      adapter.storage.sql.exec(statement);
    }
  }
  adapter.storage.sql.exec(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, timezone, created_at, updated_at, inbox_start_at)
     VALUES (?, 'Test Choir', 'test-choir', 'America/New_York', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-06-01T00:00:00.000Z')`,
    DEFAULT_CONTACT_TEST_ORG_ID,
  );
  return adapter;
}

const profile1 = "11111111-1111-4111-8111-111111111111";
const profile2 = "22222222-2222-4222-8222-222222222222";

function seedProfiles(adapter: ReturnType<typeof createContactTestAdapter>) {
  adapter.storage.sql.exec(
    `INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES
     (?, 'Alice', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
     (?, 'Bob', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    profile1,
    profile2,
  );
}

describe("notificationInboxStore", () => {
  it("rejects pre-launch and already expired notices", () => {
    const adapter = setupStoreTestDb();
    seedProfiles(adapter);

    // Pre-launch (inbox_start_at is 2026-06-01T00:00:00.000Z)
    const preLaunchInserted = insertNotificationReceipt(adapter.storage, {
      body: "Old notice",
      destinationPath: "/admin/auditions",
      kind: "audition",
      originalOccurredAt: "2026-05-01T00:00:00.000Z",
      recipientProfileId: profile1,
      sourceKey: "audition-old-1",
      title: "Old inquiry",
    });
    expect(preLaunchInserted).toBe(false);

    // Already expired (originalOccurredAt was >90 days before now)
    const expiredInserted = insertNotificationReceipt(adapter.storage, {
      body: "Expired notice",
      destinationPath: "/admin/tickets",
      kind: "ticket_sale",
      now: "2026-11-01T00:00:00.000Z",
      originalOccurredAt: "2026-06-01T00:00:00.000Z", // > 90 days before Nov 1
      recipientProfileId: profile1,
      sourceKey: "ticket-expired-1",
      title: "Expired ticket sale",
    });
    expect(expiredInserted).toBe(false);

    // Valid post-launch notice
    const validInserted = insertNotificationReceipt(adapter.storage, {
      body: "Valid notice",
      destinationPath: "/admin/donations",
      kind: "donation",
      now: "2026-07-01T00:00:00.000Z",
      originalOccurredAt: "2026-06-15T00:00:00.000Z",
      recipientProfileId: profile1,
      sourceKey: "donation-valid-1",
      title: "Valid donation",
    });
    expect(validInserted).toBe(true);
  });

  it("enforces deduplication per recipient profile and source key", () => {
    const adapter = setupStoreTestDb();
    seedProfiles(adapter);

    const first = insertNotificationReceipt(adapter.storage, {
      body: "First try",
      destinationPath: "/admin/tickets",
      kind: "ticket_sale",
      now: "2026-07-01T00:00:00.000Z",
      originalOccurredAt: "2026-07-01T00:00:00.000Z",
      recipientProfileId: profile1,
      sourceKey: "ticket-sale:123",
      title: "Ticket sale",
    });
    expect(first).toBe(true);

    const second = insertNotificationReceipt(adapter.storage, {
      body: "Duplicate replay",
      destinationPath: "/admin/tickets",
      kind: "ticket_sale",
      now: "2026-07-01T00:00:00.000Z",
      originalOccurredAt: "2026-07-01T00:00:00.000Z",
      recipientProfileId: profile1,
      sourceKey: "ticket-sale:123",
      title: "Ticket sale duplicate",
    });
    expect(second).toBe(true); // handled idempotently

    const page = listNotificationReceipts(adapter.storage, {
      now: new Date("2026-07-01T00:00:00.000Z"),
      profileId: profile1,
    });
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]?.title).toBe("Ticket sale");
  });

  it("lists notices with filtering, pagination cursor, and capped unread count", () => {
    const adapter = setupStoreTestDb();
    seedProfiles(adapter);

    for (let i = 1; i <= 30; i++) {
      const day = String(i).padStart(2, "0");
      insertNotificationReceipt(adapter.storage, {
        body: `Body ${String(i)}`,
        destinationPath: "/admin/tickets",
        kind: i % 2 === 0 ? "ticket_sale" : "audition",
        now: "2026-08-01T00:00:00.000Z",
        originalOccurredAt: `2026-07-${day}T12:00:00.000Z`,
        recipientProfileId: profile1,
        sourceKey: `source:${String(i)}`,
        title: `Notice ${String(i)}`,
      });
    }

    const firstPage = listNotificationReceipts(adapter.storage, {
      limit: 10,
      now: new Date("2026-08-01T00:00:00.000Z"),
      profileId: profile1,
    });
    expect(firstPage.notifications).toHaveLength(10);
    expect(firstPage.unreadCount).toBe(30);
    expect(firstPage.hasMoreUnread).toBe(false);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = listNotificationReceipts(adapter.storage, {
      cursor: firstPage.nextCursor,
      limit: 10,
      now: new Date("2026-08-01T00:00:00.000Z"),
      profileId: profile1,
    });
    expect(secondPage.notifications).toHaveLength(10);
    expect(secondPage.notifications[0]?.title).toBe("Notice 20");

    // Filter by kind
    const auditionsOnly = listNotificationReceipts(adapter.storage, {
      filter: "audition",
      now: new Date("2026-08-01T00:00:00.000Z"),
      profileId: profile1,
    });
    expect(auditionsOnly.notifications).toHaveLength(15);
    expect(auditionsOnly.notifications.every((n) => n.kind === "audition")).toBe(true);
  });

  it("marks individual notices read and respects person isolation", () => {
    const adapter = setupStoreTestDb();
    seedProfiles(adapter);

    insertNotificationReceipt(adapter.storage, {
      body: "Notice for Alice",
      destinationPath: "/admin/donations",
      kind: "donation",
      now: "2026-07-01T00:00:00.000Z",
      originalOccurredAt: "2026-07-01T00:00:00.000Z",
      recipientProfileId: profile1,
      sourceKey: "donation:1",
      title: "Donation 1",
    });

    const page = listNotificationReceipts(adapter.storage, {
      now: new Date("2026-07-01T00:00:00.000Z"),
      profileId: profile1,
    });
    const notice = page.notifications[0];
    expect(notice).toBeDefined();
    if (!notice) return;
    const noticeId = notice.id;

    // Bob cannot mark Alice's notice read
    const bobResult = markNotificationReceiptRead(adapter.storage, {
      notificationId: noticeId,
      profileId: profile2,
    });
    expect(bobResult).toBeNull();

    // Alice marks it read
    const aliceResult = markNotificationReceiptRead(adapter.storage, {
      now: new Date("2026-07-01T01:00:00.000Z"),
      notificationId: noticeId,
      profileId: profile1,
    });
    expect(aliceResult?.readAt).toBe("2026-07-01T01:00:00.000Z");

    const afterList = listNotificationReceipts(adapter.storage, {
      now: new Date("2026-07-01T02:00:00.000Z"),
      profileId: profile1,
    });
    expect(afterList.unreadCount).toBe(0);
    expect(afterList.notifications[0]?.readAt).toBe("2026-07-01T01:00:00.000Z");
  });

  it("marks all read up to server snapshot boundary", () => {
    const adapter = setupStoreTestDb();
    seedProfiles(adapter);

    insertNotificationReceipt(adapter.storage, {
      body: "Notice 1",
      destinationPath: null,
      kind: "audition",
      now: "2026-07-01T00:00:00.000Z",
      originalOccurredAt: "2026-07-01T10:00:00.000Z",
      recipientProfileId: profile1,
      sourceKey: "notice:1",
      title: "Notice 1",
    });

    insertNotificationReceipt(adapter.storage, {
      body: "Notice 2",
      destinationPath: null,
      kind: "audition",
      now: "2026-07-01T00:00:00.000Z",
      originalOccurredAt: "2026-07-01T11:00:00.000Z",
      recipientProfileId: profile1,
      sourceKey: "notice:2",
      title: "Notice 2",
    });

    const boundary = "2026-07-01T11:30:00.000Z";

    // Notice arriving after boundary
    insertNotificationReceipt(adapter.storage, {
      body: "Notice 3 (after boundary)",
      destinationPath: null,
      kind: "audition",
      now: "2026-07-01T00:00:00.000Z",
      originalOccurredAt: "2026-07-01T12:00:00.000Z",
      recipientProfileId: profile1,
      sourceKey: "notice:3",
      title: "Notice 3",
    });

    const marked = markAllNotificationReceiptsRead(adapter.storage, {
      boundary,
      now: new Date("2026-07-01T12:05:00.000Z"),
      profileId: profile1,
    });
    expect(marked).toBe(2);

    const list = listNotificationReceipts(adapter.storage, {
      now: new Date("2026-07-01T12:10:00.000Z"),
      profileId: profile1,
    });
    expect(list.unreadCount).toBe(1);
    const unread = list.notifications.find((n) => n.readAt === null);
    expect(unread?.title).toBe("Notice 3");
  });

  it("excludes expired notices from queries and cleans them up in batches", () => {
    const adapter = setupStoreTestDb();
    seedProfiles(adapter);

    const t0 = new Date("2026-06-15T00:00:00.000Z").getTime();
    insertNotificationReceipt(adapter.storage, {
      body: "Notice will expire",
      destinationPath: null,
      kind: "ticket_sale",
      now: new Date(t0).toISOString(),
      originalOccurredAt: new Date(t0).toISOString(),
      recipientProfileId: profile1,
      sourceKey: "will-expire:1",
      title: "Will expire",
    });

    // Check list before 90 days
    const activeList = listNotificationReceipts(adapter.storage, {
      now: new Date(t0 + 89 * 24 * 60 * 60 * 1000),
      profileId: profile1,
    });
    expect(activeList.notifications).toHaveLength(1);

    // After 90 days + 1 second: excluded from queries immediately even before physical cleanup
    const after90Days = new Date(t0 + NOTIFICATION_RETENTION_MS + 1000);
    const expiredList = listNotificationReceipts(adapter.storage, {
      now: after90Days,
      profileId: profile1,
    });
    expect(expiredList.notifications).toHaveLength(0);
    expect(expiredList.unreadCount).toBe(0);

    // Physical cleanup removes the row
    const cleaned = cleanupExpiredNotificationReceipts(adapter.storage, after90Days);
    expect(cleaned).toBe(1);
  });
});
