import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import { reconcileEmailChangeNotifications } from "../src/auth/emailChange";
import type { Env } from "../src/env";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
});

afterEach(async () => {
  await reset();
});

describe("Email change reconciliation", () => {
  async function seedRealisticFixture(now: number) {
    const orgId = "org-email-change-test";
    await controlDatabase
      .prepare(
        `INSERT INTO organizations (id, name, slug, lifecycle_state, durable_object_key, created_at, updated_at)
         VALUES (?, 'Test Org', 'test-org', 'active', 'test-key', ?, ?)`,
      )
      .bind(orgId, now, now)
      .run();

    // Seed users
    const userStatements = [];
    const totalUsers = 70;
    for (let i = 1; i <= totalUsers; i++) {
      const userStr = String(i);
      userStatements.push(
        controlDatabase
          .prepare(
            `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
             VALUES (?, ?, ?, 1, ?, ?)`,
          )
          .bind(`user-${userStr}`, `User ${userStr}`, `user-${userStr}@example.test`, now, now),
      );
    }
    await controlDatabase.batch(userStatements);

    // Skewed fixture:
    // 20 confirmed, 20 expired, 20 superseded
    const requestStatements = [];
    const notificationStatements = [];

    let userIdx = 1;
    for (let i = 1; i <= 20; i++, userIdx++) {
      const id = `req-confirmed-${String(i)}`;
      const userStr = String(userIdx);
      requestStatements.push(
        controlDatabase
          .prepare(
            `INSERT INTO email_change_requests
             (id, organization_id, user_id, request_id, old_email, new_email, confirmation_origin,
              token_fingerprint, issued_at, expires_at, status, confirmed_at, created_at, updated_at)
             VALUES (?, ?, ?, 'req-id', 'old@example.test', 'new@example.test', 'https://test.example',
                     ?, ?, ?, 'confirmed', ?, ?, ?)`,
          )
          .bind(
            id,
            orgId,
            `user-${userStr}`,
            `fp-${id}`,
            now - 100000,
            now - 50000,
            now - 60000,
            now - 100000,
            now - 60000,
          ),
      );
      notificationStatements.push(
        controlDatabase
          .prepare(
            `INSERT INTO email_change_notifications
             (id, email_change_request_id, phase, recipient, state, attempts, next_attempt_at, created_at, sent_at, updated_at)
             VALUES (?, ?, 'confirmed_new', 'new@example.test', 'sent', 1, ?, ?, ?, ?)`,
          )
          .bind(
            `notif-confirmed-${String(i)}`,
            id,
            now - 60000,
            now - 100000,
            now - 60000,
            now - 60000,
          ),
      );
    }

    for (let i = 1; i <= 20; i++, userIdx++) {
      const id = `req-historical-expired-${String(i)}`;
      const userStr = String(userIdx);
      requestStatements.push(
        controlDatabase
          .prepare(
            `INSERT INTO email_change_requests
             (id, organization_id, user_id, request_id, old_email, new_email, confirmation_origin,
              token_fingerprint, issued_at, expires_at, status, confirmed_at, created_at, updated_at)
             VALUES (?, ?, ?, 'req-id', 'old@example.test', 'new@example.test', 'https://test.example',
                     ?, ?, ?, 'expired', NULL, ?, ?)`,
          )
          .bind(
            id,
            orgId,
            `user-${userStr}`,
            `fp-${id}`,
            now - 200000,
            now - 150000,
            now - 200000,
            now - 150000,
          ),
      );
      notificationStatements.push(
        controlDatabase
          .prepare(
            `INSERT INTO email_change_notifications
             (id, email_change_request_id, phase, recipient, state, attempts, next_attempt_at, created_at, sent_at, updated_at)
             VALUES (?, ?, 'requested_old', 'old@example.test', 'canceled', 1, ?, ?, NULL, ?)`,
          )
          .bind(`notif-expired-${String(i)}`, id, now - 150000, now - 200000, now - 150000),
      );
    }

    for (let i = 1; i <= 20; i++, userIdx++) {
      const id = `req-superseded-${String(i)}`;
      const userStr = String(userIdx);
      requestStatements.push(
        controlDatabase
          .prepare(
            `INSERT INTO email_change_requests
             (id, organization_id, user_id, request_id, old_email, new_email, confirmation_origin,
              token_fingerprint, issued_at, expires_at, status, confirmed_at, created_at, updated_at)
             VALUES (?, ?, ?, 'req-id', 'old@example.test', 'new@example.test', 'https://test.example',
                     ?, ?, ?, 'superseded', NULL, ?, ?)`,
          )
          .bind(
            id,
            orgId,
            `user-${userStr}`,
            `fp-${id}`,
            now - 300000,
            now - 250000,
            now - 300000,
            now - 250000,
          ),
      );
    }

    // Pending expired requests (due to expire now)
    const dueExpiredId1 = "req-pending-due-1";
    const dueExpiredId2 = "req-pending-due-2";
    const userDue1 = String(userIdx++);
    const userDue2 = String(userIdx++);
    requestStatements.push(
      controlDatabase
        .prepare(
          `INSERT INTO email_change_requests
           (id, organization_id, user_id, request_id, old_email, new_email, confirmation_origin,
            token_fingerprint, issued_at, expires_at, status, confirmed_at, created_at, updated_at)
           VALUES (?, ?, ?, 'req-id', 'old1@example.test', 'new1@example.test', 'https://test.example',
                   ?, ?, ?, 'pending', NULL, ?, ?)`,
        )
        .bind(
          dueExpiredId1,
          orgId,
          `user-${userDue1}`,
          `fp-${dueExpiredId1}`,
          now - 40000,
          now - 1000,
          now - 40000,
          now - 40000,
        ),
      controlDatabase
        .prepare(
          `INSERT INTO email_change_requests
           (id, organization_id, user_id, request_id, old_email, new_email, confirmation_origin,
            token_fingerprint, issued_at, expires_at, status, confirmed_at, created_at, updated_at)
           VALUES (?, ?, ?, 'req-id', 'old2@example.test', 'new2@example.test', 'https://test.example',
                   ?, ?, ?, 'pending', NULL, ?, ?)`,
        )
        .bind(
          dueExpiredId2,
          orgId,
          `user-${userDue2}`,
          `fp-${dueExpiredId2}`,
          now - 50000,
          now - 5000,
          now - 50000,
          now - 50000,
        ),
    );

    // Notifications for due expired requests:
    // For dueExpiredId1: one queued, one failed
    notificationStatements.push(
      controlDatabase
        .prepare(
          `INSERT INTO email_change_notifications
           (id, email_change_request_id, phase, recipient, state, attempts, next_attempt_at, created_at, sent_at, updated_at)
           VALUES (?, ?, 'requested_old', 'old1@example.test', 'queued', 0, ?, ?, NULL, ?)`,
        )
        .bind("notif-due-1-queued", dueExpiredId1, now, now - 40000, now - 40000),
      controlDatabase
        .prepare(
          `INSERT INTO email_change_notifications
           (id, email_change_request_id, phase, recipient, state, attempts, next_attempt_at, created_at, sent_at, updated_at)
           VALUES (?, ?, 'requested_new', 'new1@example.test', 'failed', 2, ?, ?, NULL, ?)`,
        )
        .bind("notif-due-1-failed", dueExpiredId1, now, now - 40000, now - 40000),
    );
    // For dueExpiredId2: one already sent
    notificationStatements.push(
      controlDatabase
        .prepare(
          `INSERT INTO email_change_notifications
           (id, email_change_request_id, phase, recipient, state, attempts, next_attempt_at, created_at, sent_at, updated_at)
           VALUES (?, ?, 'requested_old', 'old2@example.test', 'sent', 1, ?, ?, ?, ?)`,
        )
        .bind(
          "notif-due-2-sent",
          dueExpiredId2,
          now - 10000,
          now - 50000,
          now - 10000,
          now - 10000,
        ),
    );

    // Pending future requests (expires in the future)
    const futurePendingId1 = "req-pending-future-1";
    const futurePendingId2 = "req-pending-future-2";
    const userFuture1 = String(userIdx++);
    const userFuture2 = String(userIdx);
    requestStatements.push(
      controlDatabase
        .prepare(
          `INSERT INTO email_change_requests
           (id, organization_id, user_id, request_id, old_email, new_email, confirmation_origin,
            token_fingerprint, issued_at, expires_at, status, confirmed_at, created_at, updated_at)
           VALUES (?, ?, ?, 'req-id', 'old3@example.test', 'new3@example.test', 'https://test.example',
                   ?, ?, ?, 'pending', NULL, ?, ?)`,
        )
        .bind(
          futurePendingId1,
          orgId,
          `user-${userFuture1}`,
          `fp-${futurePendingId1}`,
          now,
          now + 100000,
          now,
          now,
        ),
      controlDatabase
        .prepare(
          `INSERT INTO email_change_requests
           (id, organization_id, user_id, request_id, old_email, new_email, confirmation_origin,
            token_fingerprint, issued_at, expires_at, status, confirmed_at, created_at, updated_at)
           VALUES (?, ?, ?, 'req-id', 'old4@example.test', 'new4@example.test', 'https://test.example',
                   ?, ?, ?, 'pending', NULL, ?, ?)`,
        )
        .bind(
          futurePendingId2,
          orgId,
          `user-${userFuture2}`,
          `fp-${futurePendingId2}`,
          now,
          now + 100000,
          now,
          now,
        ),
    );

    // Notifications for future pending requests:
    // futurePendingId1 has queued with future next_attempt_at
    // futurePendingId2 has queued with past next_attempt_at (ready for delivery)
    notificationStatements.push(
      controlDatabase
        .prepare(
          `INSERT INTO email_change_notifications
           (id, email_change_request_id, phase, recipient, state, attempts, next_attempt_at, created_at, sent_at, updated_at)
           VALUES (?, ?, 'requested_old', 'old3@example.test', 'queued', 0, ?, ?, NULL, ?)`,
        )
        .bind("notif-future-1-queued", futurePendingId1, now + 50000, now, now),
      controlDatabase
        .prepare(
          `INSERT INTO email_change_notifications
           (id, email_change_request_id, phase, recipient, state, attempts, next_attempt_at, created_at, sent_at, updated_at)
           VALUES (?, ?, 'requested_old', 'old4@example.test', 'queued', 0, ?, ?, NULL, ?)`,
        )
        .bind("notif-future-2-ready", futurePendingId2, now - 100, now, now),
    );

    await controlDatabase.batch(requestStatements);
    await controlDatabase.batch(notificationStatements);

    return {
      dueExpiredId1,
      dueExpiredId2,
      futurePendingId1,
      futurePendingId2,
    };
  }

  it("uses the partial pending-expiry index for candidate lookup rather than a full table scan", async () => {
    const now = Date.now();
    await seedRealisticFixture(now);

    const queryPlan = await controlDatabase
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM email_change_requests
         WHERE status = 'pending' AND expires_at <= ?`,
      )
      .bind(now)
      .all<{ detail: string }>();

    const details = queryPlan.results.map((row) => row.detail).join(" ");
    expect(details).toMatch(/email_change_requests_pending_expiry/);
    expect(details).toMatch(/SEARCH/);
    expect(details).not.toMatch(/SCAN email_change_requests/);

    const updateQueryPlan = await controlDatabase
      .prepare(
        `EXPLAIN QUERY PLAN
         UPDATE email_change_notifications
         SET state = 'canceled', updated_at = ?
         WHERE state IN ('queued', 'failed')
           AND email_change_request_id IN (
             SELECT id
             FROM email_change_requests
             WHERE status = 'pending' AND expires_at <= ?
           )`,
      )
      .bind(now, now)
      .all<{ detail: string }>();

    const updateDetails = updateQueryPlan.results.map((row) => row.detail).join(" ");
    expect(updateDetails).toMatch(/email_change_requests_pending_expiry/);
    expect(updateDetails).not.toMatch(/SCAN email_change_requests/);
  });

  it("reconciles expiration atomically and idempotently without regressing delivery or historical records", async () => {
    const now = Date.now();
    const { dueExpiredId1, dueExpiredId2, futurePendingId1, futurePendingId2 } =
      await seedRealisticFixture(now);

    const testEnv: Env = {
      ...env,
      PLATFORM_EMAIL_MODE: "capture",
      PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
      PLATFORM_EMAIL_FROM: "notifications@example.test",
    };

    // First reconciliation execution
    await reconcileEmailChangeNotifications(testEnv);

    // 1. Only due pending requests become expired
    const expiredDue1 = await controlDatabase
      .prepare("SELECT status FROM email_change_requests WHERE id = ?")
      .bind(dueExpiredId1)
      .first<{ status: string }>();
    expect(expiredDue1?.status).toBe("expired");

    const expiredDue2 = await controlDatabase
      .prepare("SELECT status FROM email_change_requests WHERE id = ?")
      .bind(dueExpiredId2)
      .first<{ status: string }>();
    expect(expiredDue2?.status).toBe("expired");

    // 2. Future pending requests remain pending
    const future1 = await controlDatabase
      .prepare("SELECT status FROM email_change_requests WHERE id = ?")
      .bind(futurePendingId1)
      .first<{ status: string }>();
    expect(future1?.status).toBe("pending");

    const future2 = await controlDatabase
      .prepare("SELECT status FROM email_change_requests WHERE id = ?")
      .bind(futurePendingId2)
      .first<{ status: string }>();
    expect(future2?.status).toBe("pending");

    // 3. Queued and failed notifications for expired requests become canceled
    const notifDue1Queued = await controlDatabase
      .prepare("SELECT state FROM email_change_notifications WHERE id = ?")
      .bind("notif-due-1-queued")
      .first<{ state: string }>();
    expect(notifDue1Queued?.state).toBe("canceled");

    const notifDue1Failed = await controlDatabase
      .prepare("SELECT state FROM email_change_notifications WHERE id = ?")
      .bind("notif-due-1-failed")
      .first<{ state: string }>();
    expect(notifDue1Failed?.state).toBe("canceled");

    // 4. Sent notification for expired request remains sent
    const notifDue2Sent = await controlDatabase
      .prepare("SELECT state FROM email_change_notifications WHERE id = ?")
      .bind("notif-due-2-sent")
      .first<{ state: string }>();
    expect(notifDue2Sent?.state).toBe("sent");

    // 5. Future notification not yet due remains queued
    const notifFuture1 = await controlDatabase
      .prepare("SELECT state FROM email_change_notifications WHERE id = ?")
      .bind("notif-future-1-queued")
      .first<{ state: string }>();
    expect(notifFuture1?.state).toBe("queued");

    // 6. Eligible pending notification was delivered by deliverEmailChangeNotifications
    const notifFuture2 = await controlDatabase
      .prepare("SELECT state FROM email_change_notifications WHERE id = ?")
      .bind("notif-future-2-ready")
      .first<{ state: string }>();
    expect(notifFuture2?.state).toBe("sent");

    // 7. Confirmed and superseded historical records are untouched
    const confirmedCount = await controlDatabase
      .prepare("SELECT count(*) as count FROM email_change_requests WHERE status = 'confirmed'")
      .first<{ count: number }>();
    expect(confirmedCount?.count).toBe(20);

    const supersededCount = await controlDatabase
      .prepare("SELECT count(*) as count FROM email_change_requests WHERE status = 'superseded'")
      .first<{ count: number }>();
    expect(supersededCount?.count).toBe(20);

    // 8. Repeated execution is idempotent
    await reconcileEmailChangeNotifications(testEnv);

    const postIdempotencyExpired1 = await controlDatabase
      .prepare("SELECT status FROM email_change_requests WHERE id = ?")
      .bind(dueExpiredId1)
      .first<{ status: string }>();
    expect(postIdempotencyExpired1?.status).toBe("expired");

    const postIdempotencyFuture1 = await controlDatabase
      .prepare("SELECT status FROM email_change_requests WHERE id = ?")
      .bind(futurePendingId1)
      .first<{ status: string }>();
    expect(postIdempotencyFuture1?.status).toBe("pending");
  });
});
