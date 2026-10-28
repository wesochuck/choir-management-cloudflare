import {
  organizationEventSchema,
  organizationVenueSchema,
  ticketCheckoutResponseSchema,
} from "@choir/contracts";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  setupTicketingIntegration,
  teardownTicketingIntegration,
  stores,
  jsonWrite,
  signIn,
  deliverQueuedTicketNotification,
  triggerScheduler,
} from "./ticketing.integration.fixture";

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("Organization ticketing notifications and reminders", () => {
  it.each(["", "18:30"])(
    "queues confirmation and reminder emails with optional doors-open time %s",
    async (doorsOpenTime) => {
      const cookie = await signIn();
      const startsAt = new Date(Date.now() + 35 * 60 * 60 * 1000).toISOString();
      const reminderVenue = organizationVenueSchema.parse(
        await (
          await jsonWrite(
            "alpha.localhost",
            "/api/organization/venues",
            "POST",
            { address: "2 Reminder Road", name: "Reminder Hall" },
            cookie,
          )
        ).json(),
      );
      const event = organizationEventSchema.parse(
        await (
          await jsonWrite(
            "alpha.localhost",
            "/api/organization/events",
            "POST",
            {
              advancePriceCents: 1_500,
              callTime: "",
              dayOfPriceCents: 1_500,
              details: "",
              doorsOpenTime,
              durationMinutes: 60,
              isTicketingEnabled: true,
              location: "Hall",
              parentPerformanceId: null,
              publicDetails: "",
              publicGraphicFileId: null,
              publishOnWebsite: true,
              setList: [],
              setListApproved: false,
              startsAt,
              ticketCapacity: 20,
              title: "Tomorrow Concert",
              type: "Performance",
              rsvpDeadlineDate: "2030-01-01",
              venueId: reminderVenue.id,
            },
            cookie,
          )
        ).json(),
      );
      expect(
        (
          await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
            buyerEmail: "reminder@example.test",
            buyerName: "Reminder Buyer",
            checkoutRequestId: crypto.randomUUID(),
            eventId: event.id,
            marketingOptIn: false,
            quantity: 1,
          })
        ).status,
      ).toBe(201);
      const stub = stores.get(stores.idFromName("organization-alpha"));
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
      const notificationKinds = await runInDurableObject<OrganizationStore, string[]>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<Record<string, SqlStorageValue> & { kind: string }>(
              "SELECT kind FROM ticket_notifications ORDER BY kind",
            )
            .toArray()
            .map(({ kind }) => kind),
      );
      expect(event.doorsOpenTime).toBe(doorsOpenTime);
      expect(notificationKinds).toEqual(["confirmation", "reminder"]);
      await deliverQueuedTicketNotification("organization-alpha");
      await deliverQueuedTicketNotification("organization-alpha");
      expect(
        await runInDurableObject<OrganizationStore, number>(
          stub,
          (_instance, state) =>
            state.storage.sql
              .exec<Record<string, SqlStorageValue> & { count: number }>(
                "SELECT COUNT(*) AS count FROM ticket_notifications WHERE status = 'sent'",
              )
              .one().count,
        ),
      ).toBe(2);
      const rendered = await runInDurableObject<OrganizationStore, string[]>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ content: string }>(
              "SELECT rendered_content_markdown AS content FROM ticket_notifications ORDER BY kind",
            )
            .toArray()
            .map((row) => row.content),
      );
      expect(rendered).toHaveLength(2);
      for (const content of rendered) {
        if (doorsOpenTime) expect(content).toContain("**Doors open:** 18:30");
        else expect(content).not.toContain("Doors open");
      }
    },
  );

  it("wakes the Organization scheduler promptly on Stripe ticket completion and enqueues confirmation", async () => {
    const cookie = await signIn();
    const fulfillmentVenue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "4 Fulfillment Road", name: "Fulfillment Hall" },
          cookie,
        )
      ).json(),
    );
    const event = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            advancePriceCents: 2_000,
            callTime: "18:00",
            dayOfPriceCents: 2_500,
            details: "Stripe fulfillment test performance",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Hall A",
            parentPerformanceId: null,
            publicDetails: "Public notes",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            rsvpDeadlineDate: "2027-10-10",
            rsvpFollowUpLeadHours: null,
            rsvpFollowUpMode: "inherit",
            setList: [],
            setListApproved: false,
            startsAt: "2027-10-15T19:00:00Z",
            ticketCapacity: 50,
            title: "Stripe Fulfillment Event",
            type: "Performance",
            venueId: fulfillmentVenue.id,
          },
          cookie,
        )
      ).json(),
    );
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event.id}/tickets/settings`,
      "PUT",
      {
        currency: "usd",
        enabled: true,
        pricingTiers: [
          {
            capacity: 50,
            description: "General admission",
            id: "tier-general",
            name: "General",
            priceCents: 2_500,
          },
        ],
        salesCutoffMinutes: 60,
        salesOpen: true,
        timezone: "America/New_York",
      },
      cookie,
    );

    const stub = stores.get(stores.idFromName("organization-alpha"));
    const pendingPurchaseId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const pendingSessionId = `pending_session_${pendingPurchaseId}`;
    const providerPaymentId = `pi_${pendingPurchaseId}`;
    const stripeEventId = `evt_stripe_${pendingPurchaseId}`;

    // 1. Create a Stripe pending purchase
    const pendingResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "create_stripe_pending",
          checkout: {
            buyerEmail: "stripe.buyer@example.test",
            buyerName: "Stripe Buyer",
            checkoutRequestId,
            eventId: event.id,
            marketingOptIn: false,
            quantity: 2,
          },
          organizationId: "organization-alpha",
          providerSessionId: pendingSessionId,
          purchaseId: pendingPurchaseId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(pendingResponse.status).toBe(201);

    // 2. Put Organization alarm sufficiently far in the future
    const distantFutureAlarm = Date.now() + 3_600_000;
    await runInDurableObject<OrganizationStore, undefined>(stub, async (_instance, state) => {
      await state.storage.setAlarm(distantFutureAlarm);
      return undefined;
    });
    const beforeAlarm = await runInDurableObject<OrganizationStore, number | null>(
      stub,
      async (_instance, state) => state.storage.getAlarm(),
    );
    expect(beforeAlarm).toBe(distantFutureAlarm);

    // 3. Invoke stripe_ticket_completed
    const completeResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_completed",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId,
          providerSessionId: pendingSessionId,
          stripeEventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(completeResponse.status).toBe(200);

    // 4. Assert purchase is paid, confirmation + outbox exist, and alarm moved promptly forward
    const checkState = await runInDurableObject<
      OrganizationStore,
      {
        alarm: number | null;
        notificationCount: number;
        notificationStatus: string | null;
        outboxCount: number;
        purchaseStatus: string | null;
      }
    >(stub, async (_instance, state) => {
      const alarm = await state.storage.getAlarm();
      const purchase = state.storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM ticket_purchases WHERE id = ? LIMIT 1",
          pendingPurchaseId,
        )
        .toArray()
        .at(0);
      const notification = state.storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM ticket_notifications WHERE purchase_id = ? LIMIT 1",
          pendingPurchaseId,
        )
        .toArray()
        .at(0);
      const outbox = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE kind = 'ticket_notification'",
        )
        .toArray()
        .at(0);
      return {
        alarm,
        notificationCount: notification ? 1 : 0,
        notificationStatus: notification?.status ?? null,
        outboxCount: outbox?.count ?? 0,
        purchaseStatus: purchase?.status ?? null,
      };
    });

    expect(checkState.purchaseStatus).toBe("paid");
    expect(checkState.notificationCount).toBe(1);
    expect(checkState.notificationStatus).toBe("queued");
    expect(checkState.outboxCount).toBe(1);
    expect(checkState.alarm).not.toBeNull();
    expect(checkState.alarm).toBeLessThan(distantFutureAlarm);
    expect(checkState.alarm).toBeLessThanOrEqual(Date.now() + 5_000);

    // 5. Run Durable Object alarm -> marks outbox enqueued
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const enqueuedState = await runInDurableObject<OrganizationStore, boolean>(
      stub,
      (_instance, state) => {
        const outbox = state.storage.sql
          .exec<{ enqueuedAt: string | null }>(
            "SELECT enqueued_at AS enqueuedAt FROM scheduled_job_outbox WHERE kind = 'ticket_notification' LIMIT 1",
          )
          .toArray()
          .at(0);
        return Boolean(outbox?.enqueuedAt);
      },
    );
    expect(enqueuedState).toBe(true);

    // 6. Deliver queued job and assert delivery result recorded
    await deliverQueuedTicketNotification("organization-alpha");
    const deliveredStatus = await runInDurableObject<OrganizationStore, string | null>(
      stub,
      (_instance, state) => {
        const notification = state.storage.sql
          .exec<{ status: string }>(
            "SELECT status FROM ticket_notifications WHERE purchase_id = ? LIMIT 1",
            pendingPurchaseId,
          )
          .toArray()
          .at(0);
        return notification?.status ?? null;
      },
    );
    expect(deliveredStatus).toBe("sent");

    // 7. Replay same Stripe webhook -> assert no duplicate confirmation/outbox work
    const replayResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_completed",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId,
          providerSessionId: pendingSessionId,
          stripeEventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toMatchObject({ duplicate: true });

    const postReplayState = await runInDurableObject<
      OrganizationStore,
      { notificationCount: number; outboxCount: number }
    >(stub, (_instance, state) => {
      const notifications = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ?",
          pendingPurchaseId,
        )
        .toArray()
        .at(0);
      const outbox = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE kind = 'ticket_notification'",
        )
        .toArray()
        .at(0);
      return {
        notificationCount: notifications?.count ?? 0,
        outboxCount: outbox?.count ?? 0,
      };
    });
    expect(postReplayState.notificationCount).toBe(1);
    expect(postReplayState.outboxCount).toBe(1);
  });

  it("handles ticket reminder creation and delivery when performances are rescheduled before or after reminders exist", async () => {
    const cookie = await signIn();
    const rescheduleVenue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "5 Reschedule Road", name: "Reschedule Hall" },
          cookie,
        )
      ).json(),
    );
    const eventBody = {
      advancePriceCents: 1_500,
      callTime: "",
      dayOfPriceCents: 1_500,
      details: "",
      doorsOpenTime: "",
      durationMinutes: 60,
      isTicketingEnabled: true,
      location: "Grand Hall",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      setList: [],
      setListApproved: false,
      ticketCapacity: 20,
      title: "Reschedule Test Concert",
      type: "Performance" as const,
      rsvpDeadlineDate: "2030-01-01",
      venueId: rescheduleVenue.id,
    };
    const now = Date.now();

    // SCENARIO 1: Rescheduled before any reminder exists
    // 1. Create event just outside the 36-hour reminder window
    const event1StartsAt = new Date(now + 37 * 60 * 60 * 1000).toISOString();
    const event1 = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt: event1StartsAt, title: "Future Concert 1" },
          cookie,
        )
      ).json(),
    );
    // Paid checkout
    const checkout1 = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "reschedule1@example.test",
          buyerName: "Buyer 1",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event1.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    expect(checkout1.purchase.status).toBe("paid");

    const stub = stores.get(stores.idFromName("organization-alpha"));

    // 2. Scheduler runs while outside horizon: no reminder generated
    await triggerScheduler(stub);
    const remindersBeforeMove = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(remindersBeforeMove).toBe(0);

    // 3. Move event into the 36-hour reminder horizon (35 hours from now)
    const revised1StartsAt = new Date(now + 35 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event1.id}`,
      "PUT",
      { ...eventBody, id: event1.id, startsAt: revised1StartsAt, title: "Future Concert 1" },
      cookie,
    );

    // 4. Scheduler runs inside new horizon: exactly one reminder produced for the new date
    await triggerScheduler(stub);
    const remindersAfterMove = await runInDurableObject<
      OrganizationStore,
      { dedupeKey: string; status: string }[]
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ dedupeKey: string; status: string }>(
          `SELECT dedupe_key AS dedupeKey, status
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout1.purchase.id,
        )
        .toArray(),
    );
    expect(remindersAfterMove).toHaveLength(1);
    const [firstReminderAfterMove] = remindersAfterMove;
    expect(firstReminderAfterMove?.dedupeKey).toBe(
      `ticket-reminder:${checkout1.purchase.id}:${event1.id}:${revised1StartsAt}`,
    );
    expect(firstReminderAfterMove?.status).toBe("queued");

    // 5. Repeated scheduler runs do not duplicate
    await triggerScheduler(stub);
    const countAfterReplay1 = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(countAfterReplay1).toBe(1);

    // Deliver confirmation and reminder
    await deliverQueuedTicketNotification("organization-alpha"); // confirmation
    await deliverQueuedTicketNotification("organization-alpha"); // reminder
    const sentCount1 = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder' AND status = 'sent'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(sentCount1).toBe(1);

    // SCENARIO 2: Rescheduled after reminder was sent
    // 1. Move event1 to 4 days out (outside horizon)
    const laterStartsAt = new Date(now + 96 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event1.id}`,
      "PUT",
      { ...eventBody, id: event1.id, startsAt: laterStartsAt, title: "Future Concert 1" },
      cookie,
    );

    // 2. Scheduler runs outside new horizon: no second reminder yet
    await triggerScheduler(stub);
    const countOutside2 = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(countOutside2).toBe(1);

    // 3. Move event1 to 8 hours out (inside new horizon)
    const secondRevisedStartsAt = new Date(now + 8 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event1.id}`,
      "PUT",
      { ...eventBody, id: event1.id, startsAt: secondRevisedStartsAt, title: "Future Concert 1" },
      cookie,
    );

    // 4. Scheduler runs inside new horizon: second reminder is produced
    await triggerScheduler(stub);
    const remindersAfterSecondMove = await runInDurableObject<
      OrganizationStore,
      { dedupeKey: string; status: string }[]
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ dedupeKey: string; status: string }>(
          `SELECT dedupe_key AS dedupeKey, status
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'
           ORDER BY created_at`,
          checkout1.purchase.id,
        )
        .toArray(),
    );
    expect(remindersAfterSecondMove).toHaveLength(2);
    const [firstHistorical, secondQueued] = remindersAfterSecondMove;
    // Historical first reminder is still sent
    expect(firstHistorical?.status).toBe("sent");
    expect(firstHistorical?.dedupeKey).toBe(
      `ticket-reminder:${checkout1.purchase.id}:${event1.id}:${revised1StartsAt}`,
    );
    // Second reminder is queued
    expect(secondQueued?.status).toBe("queued");
    expect(secondQueued?.dedupeKey).toBe(
      `ticket-reminder:${checkout1.purchase.id}:${event1.id}:${secondRevisedStartsAt}`,
    );

    // 5. Repeated scheduler runs do not duplicate
    await triggerScheduler(stub);
    const countAfterReplay2 = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(countAfterReplay2).toBe(2);

    // Deliver second reminder
    await deliverQueuedTicketNotification("organization-alpha");
    const finalSentCount = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder' AND status = 'sent'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(finalSentCount).toBe(2);

    // SCENARIO 3: Rescheduled while old reminder is queued
    // 1. Create a new event within 36h horizon
    const event2StartsAt = new Date(now + 14 * 60 * 60 * 1000).toISOString();
    const event2 = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt: event2StartsAt, title: "Queued Reschedule Concert" },
          cookie,
        )
      ).json(),
    );
    const checkout2 = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "queued.reschedule@example.test",
          buyerName: "Buyer 2",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event2.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    // Deliver confirmation for checkout2
    await deliverQueuedTicketNotification("organization-alpha");

    // 2. Scheduler runs and creates reminder for original date (queued)
    await triggerScheduler(stub);
    const queuedReminder = await runInDurableObject<
      OrganizationStore,
      { dedupeKey: string; failureDetail: string; status: string } | undefined
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ dedupeKey: string; failureDetail: string; status: string }>(
          `SELECT dedupe_key AS dedupeKey, status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout2.purchase.id,
        )
        .toArray()
        .at(0),
    );
    expect(queuedReminder?.status).toBe("queued");

    // 3. Before delivery, update event2's start time to 5 days in the future
    const event2RescheduledAt = new Date(now + 120 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event2.id}`,
      "PUT",
      {
        ...eventBody,
        id: event2.id,
        startsAt: event2RescheduledAt,
        title: "Queued Reschedule Concert",
      },
      cookie,
    );

    // 4. Verify the queued reminder was marked suppressed with 'Performance rescheduled'
    const suppressedReminder = await runInDurableObject<
      OrganizationStore,
      { failureDetail: string; status: string } | undefined
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ failureDetail: string; status: string }>(
          `SELECT status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout2.purchase.id,
        )
        .toArray()
        .at(0),
    );
    expect(suppressedReminder).toMatchObject({
      failureDetail: "Performance rescheduled",
      status: "suppressed",
    });

    // 5. Deliver the queued notification job — verifies it cannot be delivered with old-date semantics
    await deliverQueuedTicketNotification("organization-alpha");
    // Verify it remains suppressed and never reached sent
    const staleReminderAfterDeliver = await runInDurableObject<
      OrganizationStore,
      { failureDetail: string; status: string } | undefined
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ failureDetail: string; status: string }>(
          `SELECT status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout2.purchase.id,
        )
        .toArray()
        .at(0),
    );
    expect(staleReminderAfterDeliver?.status).toBe("suppressed");

    // 6. Move event2 into the horizon (e.g. 5 hours out)
    const event2RevisedStartsAt = new Date(now + 5 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event2.id}`,
      "PUT",
      {
        ...eventBody,
        id: event2.id,
        startsAt: event2RevisedStartsAt,
        title: "Queued Reschedule Concert",
      },
      cookie,
    );

    // 7. Scheduler runs inside new horizon: new reminder is generated for revised occurrence
    await triggerScheduler(stub);
    const event2Reminders = await runInDurableObject<
      OrganizationStore,
      { dedupeKey: string; failureDetail: string; status: string }[]
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ dedupeKey: string; failureDetail: string; status: string }>(
          `SELECT dedupe_key AS dedupeKey, status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'
           ORDER BY created_at`,
          checkout2.purchase.id,
        )
        .toArray(),
    );
    expect(event2Reminders).toHaveLength(2);
    const [firstEvent2Reminder, secondEvent2Reminder] = event2Reminders;
    // Historical stale reminder
    expect(firstEvent2Reminder?.status).toBe("suppressed");
    expect(firstEvent2Reminder?.failureDetail).toBe("Performance rescheduled");
    // New reminder for revised occurrence
    expect(secondEvent2Reminder?.status).toBe("queued");
    expect(secondEvent2Reminder?.dedupeKey).toBe(
      `ticket-reminder:${checkout2.purchase.id}:${event2.id}:${event2RevisedStartsAt}`,
    );

    // 8. Deliver new reminder: reaches sent
    await deliverQueuedTicketNotification("organization-alpha");
    const event2FinalSent = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder' AND status = 'sent'",
            checkout2.purchase.id,
          )
          .one().count,
    );
    expect(event2FinalSent).toBe(1);
  });

  it("suppresses queued reminders when an event is canceled or archived", async () => {
    const cookie = await signIn();
    const cancelVenue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "6 Cancel Road", name: "Cancel Hall" },
          cookie,
        )
      ).json(),
    );
    const eventBody = {
      advancePriceCents: 1_500,
      callTime: "",
      dayOfPriceCents: 1_500,
      details: "",
      doorsOpenTime: "",
      durationMinutes: 60,
      isTicketingEnabled: true,
      location: "Grand Hall",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      setList: [],
      setListApproved: false,
      ticketCapacity: 20,
      title: "Cancellation Test Concert",
      type: "Performance" as const,
      rsvpDeadlineDate: "2030-01-01",
      venueId: cancelVenue.id,
    };
    const now = Date.now();
    const startsAt = new Date(now + 12 * 60 * 60 * 1000).toISOString();
    const event = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt },
          cookie,
        )
      ).json(),
    );
    const checkout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "cancel.test@example.test",
          buyerName: "Cancel Buyer",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    await deliverQueuedTicketNotification("organization-alpha"); // confirmation

    const stub = stores.get(stores.idFromName("organization-alpha"));
    await triggerScheduler(stub);

    // Cancel the event
    const cancelRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event.id}/cancel`,
      "POST",
      {},
      cookie,
    );
    expect(cancelRes.status).toBe(200);

    // Check that the queued reminder was marked suppressed
    const reminderStatus = await runInDurableObject<
      OrganizationStore,
      { failureDetail: string; status: string } | undefined
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ failureDetail: string; status: string }>(
          `SELECT status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout.purchase.id,
        )
        .toArray()
        .at(0),
    );
    expect(reminderStatus).toMatchObject({
      failureDetail: "Performance canceled",
      status: "suppressed",
    });

    // Attempt delivery: handles cleanly without error
    await deliverQueuedTicketNotification("organization-alpha");

    // Re-running scheduler does not recreate reminder for canceled event
    await triggerScheduler(stub);
    const reminderCount = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout.purchase.id,
          )
          .one().count,
    );
    expect(reminderCount).toBe(1);
  });
});
