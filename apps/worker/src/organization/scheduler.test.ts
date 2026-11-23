import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  TICKET_REMINDER_LEAD_SQL_MODIFIER,
  isTicketPurchaseEligibleForReminder,
} from "./communicationSchedule";
import {
  TICKET_REMINDER_BATCH_SIZE,
  TICKET_REMINDER_CANDIDATE_SQL,
  computePrefixUpperBound,
} from "./schedulerDueJobs";
import { organizationSchemaMigrations } from "./schema/migrations";

function seedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE IF NOT EXISTS organization_schema_migrations (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT`);
  for (const migration of organizationSchemaMigrations) {
    for (const statement of migration.statements) {
      db.exec(statement);
    }
  }
  return db;
}

interface QueryPlanRow {
  readonly detail: string;
}

describe("scheduler event reminder history lookups", () => {
  describe("computePrefixUpperBound", () => {
    it("computes the exclusive upper bound for colon-terminated prefixes", () => {
      expect(computePrefixUpperBound("event-reminder:org:event:retry:")).toBe(
        "event-reminder:org:event:retry;",
      );
      expect(computePrefixUpperBound("abc:")).toBe("abc;");
      expect(computePrefixUpperBound("a")).toBe("b");
    });

    it("throws for empty prefix", () => {
      expect(() => computePrefixUpperBound("")).toThrow("Prefix must not be empty");
    });
  });

  describe("query plan verification", () => {
    it("uses unique index on scheduled_job_outbox without table scans", () => {
      const db = seedDatabase();
      const baseKey = "event-reminder:org-1:event-1";
      const retryPrefix = `${baseKey}:retry:`;
      const upperBound = computePrefixUpperBound(retryPrefix);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query inspection
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT o.job_id AS jobId, l.status, l.terminal_at AS terminalAt
           FROM scheduled_job_outbox o
           LEFT JOIN job_ledger l ON l.job_id = o.job_id
           WHERE o.kind = 'event_reminder'
             AND (
               o.idempotency_key = ?
               OR (o.idempotency_key >= ? AND o.idempotency_key < ?)
             )
           ORDER BY o.created_at, o.job_id`,
        )
        .all(baseKey, retryPrefix, upperBound) as unknown as QueryPlanRow[];

      const outboxScans = plan.filter((row) => row.detail.includes("SCAN o"));
      expect(outboxScans).toHaveLength(0);

      const outboxSearches = plan.filter(
        (row) => row.detail.includes("SEARCH o USING INDEX") || row.detail.includes("SEARCH o"),
      );
      expect(outboxSearches.length).toBeGreaterThan(0);
    });

    it("uses primary key index on job_ledger without table scans", () => {
      const db = seedDatabase();
      const baseKey = "event-reminder:org-1:event-1";
      const retryPrefix = `${baseKey}:retry:`;
      const upperBound = computePrefixUpperBound(retryPrefix);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query inspection
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT COUNT(*) AS count FROM job_ledger
           WHERE kind = 'event_reminder'
             AND (
               idempotency_key = ?
               OR (idempotency_key >= ? AND idempotency_key < ?)
             )`,
        )
        .all(baseKey, retryPrefix, upperBound) as unknown as QueryPlanRow[];

      const ledgerScans = plan.filter((row) => row.detail.includes("SCAN job_ledger"));
      expect(ledgerScans).toHaveLength(0);

      const ledgerSearches = plan.filter(
        (row) =>
          row.detail.includes("SEARCH job_ledger USING INDEX") ||
          row.detail.includes("SEARCH job_ledger"),
      );
      expect(ledgerSearches.length).toBeGreaterThan(0);
    });
  });

  describe("functional correctness and prefix collision safety", () => {
    it("correctly matches base and retry keys while ignoring near-prefix collisions and other kinds/orgs", () => {
      const db = seedDatabase();
      const now = new Date().toISOString();

      const insertOutbox = db.prepare(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const insertLedger = db.prepare(
        `INSERT INTO job_ledger (idempotency_key, job_id, kind, status, attempt, claimed_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      // Target event: event-1
      const baseKey = "event-reminder:org-1:event-1";
      const retry0 = `${baseKey}:retry:0`;
      const retry1 = `${baseKey}:retry:1`;

      insertOutbox.run("job-1-base", "event_reminder", baseKey, now, now);
      insertOutbox.run("job-1-retry0", "event_reminder", retry0, now, now);
      insertOutbox.run("job-1-retry1", "event_reminder", retry1, now, now);

      insertLedger.run(baseKey, "job-1-base", "event_reminder", "failed", 1, now, now);
      insertLedger.run(retry0, "job-1-retry0", "event_reminder", "failed", 1, now, now);
      insertLedger.run(retry1, "job-1-retry1", "event_reminder", "failed", 1, now, now);

      // Near-prefix collision: event-10 (starts with event-1)
      const nearCollisionBase = "event-reminder:org-1:event-10";
      const nearCollisionRetry = `${nearCollisionBase}:retry:0`;
      insertOutbox.run("job-10-base", "event_reminder", nearCollisionBase, now, now);
      insertOutbox.run("job-10-retry", "event_reminder", nearCollisionRetry, now, now);
      insertLedger.run(nearCollisionBase, "job-10-base", "event_reminder", "failed", 1, now, now);
      insertLedger.run(nearCollisionRetry, "job-10-retry", "event_reminder", "failed", 1, now, now);

      // Other org: org-2 with event-1
      const otherOrgBase = "event-reminder:org-2:event-1";
      insertOutbox.run("job-org2", "event_reminder", otherOrgBase, now, now);
      insertLedger.run(otherOrgBase, "job-org2", "event_reminder", "failed", 1, now, now);

      // Other kind: roster_sync with same key format
      const otherKindKey = "roster_sync:org-1:event-1";
      insertOutbox.run("job-roster", "roster_sync", otherKindKey, now, now);
      insertLedger.run(otherKindKey, "job-roster", "roster_sync", "failed", 1, now, now);

      // Seed 200 unrelated history rows
      for (let i = 0; i < 200; i++) {
        const randKey = `unrelated:job:${String(i)}`;
        insertOutbox.run(`unrelated-outbox-${String(i)}`, "unrelated", randKey, now, now);
        insertLedger.run(
          randKey,
          `unrelated-outbox-${String(i)}`,
          "unrelated",
          "completed",
          1,
          now,
          now,
        );
      }

      // Query target event-1
      const retryPrefix = `${baseKey}:retry:`;
      const upperBound = computePrefixUpperBound(retryPrefix);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query
      const matchedOutbox = db
        .prepare(
          `SELECT o.job_id AS jobId
           FROM scheduled_job_outbox o
           LEFT JOIN job_ledger l ON l.job_id = o.job_id
           WHERE o.kind = 'event_reminder'
             AND (
               o.idempotency_key = ?
               OR (o.idempotency_key >= ? AND o.idempotency_key < ?)
             )
           ORDER BY o.created_at, o.job_id`,
        )
        .all(baseKey, retryPrefix, upperBound) as { jobId: string }[];

      expect(matchedOutbox.map((r) => r.jobId)).toEqual([
        "job-1-base",
        "job-1-retry0",
        "job-1-retry1",
      ]);

      const ledgerRow = db
        .prepare(
          `SELECT COUNT(*) AS count FROM job_ledger
           WHERE kind = 'event_reminder'
             AND (
               idempotency_key = ?
               OR (idempotency_key >= ? AND idempotency_key < ?)
             )`,
        )
        .get(baseKey, retryPrefix, upperBound);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query inspection
      const ledgerCount = (ledgerRow as { count: number }).count;

      expect(ledgerCount).toBe(3);
    });
  });
});

it("uses the pending-job index to select only jobs that are due", () => {
  const db = seedDatabase();
  try {
    const duePlan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT job_id FROM scheduled_job_outbox WHERE enqueued_at IS NULL AND due_at <= ? ORDER BY due_at, job_id LIMIT 10",
      )
      .all("2024-03-10T12:00:00Z");
    expect(
      duePlan.some(
        (row) =>
          typeof row.detail === "string" && row.detail.includes("idx_scheduled_job_outbox_pending"),
      ),
    ).toBe(true);
  } finally {
    db.close();
  }
});

describe("ticket reminder candidate selection", () => {
  it("treats purchases completed at or before the 36-hour window as eligible and skips later checkouts", () => {
    const startsAt = "2026-11-16T20:00:00.000Z";
    expect(isTicketPurchaseEligibleForReminder("2026-11-15T07:59:59.999Z", startsAt)).toBe(true);
    expect(isTicketPurchaseEligibleForReminder("2026-11-15T08:00:00.000Z", startsAt)).toBe(true);
    expect(isTicketPurchaseEligibleForReminder("2026-11-15T08:00:00.001Z", startsAt)).toBe(false);
    expect(isTicketPurchaseEligibleForReminder("2026-11-16T19:00:00.000Z", startsAt)).toBe(false);
    expect(isTicketPurchaseEligibleForReminder("not-a-date", startsAt)).toBe(false);
  });

  it("uses indexes with zero table scans for ticket reminder candidate lookups", () => {
    const db = seedDatabase();
    try {
      const nowIso = "2026-11-15T08:45:00.000Z";
      const horizonIso = "2026-11-16T20:45:00.000Z";
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query plan inspection
      const plan = db
        .prepare(`EXPLAIN QUERY PLAN ${TICKET_REMINDER_CANDIDATE_SQL}`)
        .all(
          nowIso,
          horizonIso,
          TICKET_REMINDER_LEAD_SQL_MODIFIER,
          nowIso,
          horizonIso,
          TICKET_REMINDER_LEAD_SQL_MODIFIER,
          TICKET_REMINDER_BATCH_SIZE,
        ) as unknown as QueryPlanRow[];

      const details = plan.map((row) => row.detail);
      expect(details.filter((detail) => /\bSCAN\b/.test(detail))).toEqual([]);
      expect(details.some((detail) => detail.includes("idx_events_active_calendar"))).toBe(true);
      expect(details.some((detail) => detail.includes("idx_ticket_purchases_event_status"))).toBe(
        true,
      );
      expect(details.some((detail) => detail.includes("idx_ticket_bundle_allocations_event"))).toBe(
        true,
      );
      expect(
        details.some(
          (detail) =>
            detail.includes(
              "SEARCH n USING COVERING INDEX sqlite_autoindex_ticket_notifications_",
            ) && detail.includes("dedupe_key=?"),
        ),
      ).toBe(true);
    } finally {
      db.close();
    }
  });

  it("filters out late checkouts and already-reminded purchases before applying LIMIT", () => {
    const db = seedDatabase();
    try {
      const eventStartsAt = "2026-11-16T20:00:00.000Z";
      const nowIso = "2026-11-15T08:45:00.000Z";
      const horizonIso = "2026-11-16T20:45:00.000Z";
      const beforeCutoffIso = "2026-11-14T12:00:00.000Z";
      const exactCutoffIso = "2026-11-15T08:00:00.000Z";
      const afterCutoffIso = "2026-11-15T08:00:00.001Z";

      db.prepare(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES ('event-1', 'Earth and Sky and Sea', 'Performance', ?, ?, ?)`,
      ).run(eventStartsAt, beforeCutoffIso, beforeCutoffIso);

      const insertPurchase = db.prepare(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, created_at, updated_at, fulfilled_at)
         VALUES (?, ?, 'event-1', 'Earth and Sky and Sea', ?, 'America/New_York',
           'Buyer', ?, 1, 2000, 0, 2000, 'usd', ?, '', 'paid', ?, ?, ?)`,
      );
      const insertNotification = db.prepare(
        `INSERT INTO ticket_notifications
          (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
           content_markdown, status, scheduled_for, created_at, updated_at)
         VALUES (?, ?, 'event-1', ?, 'reminder', ?, 'Reminder', 'Body', 'sent', ?, ?, ?)`,
      );

      // 105 advance purchases where the first 100 already have reminders
      for (let index = 0; index < 105; index++) {
        const purchaseId = `purchase-${String(index).padStart(3, "0")}`;
        const email = `${purchaseId}@example.test`;
        insertPurchase.run(
          purchaseId,
          `req-${purchaseId}`,
          eventStartsAt,
          email,
          `sess-${purchaseId}`,
          beforeCutoffIso,
          beforeCutoffIso,
          index === 104 ? null : beforeCutoffIso,
        );
        if (index < 100) {
          insertNotification.run(
            `notif-${purchaseId}`,
            purchaseId,
            `ticket-reminder:${purchaseId}:event-1:${eventStartsAt}`,
            email,
            nowIso,
            nowIso,
            nowIso,
          );
        }
      }

      // Boundary purchase at exact 36-hour mark: eligible
      insertPurchase.run(
        "purchase-exact-cutoff",
        "req-exact",
        eventStartsAt,
        "exact@example.test",
        "sess-exact",
        exactCutoffIso,
        exactCutoffIso,
        exactCutoffIso,
      );

      // Checkout started before cutoff but paid inside 36-hour window: excluded
      insertPurchase.run(
        "purchase-late-fulfilled",
        "req-late-fulfilled",
        eventStartsAt,
        "late-fulfilled@example.test",
        "sess-late-fulfilled",
        beforeCutoffIso,
        afterCutoffIso,
        afterCutoffIso,
      );

      // Checkout created and paid inside 36-hour window: excluded
      insertPurchase.run(
        "purchase-same-day",
        "req-same-day",
        eventStartsAt,
        "same-day@example.test",
        "sess-same-day",
        afterCutoffIso,
        afterCutoffIso,
        afterCutoffIso,
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test query result
      const candidates = db
        .prepare(TICKET_REMINDER_CANDIDATE_SQL)
        .all(
          nowIso,
          horizonIso,
          TICKET_REMINDER_LEAD_SQL_MODIFIER,
          nowIso,
          horizonIso,
          TICKET_REMINDER_LEAD_SQL_MODIFIER,
          TICKET_REMINDER_BATCH_SIZE,
        ) as unknown as { readonly purchaseId: string }[];

      expect(candidates.map((row) => row.purchaseId)).toEqual([
        "purchase-100",
        "purchase-101",
        "purchase-102",
        "purchase-103",
        "purchase-104",
        "purchase-exact-cutoff",
      ]);
    } finally {
      db.close();
    }
  });
});

it("uses event and ticket indexes when selecting ticket closeout jobs", () => {
  const db = seedDatabase();
  try {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT e.id
         FROM events e
         WHERE e.type = 'Performance' AND e.is_archived = 0 AND e.is_canceled = 0
           AND e.starts_at < ?
           AND (
             EXISTS (
               SELECT 1 FROM ticket_purchases p
               WHERE p.event_id = e.id AND p.bundle_id IS NULL
                 AND p.status IN ('paid', 'refunded')
             )
             OR EXISTS (
               SELECT 1 FROM ticket_bundle_allocations a
               JOIN ticket_purchases p ON p.id = a.purchase_id
               WHERE a.event_id = e.id AND p.status IN ('paid', 'refunded')
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM scheduled_job_outbox o
             WHERE o.idempotency_key = ('ticket-closeout:' || ? || ':' || e.id)
           )
           AND NOT EXISTS (
             SELECT 1 FROM job_ledger l
             WHERE l.idempotency_key = ('ticket-closeout:' || ? || ':' || e.id)
           )
         ORDER BY e.starts_at DESC, e.id
         LIMIT 50`,
      )
      .all(new Date().toISOString(), "organization-test", "organization-test");
    const details = plan.flatMap((row) => (typeof row.detail === "string" ? [row.detail] : []));
    expect(details.some((detail) => detail.includes("idx_events_active_calendar"))).toBe(true);
    expect(details.some((detail) => detail.includes("idx_ticket_purchases_event_status"))).toBe(
      true,
    );
    expect(details.some((detail) => detail.includes("idx_ticket_bundle_allocations_event"))).toBe(
      true,
    );
  } finally {
    db.close();
  }
});
