import {
  organizationEventSchema,
  organizationVenueSchema,
  discountCodeSchema,
  ticketCheckoutResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { seedAuthUser, futureIsoDate, futureDateString } from "@choir/testkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  readTicketPurchaseFromStore,
  readTicketNotificationJobFromStore,
} from "../src/organization/ticketingStore/queries";
import { queueTicketSaleAlert } from "../src/organization/ticketSaleAlerts";
import {
  setupTicketingIntegration,
  teardownTicketingIntegration,
  stores,
  database,
  api,
  jsonWrite,
  signIn,
} from "./ticketing.integration.fixture";

const ORG_ID = "organization-alpha";
const PUBLIC_HOST = "tickets.example.test";

const ORDINARY_USER_ID = "ordinary-member-user";
const ORDINARY_USER_EMAIL = "ordinary.singer@example.test";
const ORDINARY_PROFILE_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  await setupTicketingIntegration();
});

afterEach(async () => {
  await teardownTicketingIntegration();
});

async function setupTestEventAndOptInMember(options: {
  readonly optIn: boolean;
  readonly role?: "member" | "admin";
}) {
  const cookie = await signIn();

  // Create venue and event
  const venue = organizationVenueSchema.parse(
    await (
      await jsonWrite(
        "alpha.localhost",
        "/api/organization/venues",
        "POST",
        { address: "1 Stage Road", name: "Main Hall" },
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
          details: "Concert details",
          doorsOpenTime: "18:30",
          durationMinutes: 90,
          isTicketingEnabled: true,
          location: "Downtown",
          parentPerformanceId: null,
          publicDetails: "A public concert.",
          publicGraphicFileId: null,
          publishOnWebsite: true,
          setList: [],
          setListApproved: false,
          startsAt: futureIsoDate(),
          ticketCapacity: 10,
          title: "Winter Festival",
          type: "Performance",
          rsvpDeadlineDate: futureDateString({ days: 14 }),
          venueId: venue.id,
        },
        cookie,
      )
    ).json(),
  );

  // Publish website so public checkout is active
  await exports.default.fetch(
    api("alpha.localhost", "/api/organization/website/publish", cookie, { method: "POST" }),
  );

  // Setup ordinary user in D1 and profile in DO
  const now = new Date().toISOString();
  await seedAuthUser(database, ORDINARY_USER_ID, ORDINARY_USER_EMAIL, "Ordinary Singer");
  await database
    .prepare(
      `INSERT OR REPLACE INTO member (id, organizationId, userId, role, profileId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `member-${ORDINARY_USER_ID}`,
      ORG_ID,
      ORDINARY_USER_ID,
      options.role ?? "member",
      ORDINARY_PROFILE_ID,
      now,
    )
    .run();

  const stub = stores.get(stores.idFromName(ORG_ID));
  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO profiles
        (id, display_name, voice_part, global_status, do_not_email, provider_email_suppressed,
         receive_financial_alerts, created_at, updated_at)
       VALUES (?, 'Ordinary Singer', 'S1', 'Active', 0, 0, ?, ?, ?)`,
      ORDINARY_PROFILE_ID,
      options.optIn ? 1 : 0,
      now,
      now,
    );
    return null;
  });

  return { cookie, event };
}

describe("Ticket Sale Alerts integration", () => {
  it("queues Ticket Sale Alert on paid purchase to ordinary linked member with flag on", async () => {
    const { event } = await setupTestEventAndOptInMember({ optIn: true, role: "member" });

    const checkoutRequestId = crypto.randomUUID();
    const checkoutResponse = await jsonWrite(PUBLIC_HOST, "/api/public/tickets/checkout", "POST", {
      buyerEmail: "buyer@example.test",
      buyerName: "Ticket Buyer",
      checkoutRequestId,
      eventId: event.id,
      marketingOptIn: false,
      quantity: 2,
    });
    expect(checkoutResponse.status).toBe(201);
    const checkout = ticketCheckoutResponseSchema.parse(await checkoutResponse.json());

    // Check DO communication messages and deliveries
    const stub = stores.get(stores.idFromName(ORG_ID));
    const alertMessage = await runInDurableObject<
      OrganizationStore,
      {
        readonly content: string;
        readonly dedupeKey: string;
        readonly destination: string;
        readonly subject: string;
      } | null
    >(stub, (_instance, state) => {
      return (
        state.storage.sql
          .exec<{
            readonly content: string;
            readonly dedupeKey: string;
            readonly destination: string;
            readonly subject: string;
          }>(
            `SELECT m.content_markdown AS content, m.dedupe_key AS dedupeKey,
                    d.destination, m.subject
             FROM communication_messages m
             JOIN communication_deliveries d ON d.message_id = m.id
             WHERE m.dedupe_key = ? LIMIT 1`,
            `ticket-sale-alert:${checkout.purchase.id}`,
          )
          .toArray()
          .at(0) ?? null
      );
    });

    expect(alertMessage).not.toBeNull();
    expect(alertMessage?.destination).toBe(ORDINARY_USER_EMAIL);
    expect(alertMessage?.subject).toContain("Ticket sale: Winter Festival — 2 × $41.50");
    expect(alertMessage?.content).toContain("Ticket Buyer");
    expect(alertMessage?.content).toContain("buyer@example.test");
    expect(alertMessage?.content).toContain("/admin/tickets");

    const receipt = await runInDurableObject(stub, (_instance, state) => {
      return (
        state.storage.sql
          .exec<{
            readonly body: string;
            readonly recipient_profile_id: string;
            readonly title: string;
          }>(
            "SELECT title, body, recipient_profile_id FROM notification_receipts WHERE source_key = ? LIMIT 1",
            `ticket-sale-alert:${checkout.purchase.id}`,
          )
          .toArray()
          .at(0) ?? null
      );
    });
    expect(receipt).not.toBeNull();
    expect(receipt?.recipient_profile_id).toBe(ORDINARY_PROFILE_ID);
    expect(receipt?.title).toBe("Ticket sale: Winter Festival");
  });

  it("queues Ticket Sale Alert on complimentary / $0 purchase with $0.00 amount", async () => {
    const { cookie, event } = await setupTestEventAndOptInMember({ optIn: true });

    // Create 100% off discount code
    const freeCode = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/discount-codes",
          "POST",
          {
            code: "COMP100",
            discountType: "percentage",
            discountValue: 100,
            eventId: event.id,
            itemType: "performance",
          },
          cookie,
        )
      ).json(),
    );

    const checkoutRequestId = crypto.randomUUID();
    const checkoutResponse = await jsonWrite(PUBLIC_HOST, "/api/public/tickets/checkout", "POST", {
      buyerEmail: "comp.buyer@example.test",
      buyerName: "Comp Buyer",
      checkoutRequestId,
      discountCode: freeCode.code,
      eventId: event.id,
      marketingOptIn: false,
      quantity: 1,
    });
    expect(checkoutResponse.status).toBe(201);
    const checkout = ticketCheckoutResponseSchema.parse(await checkoutResponse.json());
    expect(checkout.purchase.amountPaidCents).toBe(0);

    const stub = stores.get(stores.idFromName(ORG_ID));
    const alertMessage = await runInDurableObject<
      OrganizationStore,
      { readonly content: string; readonly subject: string } | null
    >(stub, (_instance, state) => {
      return (
        state.storage.sql
          .exec<{ readonly content: string; readonly subject: string }>(
            `SELECT m.content_markdown AS content, m.subject
             FROM communication_messages m
             WHERE m.dedupe_key = ? LIMIT 1`,
            `ticket-sale-alert:${checkout.purchase.id}`,
          )
          .toArray()
          .at(0) ?? null
      );
    });

    expect(alertMessage).not.toBeNull();
    expect(alertMessage?.subject).toContain("Ticket sale: Winter Festival — 1 × $0.00");
    expect(alertMessage?.content).toContain("$0.00");
    expect(alertMessage?.content).toContain("Comp Buyer");
  });

  it("queues nothing when no members are opted in to financial alerts", async () => {
    const { event } = await setupTestEventAndOptInMember({ optIn: false });

    const checkoutRequestId = crypto.randomUUID();
    const checkoutResponse = await jsonWrite(PUBLIC_HOST, "/api/public/tickets/checkout", "POST", {
      buyerEmail: "another.buyer@example.test",
      buyerName: "Another Buyer",
      checkoutRequestId,
      eventId: event.id,
      marketingOptIn: false,
      quantity: 1,
    });
    expect(checkoutResponse.status).toBe(201);
    const checkout = ticketCheckoutResponseSchema.parse(await checkoutResponse.json());

    const stub = stores.get(stores.idFromName(ORG_ID));
    const alertMessage = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) => {
        return state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM communication_messages WHERE dedupe_key = ?",
            `ticket-sale-alert:${checkout.purchase.id}`,
          )
          .one().count;
      },
    );

    expect(alertMessage).toBe(0);
  });

  it("purchase still succeeds when ticket sale alert queueing fails", async () => {
    const { event } = await setupTestEventAndOptInMember({ optIn: true });

    // Mock D1 database prepare to throw inside queueTicketSaleAlert
    const originalPrepare = database.prepare.bind(database);
    database.prepare = (query: string) => {
      if (query.includes("FROM member m")) {
        throw new Error("Simulated database failure during alert queueing");
      }
      return originalPrepare(query);
    };

    try {
      const checkoutRequestId = crypto.randomUUID();
      const checkoutResponse = await jsonWrite(
        PUBLIC_HOST,
        "/api/public/tickets/checkout",
        "POST",
        {
          buyerEmail: "resilient.buyer@example.test",
          buyerName: "Resilient Buyer",
          checkoutRequestId,
          eventId: event.id,
          marketingOptIn: false,
          quantity: 1,
        },
      );
      // Purchase MUST still succeed!
      expect(checkoutResponse.status).toBe(201);
    } finally {
      database.prepare = originalPrepare;
    }
  });

  it("dedupe key prevents doubles on replay", async () => {
    const { event } = await setupTestEventAndOptInMember({ optIn: true });

    const purchaseId = crypto.randomUUID();
    const input = {
      amountPaidCents: 2000,
      buyerEmail: "replay.buyer@example.test",
      buyerName: "Replay Buyer",
      currency: "usd",
      eventId: event.id,
      eventTitle: "Winter Festival",
      orderUrl: "https://tickets.example.test/admin/tickets",
      organizationId: ORG_ID,
      purchaseId,
      quantity: 1,
      requestId: crypto.randomUUID(),
    };

    // First queue call
    const firstResult = await queueTicketSaleAlert(
      {
        CONTROL_DB: database,
        ORGANIZATION_STORE: stores,
        SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
      },
      input,
    );
    expect(firstResult).not.toBeNull();

    // Replay call with exact same purchaseId
    const replayResult = await queueTicketSaleAlert(
      {
        CONTROL_DB: database,
        ORGANIZATION_STORE: stores,
        SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
      },
      input,
    );
    expect(replayResult).not.toBeNull();

    // Verify only ONE message exists in communication_messages for this purchaseId
    const stub = stores.get(stores.idFromName(ORG_ID));
    const messageCount = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) => {
        return state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM communication_messages WHERE dedupe_key = ?",
            `ticket-sale-alert:${purchaseId}`,
          )
          .one().count;
      },
    );

    expect(messageCount).toBe(1);
  });

  it.each(["UTC", "America/New_York"])(
    "preserves a %s purchase snapshot after the Organization timezone changes",
    async (snapshotTimezone) => {
      const { cookie, event } = await setupTestEventAndOptInMember({ optIn: true });
      expect(
        (
          await jsonWrite(
            "alpha.localhost",
            "/api/organization/calendar-settings",
            "PUT",
            { timezone: snapshotTimezone },
            cookie,
          )
        ).status,
      ).toBe(200);
      const checkoutResponse = await jsonWrite(
        PUBLIC_HOST,
        "/api/public/tickets/checkout",
        "POST",
        {
          buyerEmail: "snapshot@example.test",
          buyerName: "Snapshot Buyer",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event.id,
          marketingOptIn: false,
          quantity: 1,
        },
      );
      expect(checkoutResponse.status).toBe(201);
      const { purchase } = ticketCheckoutResponseSchema.parse(await checkoutResponse.json());
      expect(purchase.timezone).toBe(snapshotTimezone);
      expect(
        (
          await jsonWrite(
            "alpha.localhost",
            "/api/organization/calendar-settings",
            "PUT",
            { timezone: "America/Los_Angeles" },
            cookie,
          )
        ).status,
      ).toBe(200);
      const stub = stores.get(stores.idFromName(ORG_ID));
      const snapshots = await runInDurableObject<
        OrganizationStore,
        { purchase: unknown; notification: unknown }
      >(stub, async (_instance, state) => {
        const job = state.storage.sql
          .exec<{ jobId: string }>(
            `SELECT o.job_id AS jobId FROM scheduled_job_outbox o
         JOIN ticket_notifications n ON o.idempotency_key = 'ticket-notification:' || n.id
         WHERE n.purchase_id = ? AND n.kind = 'confirmation' LIMIT 1`,
            purchase.id,
          )
          .one();
        return {
          purchase: await readTicketPurchaseFromStore(state.storage, ORG_ID, purchase.id).json(),
          notification: await readTicketNotificationJobFromStore(
            state.storage,
            ORG_ID,
            job.jobId,
          ).json(),
        };
      });
      expect(snapshots.purchase).toMatchObject({ timezone: snapshotTimezone });
      expect(snapshots.notification).toMatchObject({ timezone: snapshotTimezone });

      // Also cover the explicit-timezone alert path: UTC must not be treated as missing.
      const alertId = crypto.randomUUID();
      await queueTicketSaleAlert(
        {
          CONTROL_DB: database,
          ORGANIZATION_STORE: stores,
          SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
        },
        {
          amountPaidCents: 2000,
          buyerEmail: "snapshot@example.test",
          buyerName: "Snapshot Buyer",
          currency: "usd",
          eventId: event.id,
          eventStartsAt: event.startsAt,
          eventTitle: event.title,
          orderUrl: "https://tickets.example.test/admin/tickets",
          organizationId: ORG_ID,
          purchaseId: alertId,
          quantity: 1,
          requestId: crypto.randomUUID(),
          timezone: snapshotTimezone,
        },
      );
      const content = await runInDurableObject<OrganizationStore, string>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ content: string }>(
              "SELECT content_markdown AS content FROM communication_messages WHERE dedupe_key = ?",
              `ticket-sale-alert:${alertId}`,
            )
            .one().content,
      );
      expect(content).toContain(
        new Intl.DateTimeFormat("en-US", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: snapshotTimezone,
        }).format(new Date(event.startsAt)),
      );
    },
  );

  it("formats ticket sale alert email in the Organization's configured timezone (3:00 PM EST, never 8:00 PM UTC)", async () => {
    const { cookie } = await setupTestEventAndOptInMember({ optIn: true, role: "member" });

    // Configure Organization timezone to America/New_York
    const calendarRes = await jsonWrite(
      "alpha.localhost",
      "/api/organization/calendar-settings",
      "PUT",
      {
        timezone: "America/New_York",
      },
      cookie,
    );
    expect(calendarRes.status).toBe(200);

    const venue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "1 Stage Road", name: "Christmas Hall" },
          cookie,
        )
      ).json(),
    );

    // 2026-12-13T20:00:00.000Z is 3:00 PM EST in America/New_York (and 8:00 PM in UTC)
    const christmasConcert = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            advancePriceCents: 2_000,
            callTime: "14:00",
            dayOfPriceCents: 2_500,
            details: "Christmas Concert details",
            doorsOpenTime: "14:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Downtown",
            parentPerformanceId: null,
            publicDetails: "Christmas Concert",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2026-12-13T20:00:00.000Z", // historic-fixture
            ticketCapacity: 50,
            title: "2026 Christmas Concert",
            type: "Performance",
            rsvpDeadlineDate: futureDateString({ days: 14 }),
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );

    await exports.default.fetch(
      api("alpha.localhost", "/api/organization/website/publish", cookie, { method: "POST" }),
    );

    const checkoutResponse = await jsonWrite(PUBLIC_HOST, "/api/public/tickets/checkout", "POST", {
      buyerEmail: "robin@example.test",
      buyerName: "Robin Leach",
      checkoutRequestId: crypto.randomUUID(),
      eventId: christmasConcert.id,
      marketingOptIn: false,
      quantity: 2,
    });
    expect(checkoutResponse.status).toBe(201);
    const checkout = ticketCheckoutResponseSchema.parse(await checkoutResponse.json());

    const stub = stores.get(stores.idFromName(ORG_ID));
    const alertMessage = await runInDurableObject<
      OrganizationStore,
      { readonly content: string; readonly subject: string } | null
    >(stub, (_instance, state) => {
      return (
        state.storage.sql
          .exec<{ readonly content: string; readonly subject: string }>(
            `SELECT m.content_markdown AS content, m.subject
             FROM communication_messages m
             WHERE m.dedupe_key = ? LIMIT 1`,
            `ticket-sale-alert:${checkout.purchase.id}`,
          )
          .toArray()
          .at(0) ?? null
      );
    });

    expect(alertMessage).not.toBeNull();
    expect(alertMessage?.content).toContain("Sunday, December 13, 2026 at 3:00 PM");
    expect(alertMessage?.content).not.toContain("8:00 PM");

    // Also verify that calling queueTicketSaleAlert with eventTitle + eventStartsAt but WITHOUT
    // passing timezone still resolves America/New_York from the store instead of defaulting to UTC
    const fallbackPurchaseId = crypto.randomUUID();
    const fallbackAlert = await queueTicketSaleAlert(
      {
        CONTROL_DB: database,
        ORGANIZATION_STORE: stores,
        SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
      },
      {
        amountPaidCents: 2000,
        buyerEmail: "fallback@example.test",
        buyerName: "Fallback Buyer",
        currency: "usd",
        eventId: christmasConcert.id,
        eventStartsAt: "2026-12-13T20:00:00.000Z", // historic-fixture
        eventTitle: "2026 Christmas Concert",
        orderUrl: "https://tickets.example.test/admin/tickets",
        organizationId: ORG_ID,
        purchaseId: fallbackPurchaseId,
        quantity: 1,
        requestId: crypto.randomUUID(),
      },
    );
    expect(fallbackAlert).not.toBeNull();

    const fallbackMessage = await runInDurableObject<
      OrganizationStore,
      { readonly content: string } | null
    >(stub, (_instance, state) => {
      return (
        state.storage.sql
          .exec<{ readonly content: string }>(
            `SELECT m.content_markdown AS content
             FROM communication_messages m
             WHERE m.dedupe_key = ? LIMIT 1`,
            `ticket-sale-alert:${fallbackPurchaseId}`,
          )
          .toArray()
          .at(0) ?? null
      );
    });
    expect(fallbackMessage?.content).toContain("Sunday, December 13, 2026 at 3:00 PM");
    expect(fallbackMessage?.content).not.toContain("8:00 PM");
  });
});
