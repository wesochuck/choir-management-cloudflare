import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createContactTestAdapter, DEFAULT_CONTACT_TEST_ORG_ID } from "./contactTestkit";
import { readProfileActivityFromStore } from "./profileActivityStore";
import { organizationSchemaMigrations } from "./schema/migrations";

function createMigratedStore() {
  const db = new DatabaseSync(":memory:");
  const adapter = createContactTestAdapter(db);
  adapter.storage.transactionSync(() => {
    for (const migration of organizationSchemaMigrations) {
      for (const statement of migration.statements) {
        adapter.storage.sql.exec(statement);
      }
    }
  });
  adapter.storage.sql.exec(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, timezone, created_at, updated_at)
     VALUES (?, 'Test Choir', 'test-choir', 'America/New_York', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    DEFAULT_CONTACT_TEST_ORG_ID,
  );
  return { adapter, db };
}

function readExplainPlanDetails(db: DatabaseSync, query: string, param: string): string[] {
  const rows: unknown = db.prepare(query).all(param);
  if (!Array.isArray(rows)) return [];
  const details: string[] = [];
  for (const row of rows as readonly unknown[]) {
    if (
      typeof row === "object" &&
      row !== null &&
      "detail" in row &&
      typeof row.detail === "string"
    ) {
      details.push(row.detail);
    }
  }
  return details;
}

describe("readProfileActivityFromStore", () => {
  const profileId = "11111111-1111-4111-8111-111111111111";
  const rehearsal1Id = "22222222-2222-4222-8222-222222222221";
  const rehearsal2Id = "22222222-2222-4222-8222-222222222222";
  const performanceId = "22222222-2222-4222-8222-222222222223";
  const pollId = "33333333-3333-4333-8333-333333333331";
  const seasonId = "44444444-4444-4444-8444-444444444441";
  const duesId = "55555555-5555-4555-8555-555555555551";

  it("rejects mismatched organization IDs and missing profiles", () => {
    const { adapter, db } = createMigratedStore();
    try {
      expect(
        readProfileActivityFromStore(adapter.storage, {
          organizationId: "other-org",
          profileId,
        }),
      ).toEqual({ code: "organization_not_found", ok: false });

      expect(
        readProfileActivityFromStore(adapter.storage, {
          organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
          profileId,
        }),
      ).toEqual({ code: "profile_not_found", ok: false });
    } finally {
      db.close();
    }
  });

  it("aggregates attendance, RSVPs, status changes, polls, dues, and email health", () => {
    const { adapter, db } = createMigratedStore();
    try {
      const storage = adapter.storage;
      storage.sql.exec(
        `INSERT INTO profiles
          (id, display_name, created_at, updated_at, last_bounce_at, bounce_reason, provider_email_suppressed, do_not_email)
         VALUES (?, 'John Long', '2026-01-10T10:00:00.000Z', '2026-06-10T10:00:00.000Z', '', '', 0, 0)`,
        profileId,
      );
      storage.sql.exec(
        `INSERT INTO contacts
          (id, profile_id, first_name, last_name, display_name, email, normalized_email, phone, created_at, updated_at)
         VALUES ('c-1', ?, 'John', 'Long', 'John Long', 'john@example.test', 'john@example.test', '', '2026-01-10T10:00:00.000Z', '2026-01-10T10:00:00.000Z')`,
        profileId,
      );

      storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES
           (?, 'Tuesday Rehearsal', 'Rehearsal', '2026-06-02T23:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
           (?, 'Dress Rehearsal', 'Rehearsal', '2026-06-09T23:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
           (?, 'Spring Concert', 'Performance', '2026-06-20T23:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        rehearsal1Id,
        rehearsal2Id,
        performanceId,
      );

      storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
         VALUES
           (?, ?, 'Yes', 'Absent', '2026-06-01T00:00:00.000Z', '2026-06-03T00:00:00.000Z'),
           (?, ?, 'Yes', 'Present', '2026-06-01T00:00:00.000Z', '2026-06-10T00:00:00.000Z'),
           (?, ?, 'Yes', 'Pending', '2026-06-01T00:00:00.000Z', '2026-06-05T00:00:00.000Z')`,
        rehearsal1Id,
        profileId,
        rehearsal2Id,
        profileId,
        performanceId,
        profileId,
      );

      storage.sql.exec(
        `INSERT INTO event_rsvp_history
          (id, event_id, profile_id, previous_rsvp, new_rsvp, reason, automatic, actor_type, actor_id, occurred_at)
         VALUES ('rsvp-1', ?, ?, 'Pending', 'Yes', 'Confirmed attendance', 0, 'organization_member', 'user-john', '2026-06-05T14:00:00.000Z')`,
        performanceId,
        profileId,
      );

      storage.sql.exec(
        `INSERT INTO profile_status_history
          (id, profile_id, previous_status, new_status, trigger_type, trigger_id, reason, actor_type, actor_id, occurred_at)
         VALUES ('st-1', ?, 'Idle', 'Active', 'attendance', ?, 'Returned to rehearsal', 'system', '', '2026-06-10T01:00:00.000Z')`,
        profileId,
        rehearsal2Id,
      );

      storage.sql.exec(
        `INSERT INTO polls (id, title, created_by, created_at, updated_at)
         VALUES (?, 'Concert Attire Vote', 'user-admin', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')`,
        pollId,
      );
      storage.sql.exec(
        `INSERT INTO poll_responses (poll_id, profile_id, option_ids, profile_name, responded_at)
         VALUES (?, ?, '["opt-1"]', 'John Long', '2026-06-07T16:30:00.000Z')`,
        pollId,
        profileId,
      );

      storage.sql.exec(
        `INSERT INTO seasons (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Spring 2026', '2026-01-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z', 7500, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        seasonId,
      );
      storage.sql.exec(
        `INSERT INTO dues (id, season_id, profile_id, amount_cents, status, payment_method, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, 7500, 'paid', 'online', '2026-02-01T18:00:00.000Z', '2026-02-01T18:00:00.000Z', '2026-02-01T18:00:00.000Z')`,
        duesId,
        seasonId,
        profileId,
      );

      storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts, provider_status, provider_event_at, last_attempt_at, created_at, updated_at)
         VALUES ('del-1', 'msg-1', ?, 'John Long', 'email', 'john@example.test', 'sent', 1, 'delivered', '2026-06-11T15:00:00.000Z', '2026-06-11T14:59:00.000Z', '2026-06-11T14:59:00.000Z', '2026-06-11T15:00:00.000Z')`,
        profileId,
      );

      const result = readProfileActivityFromStore(storage, {
        nowIso: "2026-06-12T12:00:00.000Z",
        organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
        profileId,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.primaryContactEmail).toBe("john@example.test");
      expect(result.data.attendance.lastAttendedEvent).toEqual({
        eventId: rehearsal2Id,
        eventTitle: "Dress Rehearsal",
        eventType: "Rehearsal",
        startsAt: "2026-06-09T23:00:00.000Z",
      });
      expect(result.data.attendance.recentRehearsals).toEqual({
        absentCount: 1,
        pendingCount: 0,
        presentCount: 1,
        totalCount: 2,
      });
      expect(result.data.emailHealth).toEqual({
        bounceReason: "",
        doNotEmail: false,
        lastBounceAt: null,
        lastDeliveredAt: "2026-06-11T15:00:00.000Z",
        providerEmailSuppressed: false,
      });
      expect(result.data.lastPollResponseAt).toBe("2026-06-07T16:30:00.000Z");
      expect(result.data.lastRsvpResponseAt).toBe("2026-06-05T14:00:00.000Z");
      expect(result.data.timeline.map((item) => item.kind).sort()).toEqual([
        "attendance",
        "attendance",
        "dues_payment",
        "poll_response",
        "rsvp_change",
        "status_change",
      ]);

      // Verify idx_poll_responses_profile backs per-profile poll lookups without full table scan.
      const planDetails = readExplainPlanDetails(
        db,
        `EXPLAIN QUERY PLAN
         SELECT pr.poll_id, pr.responded_at, p.title
         FROM poll_responses pr
         LEFT JOIN polls p ON p.id = pr.poll_id
         WHERE pr.profile_id = ?
         ORDER BY pr.responded_at DESC, pr.poll_id DESC
         LIMIT 15`,
        profileId,
      );
      expect(planDetails.some((detail) => detail.includes("idx_poll_responses_profile"))).toBe(
        true,
      );
    } finally {
      db.close();
    }
  });
});
