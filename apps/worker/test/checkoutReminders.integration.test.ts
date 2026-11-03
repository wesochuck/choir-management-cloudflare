import { createMessageBatch, getQueueResult, createExecutionContext } from "cloudflare:test";
import { processDeliveryBatch } from "../src/jobs/consumer";
import { env, exports, api, signIn, jsonWrite } from "./ticketing.integration.fixture";
import { issueSignedLink } from "../src/security/signedLinks";
import { deliverCheckoutReminder } from "../src/jobs/deliveries/checkoutReminders";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { runInDurableObject } from "cloudflare:test";
import {
  stores,
  setupTicketingIntegration,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  captureCheckoutReminder,
  stopCheckoutReminders,
  setCheckoutReminderSettings,
  cancelCheckoutReminderAfterPayment,
  cleanupCheckoutReminders,
} from "../src/organization/checkoutReminderStore";
import {
  scheduleCheckoutReminderJobs,
  claimCheckoutReminder,
  recordCheckoutReminderResult,
  confirmCheckoutReminderSend,
  expireUncertainCheckoutReminderClaims,
} from "../src/organization/checkoutReminderDeliveryStore";
import { listCommunicationHistoryFromStore } from "../src/organization/communicationStore/historyQueries";

const organizationId = "organization-alpha";
const stub = () => stores.getByName(organizationId);
function seed(storage: DurableObjectStorage) {
  const now = Date.now();
  const startedAt = new Date(now - 25 * 3600000).toISOString();
  storage.sql.exec(
    "UPDATE checkout_reminder_settings SET enabled_since = ?",
    new Date(now - 48 * 3600000).toISOString(),
  );
  const resourceId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  storage.sql.exec(
    `INSERT INTO donations(id,checkout_request_id,status,amount_cents,buyer_name,buyer_email,provider_session_id,created_at,updated_at) VALUES(?,?,'pending',5000,'Donor','donor@example.org',?,?,?)`,
    resourceId,
    attemptId,
    `cs_${crypto.randomUUID()}`,
    startedAt,
    startedAt,
  );
  const captured = captureCheckoutReminder(storage, {
    organizationId,
    attemptId,
    startedAt,
    choices: {
      kind: "donation",
      resourceId,
      email: "donor@example.org",
      bundleId: null,
      eventIds: [],
      quantity: null,
      amountCents: 5000,
      levelId: null,
      discountCode: null,
    },
  });
  if (!captured.id) throw new Error("Missing captured reminder");
  return { id: captured.id, resourceId, attemptId };
}
function seedTicketReminder(
  storage: DurableObjectStorage,
  options: { hours?: number; capacity?: number; quantity?: number; canceled?: boolean } = {},
) {
  const base = seed(storage);
  const eventId = crypto.randomUUID();
  const resourceId = crypto.randomUUID();
  const now = new Date().toISOString();
  const startedAt = new Date(Date.now() - 25 * 3600000).toISOString();
  const startsAt = new Date(Date.now() + (options.hours ?? 48) * 3600000).toISOString();
  storage.sql.exec(
    `INSERT INTO events(id,title,type,starts_at,is_ticketing_enabled,publish_on_website,ticket_capacity,is_canceled,created_at,updated_at) VALUES(?,'Spring Concert','Performance',?,1,1,?,?,?,?)`,
    eventId,
    startsAt,
    options.capacity ?? 100,
    options.canceled ? 1 : 0,
    now,
    now,
  );
  storage.sql.exec(
    `INSERT INTO ticket_purchases(id,checkout_request_id,event_id,event_title,event_starts_at,event_timezone,buyer_name,buyer_email,quantity,unit_price_cents,fee_cents,amount_paid_cents,provider_session_id,status,created_at,updated_at) VALUES(?,?,?,'Spring Concert',?,'America/New_York','Buyer','donor@example.org',?,5000,0,5000,?,'expired',?,?)`,
    resourceId,
    crypto.randomUUID(),
    eventId,
    startsAt,
    options.quantity ?? 1,
    `cs_${crypto.randomUUID()}`,
    startedAt,
    now,
  );
  const choices = {
    kind: "ticket",
    resourceId,
    bundleId: null,
    email: "donor@example.org",
    eventIds: [eventId],
    quantity: options.quantity ?? 1,
    amountCents: 5000,
    levelId: null,
    discountCode: null,
  };
  storage.sql.exec(
    "UPDATE checkout_reminders SET kind='ticket',resource_id=?,choices_json=? WHERE id=?",
    resourceId,
    JSON.stringify(choices),
    base.id,
  );
  storage.sql.exec(
    "INSERT INTO checkout_reminder_performances(reminder_id,performance_id) VALUES(?,?)",
    base.id,
    eventId,
  );
  return { ...base, eventId, resourceId };
}

const claim = (id: string) => ({ organizationId, id, externallySuppressed: false, profileIds: [] });

describe("checkout reminders on real Organization storage", () => {
  it("delivers through the fake provider and does not resend a replay", async () => {
    const id = await runInDurableObject<OrganizationStore, string>(stub(), (_instance, state) => {
      const reminder = seed(state.storage);
      scheduleCheckoutReminderJobs(state.storage, organizationId, new Date());
      return reminder.id;
    });
    const job = {
      attempt: 1,
      idempotencyKey: `checkout-reminder:${id}`,
      jobId: id,
      organizationId,
      kind: "checkout_reminder" as const,
      version: 1 as const,
    };
    await deliverCheckoutReminder(env, job);
    await deliverCheckoutReminder(env, job);
    await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
      const row = state.storage.sql
        .exec<{ state: string; providerId: string }>(
          "SELECT state,provider_message_id AS providerId FROM checkout_reminders WHERE id = ?",
          id,
        )
        .one();
      expect(row.state).toBe("sent");
      expect(row.providerId).toBe(`fake:${id}`);
    });
  });
  it("binds recovery to purpose, Organization and current nonce", async () => {
    const delivery = await runInDurableObject(stub(), (_instance, state) => {
      const reminder = seed(state.storage);
      scheduleCheckoutReminderJobs(state.storage, organizationId, new Date());
      const captured = claimCheckoutReminder(state.storage, claim(reminder.id));
      if (!captured) throw new Error("Missing delivery");
      recordCheckoutReminderResult(state.storage, {
        organizationId,
        id: reminder.id,
        state: "sent",
        reason: null,
        providerMessageId: "fake",
      });
      return captured;
    });
    const token = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      version: 1,
      organizationId,
      purpose: "checkout_recovery",
      issuedAt: delivery.issuedAt,
      expiresAt: delivery.expiresAt,
      resourceId: delivery.id,
      nonce: delivery.nonce,
    });
    const read = (host: string, value: string) =>
      exports.default.fetch(
        api(host, `/api/public/checkout-reminders/recovery?token=${encodeURIComponent(value)}`),
      );
    const response = await read("alpha.localhost", token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await read("tickets.example.test", token)).status).toBe(200);
    const projection = await response.json();
    expect(projection).not.toHaveProperty("buyerName");
    expect((await read("bravo.localhost", token)).status).toBe(404);
    const wrong = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      version: 1,
      organizationId,
      purpose: "donation_receipt",
      issuedAt: delivery.issuedAt,
      expiresAt: delivery.expiresAt,
      resourceId: delivery.id,
      nonce: delivery.nonce,
    });
    expect((await read("alpha.localhost", wrong)).status).toBe(404);
    await runInDurableObject(stub(), (_instance, state) => {
      cancelCheckoutReminderAfterPayment(state.storage, {
        organizationId,
        kind: "donation",
        email: "donor@example.org",
        performanceIds: [],
        paidAt: new Date().toISOString(),
      });
    });
    expect((await read("alpha.localhost", token)).status).toBe(404);
  });

  beforeEach(setupTicketingIntegration);
  afterEach(teardownTicketingIntegration);
  it("schedules one stable job and claims only one send", async () => {
    await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
      const reminder = seed(state.storage);
      expect(scheduleCheckoutReminderJobs(state.storage, organizationId, new Date())).toBe(1);
      expect(scheduleCheckoutReminderJobs(state.storage, organizationId, new Date())).toBe(0);
      const first = claimCheckoutReminder(state.storage, claim(reminder.id));
      expect(first?.choices.email).toBe("donor@example.org");
      expect(first?.contentMarkdown).toContain("If you changed your mind");
      expect(claimCheckoutReminder(state.storage, claim(reminder.id))).toBeNull();
      recordCheckoutReminderResult(state.storage, {
        organizationId,
        id: reminder.id,
        state: "sent",
        reason: null,
        providerMessageId: "fake:sent",
      });
      expect(claimCheckoutReminder(state.storage, claim(reminder.id))).toBeNull();
    });
  });
  it.each(["optout", "disable", "suppression", "payment"])(
    "blocks %s after enqueue",
    async (mode) => {
      await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
        const reminder = seed(state.storage);
        scheduleCheckoutReminderJobs(state.storage, organizationId, new Date());
        if (mode === "optout") {
          const recipient = state.storage.sql
            .exec<{ id: string }>(
              "SELECT id FROM checkout_reminder_recipients WHERE email = 'donor@example.org'",
            )
            .one();
          stopCheckoutReminders(state.storage, { organizationId, recipientId: recipient.id });
        }
        if (mode === "disable")
          setCheckoutReminderSettings(state.storage, {
            organizationId,
            enabled: false,
            actorUserId: "manager",
            requestId: crypto.randomUUID(),
          });
        if (mode === "payment")
          cancelCheckoutReminderAfterPayment(state.storage, {
            organizationId,
            kind: "donation",
            email: "donor@example.org",
            performanceIds: [],
            paidAt: new Date().toISOString(),
          });
        expect(
          claimCheckoutReminder(state.storage, {
            ...claim(reminder.id),
            externallySuppressed: mode === "suppression",
          }),
        ).toBeNull();
      });
    },
  );
  it.each([{ hours: 23 }, { capacity: 1, quantity: 2 }, { canceled: true }])(
    "skips ticket reminders outside availability/cutoff rules: %j",
    async (options) => {
      await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
        const reminder = seedTicketReminder(state.storage, options);
        scheduleCheckoutReminderJobs(state.storage, organizationId, new Date());
        expect(claimCheckoutReminder(state.storage, claim(reminder.id))).toBeNull();
      });
    },
  );
  it("rechecks opt-out after claiming and before crossing the provider boundary", async () => {
    await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
      const reminder = seed(state.storage);
      scheduleCheckoutReminderJobs(state.storage, organizationId, new Date());
      const delivery = claimCheckoutReminder(state.storage, claim(reminder.id));
      if (!delivery) throw new Error("Missing delivery");
      stopCheckoutReminders(state.storage, { organizationId, recipientId: delivery.recipientId });
      expect(confirmCheckoutReminderSend(state.storage, claim(reminder.id))).toBe(false);
    });
  });
  it("does not send again after a lost provider result and releases a stale claim conservatively", async () => {
    await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
      const reminder = seed(state.storage);
      scheduleCheckoutReminderJobs(state.storage, organizationId, new Date());
      expect(claimCheckoutReminder(state.storage, claim(reminder.id))).not.toBeNull();
      expect(
        expireUncertainCheckoutReminderClaims(state.storage, new Date(Date.now() + 16 * 60000)),
      ).toBe(1);
      expect(claimCheckoutReminder(state.storage, claim(reminder.id))).toBeNull();
      const recipient = state.storage.sql
        .exec<{ claimId: string | null; lastSentAt: string | null }>(
          "SELECT claim_id AS claimId,last_sent_at AS lastSentAt FROM checkout_reminder_recipients WHERE email='donor@example.org'",
        )
        .one();
      expect(recipient.claimId).toBeNull();
      expect(recipient.lastSentAt).not.toBeNull();
    });
  });

  it.each(["contact", "profile"])("honors existing %s email suppression", async (kind) => {
    await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
      const reminder = seed(state.storage);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      if (kind === "contact") {
        state.storage.sql.exec(
          "INSERT INTO contacts(id,email,normalized_email,created_at,updated_at) VALUES(?,'donor@example.org','donor@example.org',?,?)",
          id,
          now,
          now,
        );
        state.storage.sql.exec(
          "INSERT INTO contact_communication_preferences(contact_id,channel,status,observed_at,updated_at) VALUES(?,'email','unsubscribed',?,?)",
          id,
          now,
          now,
        );
      } else
        state.storage.sql.exec(
          "INSERT INTO profiles(id,display_name,do_not_email,created_at,updated_at) VALUES(?,'Donor',1,?,?)",
          id,
          now,
          now,
        );
      scheduleCheckoutReminderJobs(state.storage, organizationId, new Date());
      expect(
        claimCheckoutReminder(state.storage, {
          ...claim(reminder.id),
          profileIds: kind === "profile" ? [id] : [],
        }),
      ).toBeNull();
    });
  });
  it("keeps the stop credential separate from recovery and idempotent after history cleanup", async () => {
    const recipientId = await runInDurableObject<OrganizationStore, string>(
      stub(),
      (_instance, state) => {
        seed(state.storage);
        return state.storage.sql
          .exec<{ id: string }>(
            "SELECT id FROM checkout_reminder_recipients WHERE email='donor@example.org'",
          )
          .one().id;
      },
    );
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      version: 1,
      organizationId,
      purpose: "checkout_reminder_unsubscribe",
      issuedAt,
      expiresAt: issuedAt + 365 * 86400,
      subjectId: recipientId,
    });
    const path = "/api/public/checkout-reminders/stop";
    const scanner = await exports.default.fetch(
      api("alpha.localhost", `${path}?token=${encodeURIComponent(token)}`),
    );
    expect(scanner.status).toBe(404);
    await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ flag: number }>(
            "SELECT opted_out AS flag FROM checkout_reminder_recipients WHERE id=?",
            recipientId,
          )
          .one().flag,
      ).toBe(0);
    });
    expect((await jsonWrite("bravo.localhost", path, "POST", { token })).status).toBe(404);
    expect((await jsonWrite("alpha.localhost", path, "POST", { token })).status).toBe(200);
    await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
      cleanupCheckoutReminders(state.storage, new Date(Date.now() + 91 * 86400000).toISOString());
    });
    expect((await jsonWrite("alpha.localhost", path, "POST", { token })).status).toBe(200);
  });
  it("exposes settings only to authorized Organization managers", async () => {
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/checkout-reminder-settings"),
        )
      ).status,
    ).toBe(401);
    const cookie = await signIn();
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/checkout-reminder-settings",
          "PUT",
          { enabled: false },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await jsonWrite(
          "bravo.localhost",
          "/api/organization/checkout-reminder-settings",
          "PUT",
          { enabled: false },
          cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/checkout-reminder-settings",
          "PUT",
          { enabled: "false" },
          cookie,
        )
      ).status,
    ).toBe(400);
  });
  it("acknowledges a replay through the real queue consumer without a second send", async () => {
    const id = await runInDurableObject<OrganizationStore, string>(stub(), (_instance, state) => {
      const reminder = seed(state.storage);
      scheduleCheckoutReminderJobs(state.storage, organizationId, new Date());
      return reminder.id;
    });
    for (const messageId of ["reminder-first", "reminder-replay"]) {
      const batch = createMessageBatch("choir-management-jobs-local", [
        {
          attempts: 1,
          id: messageId,
          timestamp: new Date(),
          body: {
            attempt: 1,
            idempotencyKey: `checkout-reminder:${id}`,
            jobId: id,
            kind: "checkout_reminder",
            organizationId,
            version: 1,
          },
        },
      ]);
      await processDeliveryBatch(batch, env);
      expect(await getQueueResult(batch, createExecutionContext())).toMatchObject({
        explicitAcks: [messageId],
      });
    }
    await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ status: string }>("SELECT status FROM job_ledger WHERE job_id=?", id)
          .one().status,
      ).toBe("completed");
      expect(
        state.storage.sql
          .exec<{ state: string }>("SELECT state FROM checkout_reminders WHERE id=?", id)
          .one().state,
      ).toBe("sent");
    });
  });
  it("shows scheduled and skipped history without private links", async () => {
    const result = await runInDurableObject<OrganizationStore, string>(
      stub(),
      (_instance, state) => {
        seed(state.storage);
        return listCommunicationHistoryFromStore(state.storage, {
          organizationId,
          origin: "automated",
        }).text();
      },
    );
    expect(result).toContain("checkout_reminder");
    expect(result).toContain("donor@example.org");
    expect(result).not.toContain("nonce");
    expect(result).not.toContain("token=");
  });
  it("preserves the opt-out after 90-day terminal-history cleanup", async () => {
    await runInDurableObject<OrganizationStore, undefined>(stub(), (_instance, state) => {
      seed(state.storage);
      const recipient = state.storage.sql
        .exec<{ id: string }>(
          "SELECT id FROM checkout_reminder_recipients WHERE email = 'donor@example.org'",
        )
        .one();
      stopCheckoutReminders(state.storage, { organizationId, recipientId: recipient.id });
      expect(
        cleanupCheckoutReminders(state.storage, new Date(Date.now() + 91 * 86400000).toISOString())
          .removed,
      ).toBe(1);
      expect(
        state.storage.sql
          .exec<{ optedOut: number }>(
            "SELECT opted_out AS optedOut FROM checkout_reminder_recipients WHERE id = ?",
            recipient.id,
          )
          .one().optedOut,
      ).toBe(1);
    });
  });
});
