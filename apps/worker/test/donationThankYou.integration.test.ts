import { donationRecordSchema, donationResponseSchema } from "@choir/contracts";
import {
  organizationRequest,
  readEmailOneTimeCode,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { reconcileProviderRefundInStore } from "../src/organization/paymentRefundStore";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";

const USER_ID = "thank-you-manager";
const USER_EMAIL = "thank-you.manager@example.test";
const ORGANIZATION_ID = "organization-alpha";
const api = organizationRequest;
const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

async function signIn(): Promise<string> {
  return signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );
}

async function countThankYouAuditEvents(donationId: string): Promise<number> {
  return runInDurableObject<OrganizationStore, number>(
    stores.get(stores.idFromName(ORGANIZATION_ID)),
    (_instance, state) =>
      state.storage.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE action = 'donation.thank_you_updated' AND target_id = ?`,
          donationId,
        )
        .toArray()[0]?.count ?? 0,
  );
}

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Thank-you Manager",
    email: USER_EMAIL,
    organizations: [
      { id: ORGANIZATION_ID, name: "Organization Alpha", role: "owner", slug: "alpha" },
    ],
    userId: USER_ID,
  });
});

afterEach(async () => {
  await teardownOrganizationIntegration();
});

describe("Organization donation thank-you status", () => {
  it("preserves a sent date through refund, rejects new sent markers, and allows undo", async () => {
    const cookie = await signIn();
    const donationResponse = await writeJson(
      exports.default,
      "alpha.localhost",
      "/api/organization/donations/manual",
      cookie,
      {
        amountCents: 5000,
        anonymous: false,
        buyerEmail: "manual-donor@example.test",
        buyerName: "Manual Donor",
        paymentMethod: "check",
        paymentReference: "Check #55",
        thankYouSent: false,
      },
    );
    expect(donationResponse.status).toBe(201);
    const donation = donationResponseSchema.parse(await donationResponse.json()).donation;
    expect(donation.thankYouSentAt).toBeNull();

    const sentResponse = await writeJson(
      exports.default,
      "alpha.localhost",
      "/api/organization/donations/thank-you",
      cookie,
      { donationId: donation.id, thankYouSent: true },
    );
    expect(sentResponse.status).toBe(200);
    const sentDonation = donationResponseSchema.parse(await sentResponse.json()).donation;
    expect(sentDonation.thankYouSentAt).not.toBeNull();

    const refundResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/donations/${donation.id}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(refundResponse.status).toBe(200);
    const refundedDonation = donationRecordSchema.parse(await refundResponse.json());
    expect(refundedDonation).toMatchObject({
      id: donation.id,
      status: "refunded",
      thankYouSentAt: sentDonation.thankYouSentAt,
    });

    const stub = stores.get(stores.idFromName(ORGANIZATION_ID));
    const rejectedStoreRequestId = crypto.randomUUID();
    const rejectedStoreResponse = await stub.fetch(
      "https://organization.internal/internal/donations/manage",
      {
        body: JSON.stringify({
          action: "update_donation_thank_you",
          actorUserId: USER_ID,
          donationId: donation.id,
          organizationId: ORGANIZATION_ID,
          requestId: rejectedStoreRequestId,
          thankYouSent: true,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(rejectedStoreResponse.status).toBe(409);
    expect(await rejectedStoreResponse.json()).toMatchObject({
      code: "refunded_donation_thank_you_not_allowed",
    });
    expect(await countThankYouAuditEvents(donation.id)).toBe(1);
    await expect(
      runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM audit_events WHERE id = ?",
              `donation-thank-you:${rejectedStoreRequestId}`,
            )
            .toArray()[0]?.count ?? 0,
      ),
    ).resolves.toBe(0);

    const rejectedRouteResponse = await writeJson(
      exports.default,
      "alpha.localhost",
      "/api/organization/donations/thank-you",
      cookie,
      { donationId: donation.id, thankYouSent: true },
    );
    expect(rejectedRouteResponse.status).toBe(409);
    expect(await rejectedRouteResponse.json()).toMatchObject({
      code: "refunded_donation_thank_you_not_allowed",
      message: "A thank-you letter cannot be marked as sent for a refunded donation.",
    });
    expect(await countThankYouAuditEvents(donation.id)).toBe(1);

    const undoResponse = await writeJson(
      exports.default,
      "alpha.localhost",
      "/api/organization/donations/thank-you",
      cookie,
      { donationId: donation.id, thankYouSent: false },
    );
    expect(undoResponse.status).toBe(200);
    expect(donationResponseSchema.parse(await undoResponse.json()).donation).toMatchObject({
      id: donation.id,
      status: "refunded",
      thankYouSentAt: null,
    });

    const rejectedAfterUndoResponse = await writeJson(
      exports.default,
      "alpha.localhost",
      "/api/organization/donations/thank-you",
      cookie,
      { donationId: donation.id, thankYouSent: true },
    );
    expect(rejectedAfterUndoResponse.status).toBe(409);
    expect(await rejectedAfterUndoResponse.json()).toMatchObject({
      code: "refunded_donation_thank_you_not_allowed",
    });
    expect(await countThankYouAuditEvents(donation.id)).toBe(2);

    const missingDonationResponse = await writeJson(
      exports.default,
      "alpha.localhost",
      "/api/organization/donations/thank-you",
      cookie,
      { donationId: crypto.randomUUID(), thankYouSent: false },
    );
    expect(missingDonationResponse.status).toBe(404);
    expect(await missingDonationResponse.json()).toMatchObject({ code: "donation_not_found" });
  });

  it("preserves an existing sent date during Stripe refund reconciliation", async () => {
    const donationId = crypto.randomUUID();
    const providerPaymentId = `pi_${crypto.randomUUID()}`;
    const stripeEventId = `evt_${crypto.randomUUID()}`;
    const checkoutRequestId = crypto.randomUUID();
    const providerSessionId = `cs_test_${crypto.randomUUID()}`;
    const sentAt = new Date(Date.now() - 60_000).toISOString();
    const stub = stores.get(stores.idFromName(ORGANIZATION_ID));

    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO donations
          (id, checkout_request_id, status, amount_cents, buyer_name, buyer_email,
           provider_session_id, provider_payment_id, created_at, updated_at, thank_you_sent_at)
         VALUES (?, ?, 'paid', 5000, 'Stripe Donor', 'stripe-donor@example.test',
           ?, ?, ?, ?, ?)`,
        donationId,
        checkoutRequestId,
        providerSessionId,
        providerPaymentId,
        now,
        now,
        sentAt,
      );
      return null;
    });

    const refundResponse = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: ORGANIZATION_ID,
          providerPaymentId,
          stripeEventId,
        }),
    );
    expect(refundResponse.status).toBe(200);
    expect(await refundResponse.json()).toEqual({ refunded: 1 });

    const donationState = await runInDurableObject<
      OrganizationStore,
      { readonly status: string; readonly thankYouSentAt: string | null }
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ readonly status: string; readonly thankYouSentAt: string | null }>(
          `SELECT status, thank_you_sent_at AS thankYouSentAt
           FROM donations WHERE id = ?`,
          donationId,
        )
        .one(),
    );
    expect(donationState).toEqual({ status: "refunded", thankYouSentAt: sentAt });
  });
});
