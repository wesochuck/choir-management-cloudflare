import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  createFreshContactContext,
  createContactTestAdapter,
  runMigrations,
  seedOrganization,
  DEFAULT_CONTACT_TEST_ORG_ID as organizationId,
  countFor,
  dbAllUnknown,
  isPlanDetailRow,
} from "./contactTestkit";
import {
  captureCheckoutReminder,
  cleanupCheckoutReminders,
  readCheckoutReminderSettings,
  setCheckoutReminderSettings,
  stopCheckoutReminders,
} from "./checkoutReminderStore";
import type { CheckoutReminderCapture } from "@choir/contracts";

function setup() {
  const context = createFreshContactContext();
  context.db
    .prepare("UPDATE checkout_reminder_settings SET enabled_since = ?")
    .run("2000-01-01T00:00:00.000Z");
  return context;
}
function input(startedAt = "2020-01-02T00:00:00.000Z"): CheckoutReminderCapture {
  return {
    organizationId,
    attemptId: crypto.randomUUID(),
    startedAt,
    choices: {
      kind: "donation",
      bundleId: null,
      resourceId: crypto.randomUUID(),
      email: "Donor@Example.org",
      eventIds: [],
      quantity: null,
      amountCents: 5000,
      levelId: null,
      discountCode: null,
    },
  };
}

describe("checkout reminder storage on migrated SQLite", () => {
  it("upgrades populated pre-reminder storage without scheduling historical gifts", () => {
    const db = new DatabaseSync(":memory:");
    createContactTestAdapter(db);
    runMigrations(db, 133);
    seedOrganization(db, organizationId);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO donations(id,checkout_request_id,status,amount_cents,buyer_name,buyer_email,provider_session_id,created_at,updated_at) VALUES(?,?,'paid',5000,'Donor','donor@example.org',?,?,?)`,
    ).run(id, crypto.randomUUID(), `old_${id}`, now, now);
    runMigrations(db);
    expect(countFor(db, "SELECT COUNT(*) AS count FROM checkout_reminders")).toBe(0);
    expect(
      countFor(db, "SELECT COUNT(*) AS count FROM donations WHERE id = ? AND status = 'paid'", id),
    ).toBe(1);
    db.close();
  });
  it("replaces a donation candidate with a new ticket attempt using the same normalized email", () => {
    const { storage, db } = setup();
    captureCheckoutReminder(storage, input());
    const ticket = input("2020-01-03T00:00:00.000Z");
    ticket.choices.kind = "ticket";
    ticket.choices.email = " donor@example.org ".trim();
    ticket.choices.eventIds = [crypto.randomUUID()];
    ticket.choices.quantity = 2;
    expect(captureCheckoutReminder(storage, ticket).captured).toBe(true);
    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM checkout_reminders WHERE state='scheduled' AND kind='ticket'",
      ),
    ).toBe(1);
    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM checkout_reminders WHERE state='scheduled' AND kind='donation'",
      ),
    ).toBe(0);
  });

  it("does not backfill attempts before activation or while disabled", () => {
    const { storage } = setup();
    expect(captureCheckoutReminder(storage, input("1999-01-01T00:00:00.000Z")).captured).toBe(
      false,
    );
    const before = readCheckoutReminderSettings(storage, organizationId);
    setCheckoutReminderSettings(storage, {
      organizationId,
      enabled: false,
      actorUserId: "manager",
      requestId: crypto.randomUUID(),
    });
    expect(captureCheckoutReminder(storage, input()).captured).toBe(false);
    expect(readCheckoutReminderSettings(storage, organizationId).generation).toBe(
      before.generation + 1,
    );
  });

  it("registers a request once and replaces it only with a newer attempt", () => {
    const { storage, db } = setup();
    const first = input();
    const captured = captureCheckoutReminder(storage, first);
    expect(captured.captured).toBe(true);
    expect(captureCheckoutReminder(storage, first)).toEqual({ id: captured.id, captured: false });
    expect(captureCheckoutReminder(storage, input("2020-01-01T00:00:00.000Z")).captured).toBe(
      false,
    );
    expect(captureCheckoutReminder(storage, input("2020-01-03T00:00:00.000Z")).captured).toBe(true);
    expect(
      countFor(db, "SELECT COUNT(*) AS count FROM checkout_reminders WHERE state = 'scheduled'"),
    ).toBe(1);
    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM checkout_reminders WHERE skip_reason = 'newer_checkout'",
      ),
    ).toBe(1);
  });

  it("uses the shared payment creation order when attempts start in the same millisecond", () => {
    const { storage, db } = setup();
    const older = input();
    const newer = input();
    expect(captureCheckoutReminder(storage, newer, 20).captured).toBe(true);
    expect(captureCheckoutReminder(storage, older, 10).captured).toBe(false);
    expect(
      countFor(db, "SELECT COUNT(*) AS count FROM checkout_reminders WHERE state = 'scheduled'"),
    ).toBe(1);
  });
  it("keeps opt-outs after reminder history cleanup", () => {
    const { storage, db } = setup();
    captureCheckoutReminder(storage, input());
    const recipient = storage.sql
      .exec<{ id: string }>("SELECT id FROM checkout_reminder_recipients")
      .toArray()[0];
    if (!recipient) throw new Error("Missing recipient");
    expect(
      stopCheckoutReminders(storage, { organizationId, recipientId: recipient.id }).stopped,
    ).toBe(true);
    cleanupCheckoutReminders(storage, "9999-01-01T00:00:00.000Z");
    expect(countFor(db, "SELECT COUNT(*) AS count FROM checkout_reminders")).toBe(0);
    captureCheckoutReminder(storage, input("2020-01-03T00:00:00.000Z"));
    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM checkout_reminders WHERE skip_reason = 'recipient_opt_out'",
      ),
    ).toBe(1);
  });

  it("rejects another Organization before accessing reminder state", () => {
    const { storage } = setup();
    expect(() => readCheckoutReminderSettings(storage, "other-organization")).toThrow(
      "organization_identity_conflict",
    );
    expect(() =>
      captureCheckoutReminder(storage, { ...input(), organizationId: "other-organization" }),
    ).toThrow("organization_identity_conflict");
  });

  it("uses selective indexes for due work and cleanup", () => {
    const { db } = setup();
    for (const [query, index] of [
      [
        "SELECT id FROM checkout_reminders WHERE state = 'scheduled' AND due_at <= ? ORDER BY due_at,id LIMIT 100",
        "checkout_reminder_due",
      ],
      [
        "SELECT id FROM checkout_reminders WHERE state = 'sending' AND link_issued_at <= ? ORDER BY link_issued_at,id LIMIT 100",
        "checkout_reminder_inflight",
      ],
      [
        "SELECT id FROM checkout_reminders WHERE state IN ('scheduled','queued') AND generation < ? ORDER BY generation,id LIMIT 100",
        "checkout_reminder_generation",
      ],
      [
        "SELECT id FROM checkout_reminders WHERE cleanup_at IS NOT NULL AND cleanup_at <= ? ORDER BY cleanup_at,id LIMIT 100",
        "checkout_reminder_cleanup",
      ],
    ] as const) {
      const details = dbAllUnknown(db, `EXPLAIN QUERY PLAN ${query}`, "2020-01-01")
        .filter(isPlanDetailRow)
        .map((row) => row.detail)
        .join(" ");
      expect(details).toContain(index);
    }
  });
});
