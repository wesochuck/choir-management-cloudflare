import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ticketNotificationDetailsSchema,
  communicationHistoryPageResponseSchema,
} from "@choir/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { readTicketNotificationJobFromStore } from "../src/organization/ticketingStore/queries";
import { failJob, terminalJob } from "../src/organization/organizationStore/provision";
import {
  refundFakePurchase,
  refundStripeTicketPurchases,
} from "../src/organization/ticketingStore/payments";
import {
  setupTicketingIntegration,
  teardownTicketingIntegration,
  stores,
  signIn,
  jsonWrite,
  exports,
  api,
  deliverQueuedTicketNotification,
} from "./ticketing.integration.fixture";

beforeEach(setupTicketingIntegration);
afterEach(teardownTicketingIntegration);

async function seed(status: "paid" | "refunded" = "refunded") {
  const notificationId = crypto.randomUUID();
  const purchaseId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const stub = stores.getByName("organization-alpha");
  await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
    const now = new Date().toISOString();
    state.storage.sql.exec(
      `INSERT INTO ticket_purchases
      (id,checkout_request_id,event_id,event_title,event_starts_at,event_timezone,buyer_name,buyer_email,
       quantity,unit_price_cents,fee_cents,amount_paid_cents,currency,provider_session_id,provider_payment_id,
       status,marketing_opt_in,created_at,updated_at,refunded_at)
      VALUES (?,?,'11111111-1111-4111-8111-111111111111','Concert',?,'UTC','Test Buyer','buyer@example.test',1,100,0,100,'usd',?,'',?,0,?,?,?)`,
      purchaseId,
      crypto.randomUUID(),
      now,
      crypto.randomUUID(),
      status,
      now,
      now,
      status === "refunded" ? now : null,
    );
    state.storage.sql.exec(
      `INSERT INTO ticket_notifications
      (id,purchase_id,event_id,dedupe_key,kind,destination,subject,content_markdown,status,scheduled_for,created_at,updated_at)
      VALUES (?,?,'11111111-1111-4111-8111-111111111111',?,'confirmation','buyer@example.test','Confirmation','Tickets','queued',?,?,?)`,
      notificationId,
      purchaseId,
      `ticket-confirmation:${purchaseId}`,
      now,
      now,
      now,
    );
    state.storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id,kind,idempotency_key,due_at,created_at)
      VALUES (?,'ticket_notification',?,?,?)`,
      jobId,
      `ticket-notification:${notificationId}`,
      now,
      now,
    );
    return undefined;
  });
  return {
    stub,
    notificationId,
    purchaseId,
    jobId,
    path: `/api/organization/communications/ticket-notifications/${notificationId}`,
  };
}

describe("ticket notification routes, RPC and delivery safety", () => {
  it("authorizes details/cancel, validates reasons, retains audit history and shows skipped", async () => {
    const c = await seed();
    const cookie = await signIn();
    expect((await exports.default.fetch(api("alpha.localhost", c.path))).status).toBe(401);
    expect((await exports.default.fetch(api("bravo.localhost", c.path, cookie))).status).toBe(403);
    const response = await exports.default.fetch(api("alpha.localhost", c.path, cookie));
    expect(response.status).toBe(200);
    expect(ticketNotificationDetailsSchema.parse(await response.json())).toMatchObject({
      purchaseId: c.purchaseId,
      purchaseStatus: "refunded",
      canCancel: true,
    });
    expect(
      (await jsonWrite("alpha.localhost", `${c.path}/cancel`, "POST", { reason: " " }, cookie))
        .status,
    ).toBe(400);
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          `${c.path}/cancel`,
          "POST",
          { reason: "Refunded test" },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          `${c.path}/cancel`,
          "POST",
          { reason: "Refunded test" },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      await c.stub.readTicketNotificationDetails({
        organizationId: "organization-bravo",
        notificationId: c.notificationId,
      }),
    ).toBeNull();
    const history = communicationHistoryPageResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/history?status=skipped", cookie),
        )
      ).json(),
    );
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "automated",
          scheduledMessage: expect.objectContaining({ id: c.notificationId, status: "Skipped" }),
        }),
      ]),
    );
    await deliverQueuedTicketNotification("organization-alpha");
    expect(
      await c.stub.readTicketNotificationDetails({
        organizationId: "organization-alpha",
        notificationId: c.notificationId,
      }),
    ).toMatchObject({ status: "suppressed", providerMessageId: null });
    const count = await runInDurableObject<OrganizationStore, number>(
      c.stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action='ticket.notification.canceled'",
          )
          .one().count,
    );
    expect(count).toBe(1);
  });
  it("suppresses refunded confirmations at the delivery boundary", async () => {
    const c = await seed();
    const result = await runInDurableObject<OrganizationStore, unknown>(
      c.stub,
      async (_instance, state) =>
        await readTicketNotificationJobFromStore(
          state.storage,
          "organization-alpha",
          c.jobId,
        ).json(),
    );
    expect(result).toMatchObject({
      status: "suppressed",
      failureDetail: "Order refunded before delivery",
    });
  });
  it("rolls back cancellation when its audit record cannot be saved", async () => {
    const c = await seed();
    await runInDurableObject<OrganizationStore, undefined>(c.stub, (_instance, state) => {
      state.storage.sql
        .exec(`CREATE TRIGGER reject_notification_cancel_audit BEFORE INSERT ON audit_events
        WHEN NEW.action='ticket.notification.canceled' BEGIN SELECT RAISE(ABORT,'test audit rollback'); END`);
      return undefined;
    });
    await runInDurableObject<OrganizationStore, undefined>(c.stub, (instance, state) => {
      expect(() =>
        instance.cancelTicketNotification({
          organizationId: "organization-alpha",
          notificationId: c.notificationId,
          actorUserId: "ticket-manager",
          requestId: crypto.randomUUID(),
          reason: "Refunded test",
        }),
      ).toThrow("test audit rollback");
      expect(
        state.storage.sql
          .exec<{ status: string }>(
            "SELECT status FROM ticket_notifications WHERE id=?",
            c.notificationId,
          )
          .one().status,
      ).toBe("queued");
      return undefined;
    });
  });
  it.each(["fake", "stripe"])(
    "suppresses unsent messages in the %s refund transaction and retains the refund receipt",
    async (mode) => {
      const c = await seed("paid");
      await runInDurableObject<OrganizationStore, undefined>(c.stub, (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE ticket_purchases SET provider_payment_id='pi_test' WHERE id=?",
          c.purchaseId,
        );
        const result =
          mode === "fake"
            ? refundFakePurchase(state.storage, {
                action: "refund_fake_purchase",
                organizationId: "organization-alpha",
                actorUserId: "ticket-manager",
                purchaseId: c.purchaseId,
                requestId: crypto.randomUUID(),
              })
            : refundStripeTicketPurchases(state.storage, {
                action: "stripe_ticket_refunded",
                organizationId: "organization-alpha",
                providerPaymentId: "pi_test",
                stripeEventId: "evt_test_refund",
              });
        expect(result.response.status).toBe(200);
        expect(
          state.storage.sql
            .exec<{ status: string }>(
              "SELECT status FROM ticket_notifications WHERE id=?",
              c.notificationId,
            )
            .one().status,
        ).toBe("suppressed");
        expect(
          state.storage.sql
            .exec<{ status: string }>(
              "SELECT status FROM ticket_notifications WHERE purchase_id=? AND kind='refund'",
              c.purchaseId,
            )
            .one().status,
        ).toBe("queued");
        return undefined;
      });
    },
  );
  it("updates failed/terminal sources and permits a normal retry with the same job", async () => {
    const c = await seed("paid");
    await runInDurableObject<OrganizationStore, undefined>(c.stub, async (_instance, state) => {
      const now = new Date().toISOString();
      const key = `ticket-notification:${c.notificationId}`;
      state.storage.sql.exec(
        `INSERT INTO job_ledger (idempotency_key,job_id,kind,status,attempt,claimed_at)
        VALUES (?,?,'ticket_notification','claimed',1,?)`,
        key,
        c.jobId,
        now,
      );
      await failJob(
        state.storage,
        new Request("https://internal/fail", {
          method: "POST",
          body: JSON.stringify({ attempt: 1, failedAt: now, idempotencyKey: key, jobId: c.jobId }),
        }),
      );
      expect(
        state.storage.sql
          .exec<{ status: string }>(
            "SELECT status FROM ticket_notifications WHERE id=?",
            c.notificationId,
          )
          .one().status,
      ).toBe("failed");
      const retry = await readTicketNotificationJobFromStore(
        state.storage,
        "organization-alpha",
        c.jobId,
      ).json();
      expect(retry).toMatchObject({ status: "queued" });
      await terminalJob(
        state.storage,
        new Request("https://internal/terminal", {
          method: "POST",
          body: JSON.stringify({
            attempt: 6,
            failedAt: now,
            terminalAt: now,
            errorCode: "delivery_failed",
            idempotencyKey: key,
            jobId: c.jobId,
          }),
        }),
      );
      expect(
        state.storage.sql
          .exec<{ status: string }>(
            "SELECT status FROM ticket_notifications WHERE id=?",
            c.notificationId,
          )
          .one().status,
      ).toBe("failed");
      return undefined;
    });
  });
});
