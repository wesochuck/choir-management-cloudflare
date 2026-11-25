import { formatCommunicationEventDate } from "@choir/domain";
import { seedAuthUser } from "@choir/testkit";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deliverTicketCloseoutJob } from "../src/jobs/deliveries/ticketCloseout";
import type { DeliveryJob } from "../src/jobs/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { readCommunicationDeliveryJob } from "../src/organization/organizationCommunications";
import { createTicketCloseoutJobs } from "../src/organization/schedulerDueJobs";
import {
  database,
  setupTicketingIntegration,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

const ORGANIZATION_ID = "organization-alpha";
const RECIPIENT_USER_ID = "closeout-recipient";
const RECIPIENT_PROFILE_ID = "88888888-8888-4888-8888-888888888888";

interface CloseoutJob {
  readonly eventId: string;
  readonly jobId: string;
}

interface CloseoutPurchaseInput {
  readonly amountPaidCents: number;
  readonly bundleId: string | null;
  readonly bundleTitle: string;
  readonly buyer: string;
  readonly email: string;
  readonly eventId: string;
  readonly eventStartsAt: string;
  readonly eventTitle: string;
  readonly feeCents: number;
  readonly id: string;
  readonly now: string;
  readonly quantity: number;
  readonly status: "paid" | "refunded";
  readonly unitPriceCents: number;
}

function insertCloseoutEvent(
  storage: DurableObjectStorage,
  eventId: string,
  title: string,
  startsAt: string,
  now: string,
): void {
  storage.sql.exec(
    `INSERT INTO events (id, title, type, starts_at, call_time, location, created_at, updated_at)
     VALUES (?, ?, 'Performance', ?, '', 'Concert Hall', ?, ?)`,
    eventId,
    title,
    startsAt,
    now,
    now,
  );
}

function insertCloseoutPurchase(
  storage: DurableObjectStorage,
  purchase: CloseoutPurchaseInput,
): void {
  storage.sql.exec(
    `INSERT INTO ticket_purchases
      (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
       buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
       currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
       created_at, updated_at, fulfilled_at, bundle_id, bundle_title)
     VALUES (?, ?, ?, ?, ?, 'UTC', ?, ?, ?, ?, ?, ?, 'usd', ?, '', ?, 0, ?, ?, ?, ?, ?)`,
    purchase.id,
    crypto.randomUUID(),
    purchase.eventId,
    purchase.eventTitle,
    purchase.eventStartsAt,
    purchase.buyer,
    purchase.email,
    purchase.quantity,
    purchase.unitPriceCents,
    purchase.feeCents,
    purchase.amountPaidCents,
    crypto.randomUUID(),
    purchase.status,
    purchase.now,
    purchase.now,
    purchase.now,
    purchase.bundleId,
    purchase.bundleTitle,
  );
}

function insertCloseoutScan(
  storage: DurableObjectStorage,
  purchaseId: string,
  eventId: string,
  result: "valid" | "not_paid",
  now: string,
): void {
  storage.sql.exec(
    `INSERT INTO ticket_scan_events
      (id, purchase_id, event_id, actor_user_id, result, request_id, occurred_at)
     VALUES (?, ?, ?, 'test-scanner', ?, ?, ?)`,
    crypto.randomUUID(),
    purchaseId,
    eventId,
    result,
    crypto.randomUUID(),
    now,
  );
}

function readCloseoutJobId(storage: DurableObjectStorage, eventId: string): string {
  return storage.sql
    .exec<Record<string, SqlStorageValue> & { jobId: string }>(
      `SELECT job_id AS jobId FROM scheduled_job_outbox
       WHERE idempotency_key = ? LIMIT 1`,
      `ticket-closeout:${ORGANIZATION_ID}:${eventId}`,
    )
    .one().jobId;
}

function requireCloseoutJob(jobs: readonly CloseoutJob[], index: number): CloseoutJob {
  const job = jobs[index];
  if (!job) throw new Error(`The ticket closeout job at index ${String(index)} is missing.`);
  return job;
}

function seedCloseoutRows(
  storage: DurableObjectStorage,
  now: string,
  ids: {
    readonly bundlePurchaseId: string;
    readonly complimentaryPurchaseId: string;
    readonly firstEventId: string;
    readonly refundedPurchaseId: string;
    readonly secondEventId: string;
    readonly standalonePurchaseId: string;
    readonly unscannedEventId: string;
    readonly unscannedPurchaseId: string;
  },
): readonly CloseoutJob[] {
  const startsAt = new Date(Date.parse(now) - 13 * 60 * 60 * 1_000).toISOString();
  insertCloseoutEvent(storage, ids.firstEventId, "First Concert", startsAt, now);
  insertCloseoutEvent(storage, ids.secondEventId, "Second Concert", startsAt, now);
  insertCloseoutEvent(storage, ids.unscannedEventId, "Unscanned Concert", startsAt, now);

  insertCloseoutPurchase(storage, {
    amountPaidCents: 4_500,
    bundleId: null,
    bundleTitle: "",
    buyer: "Private Ticket Buyer",
    email: "private-buyer@example.test",
    eventId: ids.firstEventId,
    eventStartsAt: startsAt,
    eventTitle: "First Concert",
    feeCents: 500,
    id: ids.standalonePurchaseId,
    now,
    quantity: 2,
    status: "paid",
    unitPriceCents: 2_000,
  });
  insertCloseoutPurchase(storage, {
    amountPaidCents: 0,
    bundleId: null,
    bundleTitle: "",
    buyer: "Private Comp Buyer",
    email: "private-comp@example.test",
    eventId: ids.firstEventId,
    eventStartsAt: startsAt,
    eventTitle: "First Concert",
    feeCents: 0,
    id: ids.complimentaryPurchaseId,
    now,
    quantity: 1,
    status: "paid",
    unitPriceCents: 0,
  });
  insertCloseoutPurchase(storage, {
    amountPaidCents: 2_500,
    bundleId: null,
    bundleTitle: "",
    buyer: "Private Refund Buyer",
    email: "private-refund@example.test",
    eventId: ids.firstEventId,
    eventStartsAt: startsAt,
    eventTitle: "First Concert",
    feeCents: 500,
    id: ids.refundedPurchaseId,
    now,
    quantity: 1,
    status: "refunded",
    unitPriceCents: 2_000,
  });
  insertCloseoutPurchase(storage, {
    amountPaidCents: 7_000,
    bundleId: "season-pass-test",
    bundleTitle: "Season Pass",
    buyer: "Private Pass Buyer",
    email: "private-pass@example.test",
    eventId: ids.firstEventId,
    eventStartsAt: startsAt,
    eventTitle: "First Concert",
    feeCents: 1_000,
    id: ids.bundlePurchaseId,
    now,
    quantity: 2,
    status: "paid",
    unitPriceCents: 3_000,
  });
  insertCloseoutPurchase(storage, {
    amountPaidCents: 1_000,
    bundleId: null,
    bundleTitle: "",
    buyer: "Private Unscanned Buyer",
    email: "private-unscanned@example.test",
    eventId: ids.unscannedEventId,
    eventStartsAt: startsAt,
    eventTitle: "Unscanned Concert",
    feeCents: 0,
    id: ids.unscannedPurchaseId,
    now,
    quantity: 1,
    status: "paid",
    unitPriceCents: 1_000,
  });
  storage.sql.exec(
    "UPDATE ticket_purchases SET refunded_at = ? WHERE id = ?",
    now,
    ids.refundedPurchaseId,
  );
  storage.sql.exec(
    `INSERT INTO ticket_bundle_allocations (purchase_id, event_id, quantity)
     VALUES (?, ?, ?), (?, ?, ?)`,
    ids.bundlePurchaseId,
    ids.firstEventId,
    2,
    ids.bundlePurchaseId,
    ids.secondEventId,
    2,
  );

  insertCloseoutScan(storage, ids.standalonePurchaseId, ids.firstEventId, "valid", now);
  insertCloseoutScan(storage, ids.standalonePurchaseId, ids.firstEventId, "valid", now);
  insertCloseoutScan(storage, ids.complimentaryPurchaseId, ids.firstEventId, "valid", now);
  insertCloseoutScan(storage, ids.bundlePurchaseId, ids.firstEventId, "valid", now);
  insertCloseoutScan(storage, ids.bundlePurchaseId, ids.secondEventId, "valid", now);
  insertCloseoutScan(storage, ids.standalonePurchaseId, ids.firstEventId, "not_paid", now);

  const scheduledAt = new Date(now);
  createTicketCloseoutJobs(storage, ORGANIZATION_ID, scheduledAt);
  createTicketCloseoutJobs(storage, ORGANIZATION_ID, scheduledAt);
  return [ids.firstEventId, ids.secondEventId, ids.unscannedEventId].map((eventId) => ({
    eventId,
    jobId: readCloseoutJobId(storage, eventId),
  }));
}

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("ticket closeout reports", () => {
  it("attributes bundle proceeds once, reports covered admissions and check-ins, and queues an opted-in email", async () => {
    const stub = stores.get(stores.idFromName(ORGANIZATION_ID));
    const now = new Date().toISOString();
    const firstEventId = crypto.randomUUID();
    const secondEventId = crypto.randomUUID();
    const unscannedEventId = crypto.randomUUID();
    const standalonePurchaseId = crypto.randomUUID();
    const complimentaryPurchaseId = crypto.randomUUID();
    const refundedPurchaseId = crypto.randomUUID();
    const bundlePurchaseId = crypto.randomUUID();
    const unscannedPurchaseId = crypto.randomUUID();

    const jobs = await runInDurableObject<OrganizationStore, readonly CloseoutJob[]>(
      stub,
      (_instance, state) =>
        seedCloseoutRows(state.storage, now, {
          bundlePurchaseId,
          complimentaryPurchaseId,
          firstEventId,
          refundedPurchaseId,
          secondEventId,
          standalonePurchaseId,
          unscannedEventId,
          unscannedPurchaseId,
        }),
    );
    expect(jobs).toHaveLength(3);

    const firstJob = requireCloseoutJob(jobs, 0);
    const secondJob = requireCloseoutJob(jobs, 1);
    const unscannedJob = requireCloseoutJob(jobs, 2);
    const reportResponse = await stub.fetch(
      `https://organization.internal/internal/scheduling/ticket-closeout-job?organizationId=${ORGANIZATION_ID}&jobId=${firstJob.jobId}`,
    );
    expect(reportResponse.status).toBe(200);
    await expect(reportResponse.json()).resolves.toMatchObject({
      admissions: {
        complimentaryAdmissions: 1,
        seasonPassAdmissions: 2,
        singleEventAdmissions: 2,
        totalAdmissions: 5,
      },
      financials: {
        netProceedsCents: 11_500,
        refundsCents: 2_500,
        seasonPassProceedsCents: 7_000,
        singleEventPaymentsCents: 7_000,
      },
      scans: {
        complimentaryAdmissions: 1,
        recordsAvailable: true,
        seasonPassAdmissions: 2,
        singleEventAdmissions: 2,
        totalAdmissions: 5,
      },
    });

    const secondResponse = await stub.fetch(
      `https://organization.internal/internal/scheduling/ticket-closeout-job?organizationId=${ORGANIZATION_ID}&jobId=${secondJob.jobId}`,
    );
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toMatchObject({
      admissions: { complimentaryAdmissions: 0, seasonPassAdmissions: 2, totalAdmissions: 2 },
      financials: { seasonPassProceedsCents: 0 },
      scans: { recordsAvailable: true, seasonPassAdmissions: 2, totalAdmissions: 2 },
    });

    const unscannedResponse = await stub.fetch(
      `https://organization.internal/internal/scheduling/ticket-closeout-job?organizationId=${ORGANIZATION_ID}&jobId=${unscannedJob.jobId}`,
    );
    expect(unscannedResponse.status).toBe(200);
    await expect(unscannedResponse.json()).resolves.toMatchObject({
      scans: { recordsAvailable: false, totalAdmissions: 0 },
    });

    await seedAuthUser(database, RECIPIENT_USER_ID, "finance@example.test", "Finance Member");
    await database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES (?, ?, ?, 'member', ?, ?)`,
      )
      .bind(
        `member-${RECIPIENT_USER_ID}`,
        ORGANIZATION_ID,
        RECIPIENT_USER_ID,
        RECIPIENT_PROFILE_ID,
        now,
      )
      .run();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles
          (id, display_name, voice_part, global_status, do_not_email, provider_email_suppressed,
           receive_financial_alerts, created_at, updated_at)
         VALUES (?, 'Finance Member', 'S1', 'Active', 0, 0, 1, ?, ?)`,
        RECIPIENT_PROFILE_ID,
        now,
        now,
      );
    });

    const deliveryJob: DeliveryJob = {
      attempt: 1,
      idempotencyKey: `ticket-closeout:${ORGANIZATION_ID}:${firstEventId}`,
      jobId: firstJob.jobId,
      kind: "ticket_closeout",
      organizationId: ORGANIZATION_ID,
      version: 1,
    };
    await deliverTicketCloseoutJob({ ...env, CONTROL_DB: database }, deliveryJob);

    const queuedMessage = await runInDurableObject<
      OrganizationStore,
      {
        readonly content: string;
        readonly destination: string;
        readonly subject: string;
      } | null
    >(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<
            Record<string, SqlStorageValue> & {
              content: string;
              destination: string;
              subject: string;
            }
          >(
            `SELECT m.content_markdown AS content, m.subject, d.destination
           FROM communication_messages m
           JOIN communication_deliveries d ON d.message_id = m.id
           WHERE m.dedupe_key = ? LIMIT 1`,
            `ticket-closeout:${ORGANIZATION_ID}:${firstEventId}`,
          )
          .toArray()
          .at(0) ?? null,
    );
    if (!queuedMessage) throw new Error("The ticket closeout email was not queued.");
    const firstStartsAt = new Date(Date.parse(now) - 13 * 60 * 60 * 1_000).toISOString();
    const expectedCloseoutDate = formatCommunicationEventDate(firstStartsAt, "UTC");
    expect(expectedCloseoutDate).toMatch(
      /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), /,
    );
    expect(queuedMessage).toMatchObject({
      destination: "finance@example.test",
      subject: "Ticket closeout: First Concert",
    });
    expect(queuedMessage.content).toContain(`- **Date and time:** ${expectedCloseoutDate}`);
    expect(queuedMessage.content).toContain("Single-event ticket payments: $70.00");
    expect(queuedMessage.content).toContain("Season-pass proceeds credited here: $70.00");
    expect(queuedMessage.content).toContain("Refunds: $25.00");
    expect(queuedMessage.content).toContain("**Net ticket proceeds:** $115.00");
    expect(queuedMessage.content).toContain("Single-event ticket admissions: 2");
    expect(queuedMessage.content).toContain("Season-pass admissions: 2");
    expect(queuedMessage.content).toContain("Complimentary admissions: 1");
    expect(queuedMessage.content).toContain("**Total successful check-ins:** 5");
    expect(queuedMessage.content).toContain("/admin/tickets");
    expect(queuedMessage.content).not.toContain("Private Ticket Buyer");
    expect(queuedMessage.content).not.toContain("private-buyer@example.test");

    const communicationJob = await runInDurableObject<OrganizationStore, string | null>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { jobId: string }>(
            `SELECT o.job_id AS jobId FROM communication_messages m
             JOIN scheduled_job_outbox o
               ON o.idempotency_key = ('communication:' || m.id || ':initial')
             WHERE m.dedupe_key = ? LIMIT 1`,
            `ticket-closeout:${ORGANIZATION_ID}:${firstEventId}`,
          )
          .toArray()
          .at(0)?.jobId ?? null,
    );
    if (!communicationJob) throw new Error("The ticket closeout communication job is missing.");

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE events SET is_canceled = 1 WHERE id = ?", firstEventId);
      state.storage.sql.exec("UPDATE events SET is_canceled = 1 WHERE id = ?", secondEventId);
    });
    const suppressedDelivery = await readCommunicationDeliveryJob(
      { ORGANIZATION_STORE: stores },
      ORGANIZATION_ID,
      communicationJob,
    );
    expect(suppressedDelivery.deliveries).toHaveLength(0);

    const firstCanceledResponse = await stub.fetch(
      `https://organization.internal/internal/scheduling/ticket-closeout-job?organizationId=${ORGANIZATION_ID}&jobId=${firstJob.jobId}`,
    );
    expect(firstCanceledResponse.status).toBe(404);
    const canceledResponse = await stub.fetch(
      `https://organization.internal/internal/scheduling/ticket-closeout-job?organizationId=${ORGANIZATION_ID}&jobId=${secondJob.jobId}`,
    );
    expect(canceledResponse.status).toBe(404);
  });
});
