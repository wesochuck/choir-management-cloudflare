import {
  organizationEventSchema,
  organizationTicketOrderSchema,
  organizationTicketOrdersResponseSchema,
  organizationVenueSchema,
  publicTicketPurchaseResponseSchema,
  publishedOrganizationProjectionSchema,
  ticketCheckoutResponseSchema,
  ticketBundleSchema,
  ticketBundlesResponseSchema,
  ticketScanResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";

const USER_EMAIL = "tickets.manager@example.test";

function binding<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return value;
}

const database = binding(env.CONTROL_DB, "CONTROL_DB");
const stores = binding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function jsonWrite(
  host: string,
  path: string,
  method: "POST" | "PUT",
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    }),
  );
}

async function provision(id: string, slug: string, role: "admin" | "member"): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 23, ?, ?, ?)`,
      )
      .bind(id, `Organization ${slug}`, slug, id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, id, `${slug}.localhost`, now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, 'ticket-manager', ?, ?)`,
      )
      .bind(`member-${slug}`, id, role, Date.now()),
  ]);
  const response = await stores
    .get(stores.idFromName(id))
    .fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: `${slug}.localhost`,
        canonicalStatus: "active",
        name: `Organization ${slug}`,
        organizationId: id,
        requestId: crypto.randomUUID(),
        slug,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  expect(response.status).toBe(200);
}

async function signIn(): Promise<string> {
  await jsonWrite("alpha.localhost", "/api/auth/email-otp/send-verification-otp", "POST", {
    email: USER_EMAIL,
    type: "sign-in",
  });
  const code = readCapturedPlatformEmailsForTest()
    .find(({ recipient }) => recipient === USER_EMAIL)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await jsonWrite("alpha.localhost", "/api/auth/sign-in/email-otp", "POST", {
    email: USER_EMAIL,
    otp: code,
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function deliverQueuedTicketNotification(organizationId: string): Promise<void> {
  const stub = stores.get(stores.idFromName(organizationId));
  const job = await runInDurableObject<OrganizationStore, DeliveryJob>(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<
        Record<string, SqlStorageValue> & {
          idempotencyKey: string;
          jobId: string;
          kind: DeliveryJob["kind"];
        }
      >(
        `SELECT job_id AS jobId, idempotency_key AS idempotencyKey, kind
           FROM scheduled_job_outbox WHERE kind = 'ticket_notification' AND job_id NOT IN
            (SELECT job_id FROM job_ledger WHERE status = 'completed')
           ORDER BY created_at, job_id LIMIT 1`,
      )
      .one();
    return {
      attempt: 1,
      idempotencyKey: row.idempotencyKey,
      jobId: row.jobId,
      kind: row.kind,
      organizationId,
      version: 1,
    };
  });
  const batch = createMessageBatch("choir-management-jobs-local", [
    { attempts: 1, body: job, id: `ticket-${job.jobId}`, timestamp: new Date() },
  ]);
  await processDeliveryBatch(batch, {
    EXTERNAL_EFFECTS_MODE: "fake",
    ORGANIZATION_STORE: stores,
    SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
  });
  const result = await getQueueResult(batch, createExecutionContext());
  expect(result).toMatchObject({ explicitAcks: [`ticket-${job.jobId}`] });
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('ticket-manager', 'Ticket Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "alpha", "admin");
  await provision("organization-bravo", "bravo", "member");
  const nowIso = new Date(now).toISOString();
  await database
    .prepare(
      `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES ('domain-alpha-public', 'organization-alpha', 'tickets.example.test',
        'custom_public', 'active', 1, ?, ?)`,
    )
    .bind(nowIso, nowIso)
    .run();
});

afterEach(async () => reset());

describe("Organization ticketing", () => {
  it("creates replay-safe isolated fake orders with capacity and signed receipt protection", async () => {
    const cookie = await signIn();
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
            details: "Private backstage details",
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
            startsAt: "2027-12-20T00:00:00.000Z",
            ticketCapacity: 3,
            title: "Winter Tickets",
            type: "Performance",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );
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
    expect(projection.payload.performances[0]).toMatchObject({
      advancePriceCents: 2_000,
      id: event.id,
      isTicketingEnabled: true,
      ticketCapacity: 3,
    });
    expect(JSON.stringify(projection)).not.toContain("Private backstage details");

    const checkoutRequestId = "88888888-8888-4888-8888-888888888888";
    const checkoutBody = {
      buyerEmail: "buyer@example.test",
      buyerName: "Ticket Buyer",
      checkoutRequestId,
      eventId: event.id,
      marketingOptIn: true,
      quantity: 2,
    };
    const firstResponse = await jsonWrite(
      "tickets.example.test",
      "/api/public/tickets/checkout",
      "POST",
      checkoutBody,
    );
    expect(firstResponse.status).toBe(201);
    const first = ticketCheckoutResponseSchema.parse(await firstResponse.json());
    expect(first).toMatchObject({
      checkoutMode: "fake",
      purchase: {
        buyerName: "Ticket Buyer",
        eventId: event.id,
        quantity: 2,
        status: "paid",
        unitPriceCents: 2_000,
      },
    });
    expect(first.url).toContain("http://tickets.example.test/tickets/order/success?token=");
    await deliverQueuedTicketNotification("organization-alpha");
    expect(
      await runInDurableObject<OrganizationStore, Record<string, SqlStorageValue>>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<Record<string, SqlStorageValue>>(
              `SELECT kind, status, provider_message_id AS providerMessageId
               FROM ticket_notifications WHERE purchase_id = ?`,
              first.purchase.id,
            )
            .one(),
      ),
    ).toMatchObject({
      kind: "confirmation",
      providerMessageId: expect.stringContaining("fake:"),
      status: "sent",
    });
    expect(
      (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/tickets/${first.purchase.id}/confirmation`,
            cookie,
            { method: "POST" },
          ),
        )
      ).status,
    ).toBe(200);
    await deliverQueuedTicketNotification("organization-alpha");
    expect(
      await runInDurableObject<OrganizationStore, number>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<Record<string, SqlStorageValue> & { count: number }>(
              "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'confirmation' AND status = 'sent'",
              first.purchase.id,
            )
            .one().count,
      ),
    ).toBe(2);

    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/events/${event.id}`,
          "PUT",
          { ...event, ticketCapacity: 1 },
          cookie,
        )
      ).status,
    ).toBe(409);

    const replay = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("alpha.localhost", "/api/public/tickets/checkout", "POST", checkoutBody)
      ).json(),
    );
    expect(replay.purchase.id).toBe(first.purchase.id);
    expect(
      (
        await jsonWrite("alpha.localhost", "/api/public/tickets/checkout", "POST", {
          ...checkoutBody,
          quantity: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          ...checkoutBody,
          checkoutRequestId: crypto.randomUUID(),
          quantity: 2,
        })
      ).status,
    ).toBe(409);

    const receipt = publicTicketPurchaseResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "tickets.example.test",
            `/api/public/tickets/order?token=${encodeURIComponent(first.successToken)}`,
          ),
        )
      ).json(),
    );
    expect(receipt.id).toBe(first.purchase.id);
    expect(receipt.scanToken).toBeTruthy();
    expect(JSON.stringify(receipt)).not.toContain("buyer@example.test");
    expect(
      (
        await exports.default.fetch(
          api(
            "bravo.localhost",
            `/api/public/tickets/order?token=${encodeURIComponent(first.successToken)}`,
          ),
        )
      ).status,
    ).toBe(404);

    const scan = ticketScanResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/scan",
          "POST",
          { eventId: event.id, token: receipt.scanToken },
          cookie,
        )
      ).json(),
    );
    expect(scan).toMatchObject({
      buyerName: "Ticket Buyer",
      eventId: event.id,
      purchaseId: first.purchase.id,
      quantity: 2,
      valid: true,
    });
    expect(
      ticketScanResponseSchema.parse(
        await (
          await jsonWrite(
            "alpha.localhost",
            "/api/organization/tickets/scan",
            "POST",
            { eventId: crypto.randomUUID(), token: receipt.scanToken },
            cookie,
          )
        ).json(),
      ),
    ).toMatchObject({ reason: "wrong_event", valid: false });
    expect(
      (
        await jsonWrite(
          "bravo.localhost",
          "/api/organization/tickets/scan",
          "POST",
          { eventId: event.id, token: receipt.scanToken },
          cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/scan",
          "POST",
          { eventId: event.id, token: `${receipt.scanToken}x` },
          cookie,
        )
      ).status,
    ).toBe(404);

    const willCall = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/tickets/will-call?eventId=${encodeURIComponent(event.id)}`,
        cookie,
      ),
    );
    expect(willCall.status).toBe(200);
    expect(willCall.headers.get("content-type")).toContain("text/csv");
    expect(willCall.headers.get("content-disposition")).toContain("will-call-winter-tickets.csv");
    expect(await willCall.text()).toContain('"Ticket Buyer","buyer@example.test","2"');
    expect(
      (
        await exports.default.fetch(
          api(
            "bravo.localhost",
            `/api/organization/tickets/will-call?eventId=${encodeURIComponent(event.id)}`,
            cookie,
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await jsonWrite("unknown.localhost", "/api/public/tickets/checkout", "POST", checkoutBody))
        .status,
    ).toBe(404);

    const ordersResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/tickets/orders", cookie),
    );
    expect(ordersResponse.status).toBe(200);
    const orders = organizationTicketOrdersResponseSchema.parse(await ordersResponse.json()).orders;
    expect(orders).toHaveLength(1);
    expect(orders[0]?.buyerEmail).toBe("buyer@example.test");
    expect(
      (
        await exports.default.fetch(
          api("bravo.localhost", "/api/organization/tickets/orders", cookie),
        )
      ).status,
    ).toBe(403);

    const refundResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/tickets/${first.purchase.id}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(refundResponse.status).toBe(200);
    expect(organizationTicketOrderSchema.parse(await refundResponse.json()).status).toBe(
      "refunded",
    );
    expect(
      ticketScanResponseSchema.parse(
        await (
          await jsonWrite(
            "alpha.localhost",
            "/api/organization/tickets/scan",
            "POST",
            { eventId: event.id, token: receipt.scanToken },
            cookie,
          )
        ).json(),
      ),
    ).toMatchObject({ reason: "not_paid", valid: false });
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/tickets/${first.purchase.id}/refund`, cookie, {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(200);
    const concurrentStatuses = await Promise.all(
      [crypto.randomUUID(), crypto.randomUUID()].map(
        async (requestId) =>
          (
            await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
              ...checkoutBody,
              checkoutRequestId: requestId,
              quantity: 2,
            })
          ).status,
      ),
    );
    expect(concurrentStatuses.toSorted()).toEqual([201, 409]);

    const actions = await runInDurableObject<OrganizationStore, string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { action: string }>(
            `SELECT action FROM audit_events
             WHERE action LIKE 'ticket.%' ORDER BY occurred_at, id`,
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(actions).toEqual([
      "ticket.purchase.fulfilled",
      "ticket.confirmation.queued",
      "ticket.scan.validated",
      "ticket.scan.validated",
      "ticket.purchase.refunded",
      "ticket.scan.validated",
      "ticket.purchase.fulfilled",
    ]);
  });

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

  it("queues one confirmation and one 24-hour reminder through the durable ticket outbox", async () => {
    const cookie = await signIn();
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
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
            doorsOpenTime: "",
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
            venueId: null,
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
      return state.storage.setAlarm(Date.now() + 1).then(() => undefined);
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
  });
});
