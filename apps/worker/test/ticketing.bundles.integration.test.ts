import {
  organizationEventSchema,
  publicTicketPurchaseResponseSchema,
  publishedOrganizationProjectionSchema,
  ticketBundleSchema,
  ticketBundlesResponseSchema,
  ticketCheckoutResponseSchema,
  ticketScanResponseSchema,
} from "@choir/contracts";
import { exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  api,
  deliverQueuedTicketNotification,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

async function triggerScheduler(stub: DurableObjectStub<OrganizationStore>): Promise<void> {
  const overdueAt = new Date(Date.now() - 1_000).toISOString();
  await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
      overdueAt,
      overdueAt,
    );
    return state.storage.setAlarm(Date.now() + 60_000).then(() => undefined);
  });
  await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
}

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("Organization ticket bundles", () => {
  it("publishes capacity-safe bundle passes that validate at every included performance", async () => {
    const cookie = await signIn();
    const eventBody = {
      advancePriceCents: 2_000,
      callTime: "18:00",
      dayOfPriceCents: 2_500,
      details: "",
      doorsOpenTime: "18:30",
      durationMinutes: 90,
      isTicketingEnabled: true,
      location: "Main Hall",
      parentPerformanceId: null,
      publicDetails: "Public concert",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      setList: [],
      setListApproved: false,
      ticketCapacity: 2,
      rsvpDeadlineDate: "2027-09-24",
      type: "Performance" as const,
      venueId: null,
    };
    const firstEvent = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt: "2027-10-01T23:00:00.000Z", title: "Autumn Concert" },
          cookie,
        )
      ).json(),
    );
    const secondEvent = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt: "2027-12-01T23:00:00.000Z", title: "Winter Concert" },
          cookie,
        )
      ).json(),
    );
    const bundle = ticketBundleSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/bundles",
          "POST",
          {
            capacity: 2,
            eventIds: [firstEvent.id, secondEvent.id],
            isActive: true,
            priceCents: 3_000,
            saleEndAt: "2027-09-30T23:00:00.000Z",
            title: "Season Pass",
          },
          cookie,
        )
      ).json(),
    );
    expect(
      ticketBundlesResponseSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", "/api/organization/tickets/bundles", cookie),
          )
        ).json(),
      ).bundles,
    ).toHaveLength(1);
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/website/publish", cookie, { method: "POST" }),
        )
      ).status,
    ).toBe(200);
    const projection = publishedOrganizationProjectionSchema.parse(
      await (
        await exports.default.fetch(api("tickets.example.test", "/api/public/projection"))
      ).json(),
    );
    expect(projection.payload.ticketBundles).toEqual([
      expect.objectContaining({ eventIds: [firstEvent.id, secondEvent.id], id: bundle.id }),
    ]);

    const checkout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          bundleId: bundle.id,
          buyerEmail: "season@example.test",
          buyerName: "Season Buyer",
          checkoutRequestId: crypto.randomUUID(),
          marketingOptIn: false,
          quantity: 2,
        })
      ).json(),
    );
    expect(checkout.purchase).toMatchObject({
      bundleId: bundle.id,
      bundleTitle: "Season Pass",
      quantity: 2,
      unitPriceCents: 3_000,
    });
    expect(checkout.purchase.includedEvents.map(({ id }) => id)).toEqual([
      firstEvent.id,
      secondEvent.id,
    ]);
    expect(
      (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "late@example.test",
          buyerName: "Late Buyer",
          checkoutRequestId: crypto.randomUUID(),
          eventId: secondEvent.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).status,
    ).toBe(409);

    const receipt = publicTicketPurchaseResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "tickets.example.test",
            `/api/public/tickets/order?token=${encodeURIComponent(checkout.successToken)}`,
          ),
        )
      ).json(),
    );
    for (const eventId of [firstEvent.id, secondEvent.id]) {
      expect(
        ticketScanResponseSchema.parse(
          await (
            await jsonWrite(
              "alpha.localhost",
              "/api/organization/tickets/scan",
              "POST",
              { eventId, token: receipt.scanToken },
              cookie,
            )
          ).json(),
        ),
      ).toMatchObject({ eventId, valid: true });
    }
    const winterWillCall = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/tickets/will-call?eventId=${encodeURIComponent(secondEvent.id)}`,
        cookie,
      ),
    );
    expect(await winterWillCall.text()).toContain('"Season Buyer","season@example.test","2"');
    const bundleRefund = await jsonWrite(
      "alpha.localhost",
      `/api/organization/tickets/${encodeURIComponent(checkout.purchase.id)}/refund`,
      "POST",
      {},
      cookie,
    );
    expect(bundleRefund.status).toBe(200);
    expect(
      (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/tickets/bundles/${encodeURIComponent(bundle.id)}`,
            cookie,
            { method: "DELETE" },
          ),
        )
      ).status,
    ).toBe(409);
  });

  it("generates concert-specific reminder notifications for each included performance in a bundle and supports rescheduling", async () => {
    const cookie = await signIn();
    const eventBody = {
      advancePriceCents: 2_000,
      callTime: "18:00",
      dayOfPriceCents: 2_500,
      details: "",
      doorsOpenTime: "18:30",
      durationMinutes: 90,
      isTicketingEnabled: true,
      location: "Symphony Hall",
      parentPerformanceId: null,
      publicDetails: "Concert in series",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      setList: [],
      setListApproved: false,
      ticketCapacity: 10,
      rsvpDeadlineDate: "2030-01-01",
      type: "Performance" as const,
      venueId: null,
    };
    const now = Date.now();
    const firstStartsAt = new Date(now + 10 * 60 * 60 * 1000).toISOString();
    const secondStartsAt = new Date(now + 18 * 60 * 60 * 1000).toISOString();
    const firstEvent = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt: firstStartsAt, title: "Autumn Showcase" },
          cookie,
        )
      ).json(),
    );
    const secondEvent = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            ...eventBody,
            location: "Chamber Hall",
            startsAt: secondStartsAt,
            title: "Winter Prelude",
          },
          cookie,
        )
      ).json(),
    );
    const bundle = ticketBundleSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/bundles",
          "POST",
          {
            capacity: 10,
            eventIds: [firstEvent.id, secondEvent.id],
            isActive: true,
            priceCents: 3_500,
            saleEndAt: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
            title: "Two-Concert Bundle",
          },
          cookie,
        )
      ).json(),
    );
    const checkout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          bundleId: bundle.id,
          buyerEmail: "bundle.reminder@example.test",
          buyerName: "Bundle Reminder Buyer",
          checkoutRequestId: crypto.randomUUID(),
          marketingOptIn: false,
          quantity: 2,
        })
      ).json(),
    );
    expect(checkout.purchase.status).toBe("paid");

    const stub = stores.get(stores.idFromName("organization-alpha"));
    await triggerScheduler(stub);

    const reminderRows = await runInDurableObject<
      OrganizationStore,
      { eventId: string | null; id: string; kind: string; purchaseId: string; status: string }[]
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{
          eventId: string | null;
          id: string;
          kind: string;
          purchaseId: string;
          status: string;
        }>(
          `SELECT id, purchase_id AS purchaseId, event_id AS eventId, kind, status
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'
           ORDER BY event_id`,
          checkout.purchase.id,
        )
        .toArray(),
    );

    // Exactly two reminder rows exist, one for each event, both tied to the bundle purchase ID
    expect(reminderRows).toHaveLength(2);
    const firstReminder = reminderRows.find((r) => r.eventId === firstEvent.id);
    const secondReminder = reminderRows.find((r) => r.eventId === secondEvent.id);
    expect(firstReminder).toMatchObject({
      eventId: firstEvent.id,
      kind: "reminder",
      purchaseId: checkout.purchase.id,
      status: "queued",
    });
    expect(secondReminder).toMatchObject({
      eventId: secondEvent.id,
      kind: "reminder",
      purchaseId: checkout.purchase.id,
      status: "queued",
    });

    // Re-running scheduler for the same schedule does not create duplicate reminders
    await triggerScheduler(stub);
    const reminderCountAfterReplay = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout.purchase.id,
          )
          .one().count,
    );
    expect(reminderCountAfterReplay).toBe(2);

    // Inspect concert-specific notification job payload
    const outboxJobs = await runInDurableObject<
      OrganizationStore,
      { eventId: string | null; jobId: string }[]
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ eventId: string | null; jobId: string }>(
          `SELECT o.job_id AS jobId, n.event_id AS eventId
           FROM scheduled_job_outbox o
           JOIN ticket_notifications n ON n.id = substr(o.idempotency_key, 21)
           WHERE o.kind = 'ticket_notification' AND n.kind = 'reminder' AND n.purchase_id = ?`,
          checkout.purchase.id,
        )
        .toArray(),
    );
    expect(outboxJobs).toHaveLength(2);
    const firstOutboxJob = outboxJobs.find((j) => j.eventId === firstEvent.id);
    const secondOutboxJob = outboxJobs.find((j) => j.eventId === secondEvent.id);
    if (!firstOutboxJob || !secondOutboxJob) {
      throw new Error("Expected outbox jobs for both events");
    }

    const firstJobRead = await stub.fetch(
      `https://organization.internal/internal/ticketing/notification-job?organizationId=organization-alpha&jobId=${firstOutboxJob.jobId}`,
    );
    expect(firstJobRead.status).toBe(200);
    const firstPayload = await firstJobRead.json();
    expect(firstPayload).toMatchObject({
      eventLocation: "Symphony Hall",
      eventTitle: "Autumn Showcase",
      quantity: 2,
    });

    const secondJobRead = await stub.fetch(
      `https://organization.internal/internal/ticketing/notification-job?organizationId=organization-alpha&jobId=${secondOutboxJob.jobId}`,
    );
    expect(secondJobRead.status).toBe(200);
    const secondPayload = await secondJobRead.json();
    expect(secondPayload).toMatchObject({
      eventLocation: "Chamber Hall",
      eventTitle: "Winter Prelude",
      quantity: 2,
    });

    // Deliver confirmation and both reminders
    await deliverQueuedTicketNotification("organization-alpha"); // confirmation
    await deliverQueuedTicketNotification("organization-alpha"); // reminder 1
    await deliverQueuedTicketNotification("organization-alpha"); // reminder 2

    const sentCount = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder' AND status = 'sent'",
            checkout.purchase.id,
          )
          .one().count,
    );
    expect(sentCount).toBe(2);

    // Reschedule Event 2 after reminder was sent
    // 1. Move event 2 to a later date outside the reminder horizon (3 days out)
    const laterStartsAt = new Date(now + 72 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${secondEvent.id}`,
      "PUT",
      {
        ...eventBody,
        id: secondEvent.id,
        location: "Chamber Hall",
        startsAt: laterStartsAt,
        title: "Winter Prelude",
      },
      cookie,
    );

    // 2. Scheduler runs outside the new horizon: no second reminder yet
    await triggerScheduler(stub);
    const countOutsideHorizon = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND event_id = ?",
            checkout.purchase.id,
            secondEvent.id,
          )
          .one().count,
    );
    expect(countOutsideHorizon).toBe(1);

    // 3. Move event 2 into the new horizon (e.g., 6 hours from now)
    const revisedHorizonStartsAt = new Date(now + 6 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${secondEvent.id}`,
      "PUT",
      {
        ...eventBody,
        id: secondEvent.id,
        location: "Chamber Hall",
        startsAt: revisedHorizonStartsAt,
        title: "Winter Prelude",
      },
      cookie,
    );

    // 4. Scheduler runs inside the new horizon: second reminder is produced
    await triggerScheduler(stub);
    const remindersForSecondEvent = await runInDurableObject<
      OrganizationStore,
      { dedupeKey: string; id: string; status: string }[]
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ dedupeKey: string; id: string; status: string }>(
          `SELECT id, dedupe_key AS dedupeKey, status
           FROM ticket_notifications WHERE purchase_id = ? AND event_id = ?
           ORDER BY created_at`,
          checkout.purchase.id,
          secondEvent.id,
        )
        .toArray(),
    );
    expect(remindersForSecondEvent).toHaveLength(2);
    const [firstReminderForSecond, secondReminderForSecond] = remindersForSecondEvent;
    // Historical first reminder remains present and sent
    expect(firstReminderForSecond?.status).toBe("sent");
    // New reminder for revised date is queued
    expect(secondReminderForSecond?.status).toBe("queued");

    // 5. Repeated scheduler runs do not create a duplicate
    await triggerScheduler(stub);
    const countAfterSecondReplay = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND event_id = ?",
            checkout.purchase.id,
            secondEvent.id,
          )
          .one().count,
    );
    expect(countAfterSecondReplay).toBe(2);

    // 6. Deliver the revised reminder
    await deliverQueuedTicketNotification("organization-alpha");
    const finalSentForSecond = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND event_id = ? AND status = 'sent'",
            checkout.purchase.id,
            secondEvent.id,
          )
          .one().count,
    );
    expect(finalSentForSecond).toBe(2);
  });
});
