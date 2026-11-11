import { describe, expect, it } from "vitest";
import { createFreshContactContext, runMigrations } from "./contactTestkit";
import { organizationSchemaMigrations } from "./schema/migrations";
import {
  cancelTicketNotification,
  failTicketNotification,
  readTicketNotificationDetails,
  suppressRefundedTicketNotifications,
} from "./ticketNotificationManagement";

function setup() {
  const context = createFreshContactContext("org-a");
  const { db } = context;
  const now = new Date().toISOString();
  const purchaseId = crypto.randomUUID();
  const notificationId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ticket_purchases
    (id,checkout_request_id,event_id,event_title,event_starts_at,event_timezone,buyer_name,buyer_email,
     quantity,unit_price_cents,fee_cents,amount_paid_cents,currency,provider_session_id,provider_payment_id,
     status,marketing_opt_in,created_at,updated_at)
    VALUES (?,?,'event','Concert',?,'UTC','Test Buyer','buyer@example.test',1,100,0,100,'usd','','','paid',0,?,?)`,
  ).run(purchaseId, crypto.randomUUID(), now, now, now);
  db.prepare(
    `INSERT INTO ticket_notifications
    (id,purchase_id,event_id,dedupe_key,kind,destination,subject,content_markdown,status,scheduled_for,created_at,updated_at)
    VALUES (?,?,'event',?,'confirmation','buyer@example.test','Confirmation','Tickets','queued',?,?,?)`,
  ).run(notificationId, purchaseId, `ticket-confirmation:${purchaseId}`, now, now, now);
  const scope = { organizationId: "org-a", notificationId };
  const input = {
    ...scope,
    actorUserId: "user-a",
    requestId: crypto.randomUUID(),
    reason: "Refunded test order",
  };
  return { ...context, now, purchaseId, notificationId, scope, input };
}

describe("ticket notification management on migrated SQLite", () => {
  it("scopes details and cancellation, preserves the order, and audits cancellation exactly once", () => {
    const c = setup();
    expect(
      readTicketNotificationDetails(c.storage, { ...c.scope, organizationId: "org-b" }),
    ).toBeNull();
    expect(cancelTicketNotification(c.storage, { ...c.input, organizationId: "org-b" })).toEqual({
      status: "not_found",
    });
    expect(readTicketNotificationDetails(c.storage, c.scope)).toMatchObject({
      buyerName: "Test Buyer",
      canCancel: true,
      providerStatus: null,
      jobAttempts: null,
    });
    expect(cancelTicketNotification(c.storage, c.input)).toEqual({ status: "canceled" });
    expect(cancelTicketNotification(c.storage, c.input)).toEqual({ status: "canceled" });
    expect(
      c.db.prepare("SELECT status FROM ticket_purchases WHERE id=?").get(c.purchaseId),
    ).toMatchObject({ status: "paid" });
    expect(
      c.db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action='ticket.notification.canceled'",
        )
        .get(),
    ).toMatchObject({ count: 1 });
    expect(readTicketNotificationDetails(c.storage, c.scope)).toMatchObject({
      status: "suppressed",
      canCancel: false,
      failureDetail: c.input.reason,
    });
  });
  it("rejects active claims and provider-accepted/completed notifications", () => {
    const c = setup();
    c.db
      .prepare(
        `INSERT INTO job_ledger (idempotency_key,job_id,kind,status,attempt,claimed_at)
      VALUES (?,'job','ticket_notification','claimed',1,?)`,
      )
      .run(`ticket-notification:${c.notificationId}`, c.now);
    expect(cancelTicketNotification(c.storage, c.input)).toEqual({ status: "conflict" });
    c.db.prepare("UPDATE job_ledger SET status='failed'").run();
    expect(readTicketNotificationDetails(c.storage, c.scope)).toMatchObject({ canCancel: true });
    c.db.prepare("UPDATE ticket_notifications SET provider_message_id='accepted'").run();
    expect(cancelTicketNotification(c.storage, c.input)).toEqual({ status: "conflict" });
    c.db.prepare("UPDATE ticket_notifications SET status='sent',provider_message_id=NULL").run();
    expect(cancelTicketNotification(c.storage, c.input)).toEqual({ status: "conflict" });
  });
  it("updates failed jobs without reopening suppressed records and suppresses unsent refund messages", () => {
    const c = setup();
    failTicketNotification(c.storage, `ticket-notification:${c.notificationId}`, c.now);
    expect(readTicketNotificationDetails(c.storage, c.scope)?.status).toBe("failed");
    suppressRefundedTicketNotifications(c.storage, c.purchaseId, c.now);
    failTicketNotification(c.storage, `ticket-notification:${c.notificationId}`, c.now);
    expect(readTicketNotificationDetails(c.storage, c.scope)?.status).toBe("suppressed");
    c.db.prepare("UPDATE ticket_notifications SET kind='refund',status='queued'").run();
    suppressRefundedTicketNotifications(c.storage, c.purchaseId, c.now);
    expect(readTicketNotificationDetails(c.storage, c.scope)?.status).toBe("queued");
  });
  it("repairs populated historical stores and preserves sent/refund notifications", () => {
    const c = setup();
    c.db.prepare("DELETE FROM organization_schema_migrations WHERE version=141").run();
    c.db.prepare("UPDATE ticket_purchases SET status='refunded',refunded_at=?").run(c.now);
    c.db.prepare("UPDATE ticket_notifications SET status='processing'").run();
    runMigrations(c.db);
    expect(readTicketNotificationDetails(c.storage, c.scope)?.status).toBe("suppressed");
    c.db.prepare("UPDATE ticket_notifications SET status='sent'").run();
    for (const statement of organizationSchemaMigrations.find(
      (migration) => migration.version === 141,
    )?.statements ?? [])
      c.db.exec(statement);
    expect(readTicketNotificationDetails(c.storage, c.scope)?.status).toBe("sent");
  });
  it("repairs failed job/source divergence without a recurring scan", () => {
    const c = setup();
    c.db
      .prepare(
        `INSERT INTO job_ledger (idempotency_key,job_id,kind,status,attempt,claimed_at)
      VALUES (?,'job','ticket_notification','failed',6,?)`,
      )
      .run(`ticket-notification:${c.notificationId}`, c.now);
    for (const statement of organizationSchemaMigrations.find(
      (migration) => migration.version === 141,
    )?.statements ?? [])
      c.db.exec(statement);
    expect(readTicketNotificationDetails(c.storage, c.scope)?.status).toBe("failed");
  });
});
