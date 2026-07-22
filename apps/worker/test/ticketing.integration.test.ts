import {
  organizationEventSchema,
  organizationTicketOrderSchema,
  organizationTicketOrdersResponseSchema,
  organizationVenueSchema,
  publicTicketPurchaseResponseSchema,
  publishedOrganizationProjectionSchema,
  ticketCheckoutResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

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
         VALUES (?, ?, ?, 'active', ?, 20, ?, ?, ?)`,
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
      "ticket.purchase.refunded",
      "ticket.purchase.fulfilled",
    ]);
  });
});
