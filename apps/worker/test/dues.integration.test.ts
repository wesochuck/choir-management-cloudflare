import {
  duesCheckoutResponseSchema,
  duesRecordSchema,
  memberDuesResponseSchema,
} from "@choir/contracts";
import { runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { requestOrganizationProviderRefund } from "../src/payments/refundRequest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import * as stripeCheckout from "../src/payments/stripeCheckout";
import {
  setupTicketingIntegration,
  teardownTicketingIntegration,
  database,
  stores,
  jsonWrite,
  signIn,
  api,
  env,
} from "./ticketing.integration.fixture";
beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("Organization dues and ticket payment transitions", () => {
  it("creates an idempotent fake dues checkout through the linked member route", async () => {
    const cookie = await signIn();
    const profileId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const now = new Date().toISOString();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Dues Route Member', ?, ?)`,
        profileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Dues Route Season', ?, ?, 3500, ?, ?)`,
        seasonId,
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
    });
    await database
      .prepare("UPDATE member SET profileId = ? WHERE organizationId = ? AND userId = ?")
      .bind(profileId, "organization-alpha", "ticket-manager")
      .run();

    const requestBody = { checkoutRequestId, seasonId };

    // When dues payment is inactive, dues list reports unavailable and checkout is rejected with 409
    const duesBefore = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/dues", cookie),
    );
    expect(duesBefore.status).toBe(200);
    const duesBeforeData = memberDuesResponseSchema.parse(await duesBefore.json());
    expect(duesBeforeData.onlineDuesPaymentsAvailable).toBe(false);

    const rejectedCheckout = await jsonWrite(
      "alpha.localhost",
      "/api/singer/dues/checkout",
      "POST",
      requestBody,
      cookie,
    );
    expect(rejectedCheckout.status).toBe(409);

    // Activate dues payments for organization-alpha
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE organization_metadata
         SET payment_activation_json = '{"tickets":true,"donations":true,"dues":true}'
         WHERE organization_id = ?`,
        "organization-alpha",
      );
    });

    const duesAfter = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/dues", cookie),
    );
    expect(duesAfter.status).toBe(200);
    const duesAfterData = memberDuesResponseSchema.parse(await duesAfter.json());
    expect(duesAfterData.onlineDuesPaymentsAvailable).toBe(true);

    const created = await jsonWrite(
      "alpha.localhost",
      "/api/singer/dues/checkout",
      "POST",
      requestBody,
      cookie,
    );
    expect(created.status).toBe(201);
    const checkout = duesCheckoutResponseSchema.parse(await created.json());
    expect(checkout.checkoutMode).toBe("fake");
    expect(checkout.sessionId).toMatch(/^fake_session_/);

    const replay = await jsonWrite(
      "alpha.localhost",
      "/api/singer/dues/checkout",
      "POST",
      requestBody,
      cookie,
    );
    expect(replay.status).toBe(201);
    expect(duesCheckoutResponseSchema.parse(await replay.json())).toMatchObject({
      checkoutMode: "fake",
      sessionId: checkout.sessionId,
    });
    await expect(
      runInDurableObject<OrganizationStore, { readonly count: number; readonly status: string }>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number; readonly status: string }>(
              `SELECT COUNT(*) AS count, MAX(status) AS status
               FROM dues WHERE season_id = ? AND profile_id = ?`,
              seasonId,
              profileId,
            )
            .one(),
      ),
    ).resolves.toEqual({ count: 1, status: "paid" });
    await expect(
      runInDurableObject<
        OrganizationStore,
        {
          readonly amountCents: number;
          readonly feeCents: number;
          readonly paymentAmountCents: number;
        }
      >(stub, (_instance, state) => {
        const dues = state.storage.sql
          .exec<{ readonly amountCents: number; readonly feeCents: number }>(
            `SELECT amount_cents AS amountCents, fee_cents AS feeCents
             FROM dues WHERE season_id = ? AND profile_id = ?`,
            seasonId,
            profileId,
          )
          .one();
        const payment = state.storage.sql
          .exec<{ readonly paymentAmountCents: number }>(
            `SELECT amount_cents AS paymentAmountCents
             FROM payment_attempts WHERE payment_type = 'dues' AND checkout_request_id = ?`,
            checkoutRequestId,
          )
          .one();
        return { ...dues, ...payment };
      }),
    ).resolves.toEqual({ amountCents: 3500, feeCents: 135, paymentAmountCents: 3635 });
  });

  it("grosses up one processing fee across a multi-profile dues checkout", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
    const seasonId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const now = new Date().toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Dues Member One', ?, ?), (?, 'Dues Member Two', ?, ?)`,
        profileIds[0],
        now,
        now,
        profileIds[1],
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Family Dues Season', ?, ?, 5000, ?, ?)`,
        seasonId,
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
    });

    const response = await stub.fetch("https://organization.internal/internal/seasons/manage", {
      body: JSON.stringify({
        action: "create_dues_checkout",
        checkout: { checkoutRequestId, profileIds: [...profileIds], seasonId },
        organizationId: "organization-alpha",
        origin: "https://alpha.localhost",
        recipientEmail: "payer@example.test",
        requestId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(200);

    await expect(
      runInDurableObject<
        OrganizationStore,
        { readonly paymentAmountCents: number; readonly totalFeeCents: number }
      >(stub, (_instance, state) => {
        const fees = state.storage.sql
          .exec<{ readonly totalFeeCents: number }>(
            `SELECT SUM(fee_cents) AS totalFeeCents
             FROM dues WHERE season_id = ? AND profile_id IN (?, ?)`,
            seasonId,
            profileIds[0],
            profileIds[1],
          )
          .one();
        const payment = state.storage.sql
          .exec<{ readonly paymentAmountCents: number }>(
            `SELECT amount_cents AS paymentAmountCents
             FROM payment_attempts WHERE payment_type = 'dues' AND checkout_request_id = ?`,
            checkoutRequestId,
          )
          .one();
        return { ...fees, ...payment };
      }),
    ).resolves.toEqual({
      // $100.00 grossed up at 2.9% + $0.30 = $3.30, not two separate $1.80 fees.
      paymentAmountCents: 10330,
      totalFeeCents: 330,
    });
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1000, 0, 1000, 'usd', ?, '', 'expired', 0, ?, ?, NULL, ?, NULL)`,
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
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at, expired_at)
         VALUES (?, 'ticket', ?, ?, ?, '', 'expired', 1000, ?, ?, ?)`,
        crypto.randomUUID(),
        purchaseId,
        checkoutRequestId,
        `pending_${purchaseId}`,
        now,
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
    const delayedCompletion = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_completed",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId: `pi_${purchaseId}`,
          providerSessionId: `stripe_session_${purchaseId}`,
          stripeEventId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(await delayedCompletion.json()).toMatchObject({ status: "paid" });
    expect(
      await runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              `SELECT COUNT(*) AS count
               FROM ticket_notifications
               WHERE purchase_id = ? AND kind = 'confirmation'`,
              purchaseId,
            )
            .one().count,
      ),
    ).toBe(1);
    expect(
      await runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              `SELECT COUNT(*) AS count
               FROM scheduled_job_outbox
               WHERE idempotency_key = 'ticket-notification:' ||
                 (SELECT id FROM ticket_notifications
                  WHERE purchase_id = ? AND kind = 'confirmation' LIMIT 1)`,
              purchaseId,
            )
            .one().count,
      ),
    ).toBe(1);
    expect(
      await runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              `SELECT COUNT(*) AS count
               FROM payment_attempts
               WHERE resource_id = ? AND status = 'paid' AND expired_at IS NULL`,
              purchaseId,
            )
            .one().count,
      ),
    ).toBe(1);
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
    const refundEventId = crypto.randomUUID();
    const refunded = await stub.fetch("https://organization.internal/internal/ticketing/manage", {
      body: JSON.stringify({
        action: "stripe_ticket_refunded",
        organizationId: "organization-alpha",
        providerPaymentId: `pi_${purchaseId}`,
        providerSessionId: "refund",
        stripeEventId: refundEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await refunded.json()).toMatchObject({ refunded: 1 });
    const duplicateRefund = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_refunded",
          organizationId: "organization-alpha",
          providerPaymentId: `pi_${purchaseId}`,
          providerSessionId: "refund",
          stripeEventId: refundEventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(await duplicateRefund.json()).toMatchObject({ duplicate: true, refunded: 0 });

    const disputeEventId = crypto.randomUUID();
    const dispute = await stub.fetch("https://organization.internal/internal/payments/manage", {
      body: JSON.stringify({
        action: "record_payment_dispute",
        amountCents: 1000,
        disputeStatus: "charge.dispute.created",
        organizationId: "organization-alpha",
        paymentType: "ticket",
        providerPaymentId: `pi_${purchaseId}`,
        providerSessionId: `dp_${purchaseId}`,
        reason: "fraudulent",
        stripeEventId: disputeEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await dispute.json()).toMatchObject({ recorded: true });
    const duplicateDispute = await stub.fetch(
      "https://organization.internal/internal/payments/manage",
      {
        body: JSON.stringify({
          action: "record_payment_dispute",
          amountCents: 1000,
          disputeStatus: "charge.dispute.created",
          organizationId: "organization-alpha",
          paymentType: "ticket",
          providerPaymentId: `pi_${purchaseId}`,
          providerSessionId: `dp_${purchaseId}`,
          reason: "fraudulent",
          stripeEventId: disputeEventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(await duplicateDispute.json()).toMatchObject({ duplicate: true, recorded: true });
    expect(
      await runInDurableObject<OrganizationStore, { amountCents: number; reason: string }>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ amountCents: number; reason: string }>(
              `SELECT amount_cents AS amountCents, reason
               FROM payment_disputes WHERE provider_dispute_id = ?`,
              `dp_${purchaseId}`,
            )
            .one(),
      ),
    ).toMatchObject({ amountCents: 1000, reason: "fraudulent" });
  });

  it("reuses a dues checkout request and rejects a mismatched retry", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Dues Idempotency Member', ?, ?)`,
        profileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Dues Idempotency Season', ?, ?, 4000, ?, ?)`,
        seasonId,
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
    });
    const create = (requestId: string, profileIds: readonly string[]) =>
      stub.fetch("https://organization.internal/internal/seasons/manage", {
        body: JSON.stringify({
          action: "create_dues_checkout",
          checkout: { checkoutRequestId, profileIds, seasonId },
          organizationId: "organization-alpha",
          origin: "https://alpha.localhost",
          requestId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    const first = await create(crypto.randomUUID(), [profileId]);
    expect(first.status).toBe(200);
    const firstBody: { sessionId: string } = await first.json();
    const retry = await create(crypto.randomUUID(), [profileId]);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ sessionId: firstBody.sessionId });
    const conflict = await create(crypto.randomUUID(), [crypto.randomUUID()]);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "checkout_request_conflict" });
  });

  it("rejects a second pending dues checkout for the same profile", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const firstCheckoutRequestId = crypto.randomUUID();
    const secondCheckoutRequestId = crypto.randomUUID();
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Concurrent Dues Member', ?, ?)`,
        profileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Concurrent Dues Season', ?, ?, 4000, ?, ?)`,
        seasonId,
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
    });
    const prepare = (checkoutRequestId: string) =>
      stub.fetch("https://organization.internal/internal/seasons/manage", {
        body: JSON.stringify({
          action: "prepare_dues_checkout",
          checkout: { checkoutRequestId, profileIds: [profileId], seasonId },
          organizationId: "organization-alpha",
          origin: "https://alpha.localhost",
          providerSessionId: `pending_${checkoutRequestId}`,
          requestId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

    const first = await prepare(firstCheckoutRequestId);
    expect(first.status).toBe(200);
    const second = await prepare(secondCheckoutRequestId);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "dues_checkout_in_progress" });
  });

  it("keeps a cash-paid dues record and its online attempt out of later fulfillment", async () => {
    const cookie = await signIn();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const duesId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const providerSessionId = `stripe_cash_race_${duesId}`;
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Cash Race Member', ?, ?)`,
        profileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Cash Race Season', ?, ?, 4000, ?, ?)`,
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
         VALUES (?, ?, ?, 4000, 146, ?, '', '', 'pending', 'online', NULL, ?, ?)`,
        duesId,
        seasonId,
        profileId,
        providerSessionId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES (?, 'dues', ?, ?, ?, '', 'pending', 4146, ?, ?)`,
        crypto.randomUUID(),
        duesId,
        checkoutRequestId,
        providerSessionId,
        now,
        now,
      );
    });
    const cash = await jsonWrite(
      "alpha.localhost",
      "/api/organization/dues/cash",
      "POST",
      { profileId, seasonId },
      cookie,
    );
    expect(cash.status).toBe(409);
    expect(await cash.json()).toMatchObject({ code: "dues_checkout_in_progress" });
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE dues SET payment_method = 'cash', status = 'paid', paid_at = ? WHERE id = ?",
        new Date().toISOString(),
        duesId,
      );
      state.storage.sql.exec(
        "UPDATE payment_attempts SET status = 'expired', expired_at = ?, updated_at = ? WHERE resource_id = ?",
        new Date().toISOString(),
        new Date().toISOString(),
        duesId,
      );
    });

    const completion = await stub.fetch("https://organization.internal/internal/seasons/manage", {
      body: JSON.stringify({
        action: "stripe_dues_completed",
        checkoutRequestId,
        organizationId: "organization-alpha",
        providerPaymentId: `pi_cash_race_${duesId}`,
        providerSessionId,
        stripeEventId: crypto.randomUUID(),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(completion.status).toBe(200);
    expect(await completion.json()).toMatchObject({
      dues: [{ paymentMethod: "cash", status: "paid" }],
    });
    expect(
      await runInDurableObject<
        OrganizationStore,
        { duesStatus: string; method: string; attemptStatus: string }
      >(stub, (_instance, state) =>
        state.storage.sql
          .exec<{ duesStatus: string; method: string; attemptStatus: string }>(
            `SELECT d.status AS duesStatus, d.payment_method AS method, pa.status AS attemptStatus
               FROM dues d JOIN payment_attempts pa ON pa.resource_id = d.id
               WHERE d.id = ?`,
            duesId,
          )
          .one(),
      ),
    ).toEqual({ duesStatus: "paid", method: "cash", attemptStatus: "expired" });
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

  it("does not cross-claim unmatched Stripe refund events between payment modules", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const eventId = crypto.randomUUID();
    const donationRefund = await stub.fetch(
      "https://organization.internal/internal/donations/manage",
      {
        body: JSON.stringify({
          action: "stripe_donation_refunded",
          organizationId: "organization-alpha",
          providerPaymentId: "pi-no-such-payment",
          stripeEventId: eventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(donationRefund.status).toBe(404);

    const duesRefund = await stub.fetch("https://organization.internal/internal/seasons/manage", {
      body: JSON.stringify({
        action: "stripe_dues_refunded",
        organizationId: "organization-alpha",
        providerPaymentId: "pi-no-such-payment",
        stripeEventId: eventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(duesRefund.status).toBe(404);
    expect(await duesRefund.json()).toMatchObject({ code: "dues_not_found" });
    await expect(
      runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM audit_events WHERE id = ?",
              `stripe-refund:${eventId}`,
            )
            .one().count,
      ),
    ).resolves.toBe(0);
  });

  it("releases stale pending dues and blocks individual refunds for shared Stripe checkouts", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const staleProfileId = crypto.randomUUID();
    const staleSeasonId = crypto.randomUUID();
    const staleDuesId = crypto.randomUUID();
    const staleAttemptId = crypto.randomUUID();
    const sharedProfileIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
    const sharedSeasonId = crypto.randomUUID();
    const sharedDuesIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
    const sharedSessionId = `cs_shared_${crypto.randomUUID()}`;
    const sharedPaymentId = `pi_shared_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const staleCreatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Stale Dues Member', ?, ?), (?, 'Shared Member One', ?, ?),
           (?, 'Shared Member Two', ?, ?)`,
        staleProfileId,
        now,
        now,
        sharedProfileIds[0],
        now,
        now,
        sharedProfileIds[1],
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Stale Dues Season', ?, ?, 4000, ?, ?),
           (?, 'Shared Dues Season', ?, ?, 5000, ?, ?)`,
        staleSeasonId,
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
        sharedSeasonId,
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO dues
          (id, season_id, profile_id, amount_cents, fee_cents, provider_session_id,
           provider_payment_id, payer_email, status, payment_method, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, 4000, 0, ?, '', '', 'pending', 'online', NULL, ?, ?),
           (?, ?, ?, 5000, 0, ?, ?, 'one@example.test', 'paid', 'online', ?, ?, ?),
           (?, ?, ?, 5000, 0, ?, ?, 'two@example.test', 'paid', 'online', ?, ?, ?)`,
        staleDuesId,
        staleSeasonId,
        staleProfileId,
        `pending_${staleDuesId}`,
        staleCreatedAt,
        staleCreatedAt,
        sharedDuesIds[0],
        sharedSeasonId,
        sharedProfileIds[0],
        sharedSessionId,
        sharedPaymentId,
        now,
        now,
        now,
        sharedDuesIds[1],
        sharedSeasonId,
        sharedProfileIds[1],
        sharedSessionId,
        sharedPaymentId,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES (?, 'dues', ?, ?, ?, '', 'pending', 4000, ?, ?),
           (?, 'dues', ?, ?, ?, ?, 'paid', 10000, ?, ?)`,
        staleAttemptId,
        staleDuesId,
        crypto.randomUUID(),
        `pending_${staleDuesId}`,
        staleCreatedAt,
        staleCreatedAt,
        crypto.randomUUID(),
        sharedDuesIds[0],
        crypto.randomUUID(),
        sharedSessionId,
        sharedPaymentId,
        now,
        now,
      );
    });

    const cash = await stub.fetch("https://organization.internal/internal/seasons/manage", {
      body: JSON.stringify({
        action: "mark_dues_cash_paid",
        actorUserId: "ticket-manager",
        cashPayment: { profileId: staleProfileId, seasonId: staleSeasonId },
        organizationId: "organization-alpha",
        requestId: crypto.randomUUID(),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(cash.status).toBe(200);
    expect(await cash.json()).toMatchObject({ paymentMethod: "cash", status: "paid" });

    await expect(
      runInDurableObject<OrganizationStore, { readonly status: string; readonly attempt: string }>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly status: string; readonly attempt: string }>(
              `SELECT d.payment_method AS status, pa.status AS attempt
               FROM dues d JOIN payment_attempts pa ON pa.id = ?
               WHERE d.id = ?`,
              staleAttemptId,
              staleDuesId,
            )
            .one(),
      ),
    ).resolves.toEqual({ attempt: "expired", status: "cash" });

    await expect(
      requestOrganizationProviderRefund(
        { ORGANIZATION_STORE: stores, STRIPE_SECRET_KEY: "sk_test_shared" },
        {
          actorUserId: "ticket-manager",
          organizationId: "organization-alpha",
          paymentType: "dues",
          requestId: crypto.randomUUID(),
          resourceId: sharedDuesIds[1],
        },
      ),
    ).rejects.toMatchObject({
      code: "dues_multi_member_refund_unsupported",
      status: 409,
    });
    expect(
      await runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM dues WHERE provider_payment_id = ? AND status = 'paid'",
              sharedPaymentId,
            )
            .one().count,
      ),
    ).toBe(2);
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
          "/api/organization/dues/cash",
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
          "/api/organization/dues/cash",
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
      "/api/organization/dues/cash",
      "POST",
      { profileId, seasonId },
      cookie,
    );
    expect(memberAttempt.status).toBe(403);
  });

  it("converts an in-progress single-profile dues checkout to cash and cancels pending online checkout", async () => {
    const cookie = await signIn();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const duesId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const providerSessionId = `pending_conv_${duesId}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Convert Dues Member', ?, ?)`,
        profileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Convert Dues Season', ?, ?, 4500, ?, ?)`,
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
         VALUES (?, ?, ?, 4500, 161, ?, '', '', 'pending', 'online', NULL, ?, ?)`,
        duesId,
        seasonId,
        profileId,
        providerSessionId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES (?, 'dues', ?, ?, ?, '', 'pending', 4661, ?, ?)`,
        crypto.randomUUID(),
        duesId,
        checkoutRequestId,
        providerSessionId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO dues_expirations (dues_id, stripe_event_id, expired_at)
         VALUES (?, '', ?)`,
        duesId,
        expiresAt,
      );
    });

    // 1. Without cancelPendingOnlineCheckout, rejects with 409 dues_checkout_in_progress
    const inProgress = await jsonWrite(
      "alpha.localhost",
      "/api/organization/dues/cash",
      "POST",
      { profileId, seasonId },
      cookie,
    );
    expect(inProgress.status).toBe(409);
    expect(await inProgress.json()).toMatchObject({ code: "dues_checkout_in_progress" });

    // 2. With mismatched expectedDuesId, rejects with 409 dues_state_conflict
    const conflict = await jsonWrite(
      "alpha.localhost",
      "/api/organization/dues/cash",
      "POST",
      {
        cancelPendingOnlineCheckout: true,
        expectedDuesId: crypto.randomUUID(),
        profileId,
        seasonId,
      },
      cookie,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "dues_state_conflict" });

    // 3. With cancelPendingOnlineCheckout and matching expectedDuesId, succeeds
    const converted = await jsonWrite(
      "alpha.localhost",
      "/api/organization/dues/cash",
      "POST",
      {
        cancelPendingOnlineCheckout: true,
        expectedDuesId: duesId,
        profileId,
        seasonId,
      },
      cookie,
    );
    expect(converted.status).toBe(200);
    const convertedRecord = duesRecordSchema.parse(await converted.json());
    expect(convertedRecord).toMatchObject({
      amountCents: 4500,
      feeCents: 0,
      id: duesId,
      paymentMethod: "cash",
      profileId,
      seasonId,
      status: "paid",
    });

    // 4. Verify durable store state
    await expect(
      runInDurableObject<
        OrganizationStore,
        {
          readonly duesFeeCents: number;
          readonly duesMethod: string;
          readonly duesStatus: string;
          readonly expirationsCount: number;
          readonly paidAt: string | null;
          readonly paExpiredAt: string | null;
          readonly paStatus: string;
        }
      >(stub, (_instance, state) => {
        const dues = state.storage.sql
          .exec<{
            readonly duesFeeCents: number;
            readonly duesMethod: string;
            readonly duesStatus: string;
            readonly paidAt: string | null;
          }>(
            `SELECT status AS duesStatus, payment_method AS duesMethod,
                    fee_cents AS duesFeeCents, paid_at AS paidAt
             FROM dues WHERE id = ?`,
            duesId,
          )
          .one();
        const pa = state.storage.sql
          .exec<{ readonly paExpiredAt: string | null; readonly paStatus: string }>(
            `SELECT status AS paStatus, expired_at AS paExpiredAt
             FROM payment_attempts WHERE resource_id = ?`,
            duesId,
          )
          .one();
        const expirations = state.storage.sql
          .exec<{ readonly expirationsCount: number }>(
            "SELECT COUNT(*) AS expirationsCount FROM dues_expirations WHERE dues_id = ?",
            duesId,
          )
          .one();
        return { ...dues, ...pa, ...expirations };
      }),
    ).resolves.toMatchObject({
      duesFeeCents: 0,
      duesMethod: "cash",
      duesStatus: "paid",
      expirationsCount: 0,
      paStatus: "expired",
    });

    // 5. Verify audit event
    await expect(
      runInDurableObject<
        OrganizationStore,
        { readonly action: string; readonly changeSummary: string }
      >(stub, (_instance, state) =>
        state.storage.sql
          .exec<{ readonly action: string; readonly changeSummary: string }>(
            "SELECT action, change_summary AS changeSummary FROM audit_events WHERE action = 'dues.converted_to_cash'",
          )
          .one(),
      ),
    ).resolves.toMatchObject({
      action: "dues.converted_to_cash",
    });
  });

  it("blocks converting an individual dues checkout that is part of a shared group checkout", async () => {
    const cookie = await signIn();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId1 = crypto.randomUUID();
    const profileId2 = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const duesId1 = crypto.randomUUID();
    const duesId2 = crypto.randomUUID();
    const sharedSessionId = `pending_shared_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Shared One', ?, ?), (?, 'Shared Two', ?, ?)`,
        profileId1,
        now,
        now,
        profileId2,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Shared Group Season', ?, ?, 5000, ?, ?)`,
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
         VALUES (?, ?, ?, 5000, 150, ?, '', '', 'pending', 'online', NULL, ?, ?),
                (?, ?, ?, 5000, 150, ?, '', '', 'pending', 'online', NULL, ?, ?)`,
        duesId1,
        seasonId,
        profileId1,
        sharedSessionId,
        now,
        now,
        duesId2,
        seasonId,
        profileId2,
        sharedSessionId,
        now,
        now,
      );
    });

    const attempt = await jsonWrite(
      "alpha.localhost",
      "/api/organization/dues/cash",
      "POST",
      {
        cancelPendingOnlineCheckout: true,
        expectedDuesId: duesId1,
        profileId: profileId1,
        seasonId,
      },
      cookie,
    );
    expect(attempt.status).toBe(409);
    expect(await attempt.json()).toMatchObject({ code: "dues_shared_checkout" });
  });

  it("verifies and expires live Stripe checkout session or rejects if already paid", async () => {
    const cookie = await signIn();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const duesId = crypto.randomUUID();
    const stripeSessionId = `cs_test_convert_${duesId}`;
    const now = new Date().toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Stripe Convert Member', ?, ?)`,
        profileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Stripe Convert Season', ?, ?, 4000, ?, ?)`,
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
         VALUES (?, ?, ?, 4000, 146, ?, '', '', 'pending', 'online', NULL, ?, ?)`,
        duesId,
        seasonId,
        profileId,
        stripeSessionId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO stripe_connect_accounts
          (organization_id, account_id, status, details_submitted, charges_enabled, payouts_enabled, requirements_due_json, created_at, updated_at)
         VALUES ('organization-alpha', 'acct_1234567890', 'ready', 1, 1, 1, '[]', ?, ?)`,
        now,
        now,
      );
    });

    const previousSecretKey = Reflect.get(env, "STRIPE_SECRET_KEY");
    Reflect.set(env, "STRIPE_SECRET_KEY", "sk_test_fake_secret");

    const retrieveSpy = vi.spyOn(stripeCheckout, "retrieveStripeCheckoutReconciliationSession");
    const expireSpy = vi.spyOn(stripeCheckout, "expireStripeCheckoutSession");

    try {
      // Case 1: Stripe reports session is already paid
      retrieveSpy.mockResolvedValueOnce({
        amountTotalCents: 4146,
        currency: "usd",
        id: stripeSessionId,
        metadata: {},
        mode: "payment",
        paymentIntentId: "pi_already_paid",
        paymentStatus: "paid",
        status: "complete",
      });

      const alreadyPaid = await jsonWrite(
        "alpha.localhost",
        "/api/organization/dues/cash",
        "POST",
        {
          cancelPendingOnlineCheckout: true,
          expectedDuesId: duesId,
          profileId,
          seasonId,
        },
        cookie,
      );
      expect(alreadyPaid.status).toBe(409);
      expect(await alreadyPaid.json()).toMatchObject({ code: "dues_already_paid" });
      expect(expireSpy).not.toHaveBeenCalled();

      // Case 2: Stripe reports session is open and unpaid -> expires session and converts to cash
      retrieveSpy.mockResolvedValueOnce({
        amountTotalCents: 4146,
        currency: "usd",
        id: stripeSessionId,
        metadata: {},
        mode: "payment",
        paymentIntentId: null,
        paymentStatus: "unpaid",
        status: "open",
      });
      expireSpy.mockResolvedValueOnce({
        amountTotalCents: 4146,
        currency: "usd",
        id: stripeSessionId,
        metadata: {},
        mode: "payment",
        paymentIntentId: null,
        paymentStatus: "unpaid",
        status: "expired",
      });

      const success = await jsonWrite(
        "alpha.localhost",
        "/api/organization/dues/cash",
        "POST",
        {
          cancelPendingOnlineCheckout: true,
          expectedDuesId: duesId,
          profileId,
          seasonId,
        },
        cookie,
      );
      expect(success.status).toBe(200);
      expect(expireSpy).toHaveBeenCalledWith(
        "sk_test_fake_secret",
        "acct_1234567890",
        stripeSessionId,
      );
    } finally {
      Reflect.set(env, "STRIPE_SECRET_KEY", previousSecretKey);
      retrieveSpy.mockRestore();
      expireSpy.mockRestore();
    }
  });

  it("records duplicate payment audit event when a completed Stripe webhook arrives after dues were converted to cash", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId = crypto.randomUUID();
    const seasonId = crypto.randomUUID();
    const duesId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const providerSessionId = `cs_late_race_${duesId}`;
    const now = new Date().toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Late Webhook Member', ?, ?)`,
        profileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Late Webhook Season', ?, ?, 4000, ?, ?)`,
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
         VALUES (?, ?, ?, 4000, 0, ?, '', '', 'paid', 'cash', ?, ?, ?)`,
        duesId,
        seasonId,
        profileId,
        providerSessionId,
        now,
        now,
        now,
      );
    });

    const completed = await stub.fetch("https://organization.internal/internal/seasons/manage", {
      body: JSON.stringify({
        action: "stripe_dues_completed",
        checkoutRequestId,
        organizationId: "organization-alpha",
        providerPaymentId: `pi_late_${duesId}`,
        providerSessionId,
        stripeEventId: crypto.randomUUID(),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(completed.status).toBe(200);

    // Verify dues record remained cash and paid
    await expect(
      runInDurableObject<OrganizationStore, { readonly method: string; readonly status: string }>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly method: string; readonly status: string }>(
              "SELECT status, payment_method AS method FROM dues WHERE id = ?",
              duesId,
            )
            .one(),
      ),
    ).resolves.toEqual({ method: "cash", status: "paid" });

    // Verify dues.duplicate_payment_detected was recorded in audit_events
    await expect(
      runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'dues.duplicate_payment_detected'",
            )
            .one().count,
      ),
    ).resolves.toBe(1);
  });
});
