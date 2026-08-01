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
  donationSettingsResponseSchema,
  duesRecordSchema,
  organizationPaymentSettingsResponseSchema,
  transactionFeeSettingsResponseSchema,
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
const organizationFiles = binding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");

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
    ORGANIZATION_FILES: organizationFiles,
    ORGANIZATION_STORE: stores,
    PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
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
  it("persists donation levels and serves them on the public Organization host", async () => {
    const cookie = await signIn();
    const initial = donationSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/donation-settings", cookie),
        )
      ).json(),
    );
    expect(initial.levels).toHaveLength(4);

    const updated = {
      buttonText: "Support the next concert",
      description: "Help us bring live choral music to more neighbors.",
      levels: [
        {
          amountCents: 7_500,
          benefit: "Name in the concert program",
          id: "community-friend",
          label: "Community friend",
        },
      ],
    };
    const saved = donationSettingsResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/donation-settings",
          "PUT",
          updated,
          cookie,
        )
      ).json(),
    );
    expect(saved).toMatchObject(updated);

    const publicSettings = donationSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(api("tickets.example.test", "/api/public/donation-settings"))
      ).json(),
    );
    expect(publicSettings).toMatchObject(updated);
  });

  it("persists transaction fees and serves them on the public Organization host", async () => {
    const cookie = await signIn();
    const initial = transactionFeeSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/transaction-fee-settings", cookie),
        )
      ).json(),
    );
    expect(initial).toMatchObject({ fixedCents: 30, passFeeToDonor: false, percentage: 2.9 });

    const updated = { fixedCents: 45, passFeeToDonor: true, percentage: 3.25 };
    const saved = transactionFeeSettingsResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/transaction-fee-settings",
          "PUT",
          updated,
          cookie,
        )
      ).json(),
    );
    expect(saved).toMatchObject(updated);

    const publicSettings = transactionFeeSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("tickets.example.test", "/api/public/transaction-fee-settings"),
        )
      ).json(),
    );
    expect(publicSettings).toMatchObject(updated);
  });

  it("shows payment readiness to managers and keeps activation fail-closed", async () => {
    const cookie = await signIn();
    const settingsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/payment-settings", cookie),
    );
    expect(settingsResponse.status).toBe(200);
    const settings = organizationPaymentSettingsResponseSchema.parse(await settingsResponse.json());
    expect(settings.activations).toEqual({ donations: false, dues: false, tickets: false });
    expect(settings.globalPaymentsEnabled).toBe(false);
    expect(settings.stripe.status).toBe("not_started");

    const notReady = await jsonWrite(
      "alpha.localhost",
      "/api/organization/payment-settings/activation",
      "POST",
      { confirm: true, enabled: true, moduleId: "tickets" },
      cookie,
    );
    expect(notReady.status).toBe(409);
    expect(await notReady.json()).toMatchObject({ code: "payments_not_ready" });

    const memberResponse = await exports.default.fetch(
      api("bravo.localhost", "/api/organization/payment-settings", cookie),
    );
    expect(memberResponse.status).toBe(403);
  });

  it("creates replay-safe isolated fake orders with capacity and signed receipt protection", async () => {
    const cookie = await signIn();
    const setupHealth = await exports.default.fetch(
      api("alpha.localhost", "/api/setup/health", cookie),
    );
    expect(setupHealth.status).toBe(200);
    expect(await setupHealth.json()).toMatchObject({ organizationId: "organization-alpha" });
    const queueProcess = await jsonWrite(
      "alpha.localhost",
      "/api/queue/process",
      "POST",
      {},
      cookie,
    );
    expect(queueProcess.status).toBe(200);
    expect(await queueProcess.json()).toMatchObject({ mode: "automatic", success: true });
    const maintenance = await exports.default.fetch(
      api("alpha.localhost", "/api/maintenance/run", cookie),
    );
    expect(maintenance.status).toBe(200);
    expect(await maintenance.json()).toMatchObject({
      organizationId: "organization-alpha",
      success: true,
    });
    const stripeWebhook = await jsonWrite("alpha.localhost", "/api/webhook/stripe", "POST", {
      id: "evt_fake",
      type: "checkout.session.completed",
    });
    expect(stripeWebhook.status).toBe(200);
    expect(await stripeWebhook.json()).toMatchObject({ mode: "fake", received: true });
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
    const legacyResend = await jsonWrite(
      "alpha.localhost",
      "/api/admin/resend-ticket-confirmation",
      "POST",
      { purchaseId: first.purchase.id, recipientEmail: "replacement@example.test" },
      cookie,
    );
    expect(legacyResend.status).toBe(200);
    expect(
      await runInDurableObject<OrganizationStore, string>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ destination: string }>(
              "SELECT destination FROM ticket_notifications WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 1",
              first.purchase.id,
            )
            .one().destination,
      ),
    ).toBe("replacement@example.test");

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
    const legacyScan = ticketScanResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/tickets/validate",
          "POST",
          { eventId: event.id, token: receipt.scanToken },
          cookie,
        )
      ).json(),
    );
    expect(legacyScan).toMatchObject({ purchaseId: first.purchase.id, valid: true });

    const providerSessionId = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ providerSessionId: string }>(
            "SELECT provider_session_id AS providerSessionId FROM ticket_purchases WHERE id = ?",
            first.purchase.id,
          )
          .one().providerSessionId,
    );
    const scanContext = await exports.default.fetch(
      api(
        "tickets.example.test",
        `/api/tickets/scan-context?session_id=${encodeURIComponent(providerSessionId)}&purchase_id=${encodeURIComponent(first.purchase.id)}`,
      ),
    );
    expect(scanContext.status).toBe(200);
    expect(await scanContext.json()).toMatchObject({
      buyerName: "Ticket Buyer",
      eventTitle: "Winter Tickets",
      isBundlePass: false,
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

    const legacyCheckout = await jsonWrite(
      "tickets.example.test",
      "/api/checkout/create-tickets-session",
      "POST",
      {
        email: "legacy@example.test",
        eventId: event.id,
        marketingOptIn: false,
        name: "Legacy Buyer",
        quantity: 1,
      },
    );
    expect(legacyCheckout.status).toBe(201);

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
      "ticket.confirmation.queued",
      "ticket.scan.validated",
      "ticket.scan.validated",
      "ticket.scan.validated",
      "ticket.purchase.refunded",
      "ticket.scan.validated",
      "ticket.purchase.fulfilled",
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
    const providerPaymentId = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ providerPaymentId: string }>(
            "SELECT provider_payment_id AS providerPaymentId FROM ticket_purchases WHERE id = ?",
            checkout.purchase.id,
          )
          .one().providerPaymentId,
    );
    const bundleRefund = await jsonWrite(
      "alpha.localhost",
      "/api/admin/refund-bundle",
      "POST",
      { paymentIntentId: providerPaymentId },
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
      return state.storage.setAlarm(Date.now() - 1).then(() => undefined);
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

  it("applies Stripe completion, replay, and refund transitions atomically", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const purchaseId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at, fulfilled_at, expired_at, refunded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1000, 0, 1000, 'usd', ?, '', 'pending', 0, ?, ?, NULL, NULL, NULL)`,
        purchaseId,
        checkoutRequestId,
        crypto.randomUUID(),
        "Stripe Test Event",
        now,
        "UTC",
        "Stripe Buyer",
        "stripe@example.test",
        `pending_${purchaseId}`,
        now,
        now,
      );
    });
    const completed = await stub.fetch("https://organization.internal/internal/ticketing/manage", {
      body: JSON.stringify({
        action: "stripe_ticket_completed",
        checkoutRequestId,
        organizationId: "organization-alpha",
        providerPaymentId: `pi_${purchaseId}`,
        providerSessionId: `stripe_session_${purchaseId}`,
        stripeEventId: eventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({ status: "paid" });
    const duplicate = await stub.fetch("https://organization.internal/internal/ticketing/manage", {
      body: JSON.stringify({
        action: "stripe_ticket_completed",
        checkoutRequestId,
        organizationId: "organization-alpha",
        providerPaymentId: `pi_${purchaseId}`,
        providerSessionId: `stripe_session_${purchaseId}`,
        stripeEventId: eventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
    const refunded = await stub.fetch("https://organization.internal/internal/ticketing/manage", {
      body: JSON.stringify({
        action: "stripe_ticket_refunded",
        organizationId: "organization-alpha",
        providerPaymentId: `pi_${purchaseId}`,
        providerSessionId: "refund",
        stripeEventId: crypto.randomUUID(),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await refunded.json()).toMatchObject({ refunded: 1 });
  });

  it("keeps donation and dues provider transitions inside the Organization store", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const donationId = crypto.randomUUID();
    const patronId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const duesId = crypto.randomUUID();
    const expiredDonationId = crypto.randomUUID();
    const donationCheckoutRequestId = crypto.randomUUID();
    const duesCheckoutRequestId = crypto.randomUUID();
    const donationSessionId = `stripe_donation_${donationId}`;
    const duesSessionId = `stripe_dues_${duesId}`;
    const expiredDonationSessionId = `stripe_donation_expired_${expiredDonationId}`;
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO patrons
          (id, name, email, total_donated_cents, donation_count, first_donated_at,
           last_donated_at, created_at, updated_at)
         VALUES (?, 'Stripe Donor', ?, 0, 0, ?, ?, ?, ?)`,
        patronId,
        `donor-${donationId}@example.test`,
        now,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO donations
          (id, checkout_request_id, status, amount_cents, tribute_type, tribute_name,
           tribute_notify_email, anonymous, marketing_consent, buyer_name, buyer_email,
           patron_id, provider_session_id, provider_payment_id, created_at, updated_at, refunded_at)
         VALUES (?, ?, 'pending', 2500, 'none', '', '', 0, 0, 'Stripe Donor', ?, ?, ?, '', ?, ?, NULL)`,
        donationId,
        donationCheckoutRequestId,
        `donor-${donationId}@example.test`,
        patronId,
        `pending_${donationId}`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO donations
          (id, checkout_request_id, status, amount_cents, tribute_type, tribute_name,
           tribute_notify_email, anonymous, marketing_consent, buyer_name, buyer_email,
           patron_id, provider_session_id, provider_payment_id, created_at, updated_at, refunded_at)
         VALUES (?, ?, 'pending', 1800, 'none', '', '', 0, 0, 'Stripe Donor', ?, ?, ?, '', ?, ?, NULL)`,
        expiredDonationId,
        crypto.randomUUID(),
        `expired-${expiredDonationId}@example.test`,
        patronId,
        expiredDonationSessionId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Stripe Season', ?, ?, 5000, ?, ?)`,
        seasonId,
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO dues
          (id, season_id, profile_id, amount_cents, provider_session_id, status,
           paid_at, created_at, updated_at)
         VALUES (?, ?, ?, 5000, ?, 'pending', NULL, ?, ?)`,
        duesId,
        seasonId,
        crypto.randomUUID(),
        `pending_${duesId}`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES (?, 'dues', ?, ?, ?, '', 'pending', 5000, ?, ?)`,
        crypto.randomUUID(),
        duesId,
        duesCheckoutRequestId,
        `pending_${duesId}`,
        now,
        now,
      );
    });
    const donationCompleted = await stub.fetch(
      "https://organization.internal/internal/donations/manage",
      {
        body: JSON.stringify({
          action: "stripe_donation_completed",
          checkoutRequestId: donationCheckoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId: `pi_donation_${donationId}`,
          providerSessionId: donationSessionId,
          stripeEventId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(donationCompleted.status).toBe(200);
    expect(await donationCompleted.json()).toMatchObject({ status: "paid" });
    const expiredEventId = crypto.randomUUID();
    const expired = await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "stripe_donation_expired",
        organizationId: "organization-alpha",
        providerPaymentId: "",
        providerSessionId: expiredDonationSessionId,
        stripeEventId: expiredEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(expired.status).toBe(200);
    expect(await expired.json()).toMatchObject({
      status: "expired",
      expiredAt: expect.any(String),
    });
    const expiredReplay = await stub.fetch(
      "https://organization.internal/internal/donations/manage",
      {
        body: JSON.stringify({
          action: "stripe_donation_expired",
          organizationId: "organization-alpha",
          providerPaymentId: "",
          providerSessionId: expiredDonationSessionId,
          stripeEventId: expiredEventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(await expiredReplay.json()).toMatchObject({ duplicate: true, status: "expired" });
    const expiredCompletion = await stub.fetch(
      "https://organization.internal/internal/donations/manage",
      {
        body: JSON.stringify({
          action: "stripe_donation_completed",
          organizationId: "organization-alpha",
          providerPaymentId: `pi_expired_${expiredDonationId}`,
          providerSessionId: expiredDonationSessionId,
          stripeEventId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(await expiredCompletion.json()).toMatchObject({ expiredAt: null, status: "paid" });
    await expect(
      runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<Record<string, SqlStorageValue> & { count: number }>(
              "SELECT COUNT(*) AS count FROM donation_expirations",
            )
            .one().count,
      ),
    ).resolves.toBe(0);
    const duesCompleted = await stub.fetch(
      "https://organization.internal/internal/seasons/manage",
      {
        body: JSON.stringify({
          action: "stripe_dues_completed",
          checkoutRequestId: duesCheckoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId: `pi_dues_${duesId}`,
          providerSessionId: duesSessionId,
          stripeEventId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(duesCompleted.status).toBe(200);
    expect(await duesCompleted.json()).toMatchObject({ dues: [{ status: "paid" }] });
    const crossTenant = await stub.fetch(
      "https://organization.internal/internal/donations/manage",
      {
        body: JSON.stringify({
          action: "stripe_donation_completed",
          organizationId: "organization-bravo",
          providerPaymentId: "pi-cross-tenant",
          providerSessionId: donationSessionId,
          stripeEventId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(crossTenant.status).toBe(409);
  });

  it("persists live refund requests and keeps cash dues out of provider lookup", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const ticketId = crypto.randomUUID();
    const cashDuesId = crypto.randomUUID();
    const onlineDuesId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const cashProfileId = crypto.randomUUID();
    const onlineProfileId = crypto.randomUUID();
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES (?, 'ticket', ?, ?, ?, ?, 'paid', 1000, ?, ?)`,
        crypto.randomUUID(),
        ticketId,
        crypto.randomUUID(),
        `session_${ticketId}`,
        `pi_${ticketId}`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Cash Refund Test', ?, ?), (?, 'Online Refund Test', ?, ?)`,
        cashProfileId,
        now,
        now,
        onlineProfileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Refund Test Season', ?, ?, 5000, ?, ?)`,
        seasonId,
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO dues
          (id, season_id, profile_id, amount_cents, fee_cents, provider_session_id,
           provider_payment_id, payer_email, status, payment_method, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, 5000, 0, '', '', '', 'paid', 'cash', ?, ?, ?),
           (?, ?, ?, 5000, 0, ?, ?, 'online@example.test', 'paid', 'online', ?, ?, ?)`,
        cashDuesId,
        seasonId,
        cashProfileId,
        now,
        now,
        now,
        onlineDuesId,
        seasonId,
        onlineProfileId,
        `session_${onlineDuesId}`,
        `pi_${onlineDuesId}`,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES (?, 'dues', ?, ?, ?, ?, 'paid', 5000, ?, ?)`,
        crypto.randomUUID(),
        onlineDuesId,
        crypto.randomUUID(),
        `session_${onlineDuesId}`,
        `pi_${onlineDuesId}`,
        now,
        now,
      );
    });

    const targetUrl = new URL("https://organization.internal/internal/payments/refund-target");
    targetUrl.searchParams.set("organizationId", "organization-alpha");
    targetUrl.searchParams.set("paymentType", "ticket");
    targetUrl.searchParams.set("resourceId", ticketId);
    const target = await stub.fetch(targetUrl);
    expect(target.status).toBe(200);
    expect(await target.json()).toMatchObject({ refundRequested: false, status: "paid" });

    const requestId = crypto.randomUUID();
    const requested = await stub.fetch(
      "https://organization.internal/internal/payments/refund-request",
      {
        body: JSON.stringify({
          action: "record_provider_refund_requested",
          actorUserId: "ticket-manager",
          organizationId: "organization-alpha",
          paymentType: "ticket",
          requestId,
          resourceId: ticketId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(await requested.json()).toMatchObject({ requested: true });
    const refreshedTarget = await stub.fetch(targetUrl);
    expect(await refreshedTarget.json()).toMatchObject({
      refundRequested: true,
      status: "paid",
    });

    const cashTargetUrl = new URL("https://organization.internal/internal/payments/refund-target");
    cashTargetUrl.searchParams.set("organizationId", "organization-alpha");
    cashTargetUrl.searchParams.set("paymentType", "dues");
    cashTargetUrl.searchParams.set("resourceId", cashDuesId);
    expect((await stub.fetch(cashTargetUrl)).status).toBe(404);
  });

  it("records cash dues on the selected Profile and keeps the action manager-only", async () => {
    const cookie = await signIn();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Cash Member', ?, ?)`,
        profileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Cash Season', ?, ?, 4000, ?, ?)`,
        seasonId,
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
    });

    const marked = duesRecordSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/admin/mark-dues-cash",
          "POST",
          { profileId, seasonId },
          cookie,
        )
      ).json(),
    );
    expect(marked).toMatchObject({
      amountCents: 4000,
      feeCents: 0,
      paymentMethod: "cash",
      profileId,
      seasonId,
      status: "paid",
    });

    const replay = duesRecordSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/admin/mark-dues-cash",
          "POST",
          { profileId, seasonId },
          cookie,
        )
      ).json(),
    );
    expect(replay.id).toBe(marked.id);
    await expect(
      runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'dues.cash_paid'",
            )
            .one().count,
      ),
    ).resolves.toBe(1);

    const memberAttempt = await jsonWrite(
      "bravo.localhost",
      "/api/admin/mark-dues-cash",
      "POST",
      { profileId, seasonId },
      cookie,
    );
    expect(memberAttempt.status).toBe(403);
  });
});
