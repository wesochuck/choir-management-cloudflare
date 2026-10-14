import { donationResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { organizationRequest, readEmailOneTimeCode, signInWithOtp } from "@choir/testkit";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";

const USER_EMAIL = "calendar.manager@example.test";

const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const api = organizationRequest;

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Calendar Manager",
    email: USER_EMAIL,
    organizations: [
      { id: "organization-alpha", name: "Organization Alpha", slug: "alpha" },
      { id: "organization-bravo", name: "Organization Bravo", slug: "bravo" },
    ],
    userId: "calendar-manager",
  });
});

afterEach(async () => {
  await teardownOrganizationIntegration();
});

describe("Organization financials integration", () => {
  it("serves empty financial list routes and validates refund identifiers before store access", async () => {
    const cookie = await signIn();
    const listRoutes = [
      ["/api/organization/seasons", "seasons"],
      ["/api/organization/dues", "dues"],
      ["/api/organization/donations", "donations"],
      ["/api/organization/patrons", "patrons"],
    ] as const;
    for (const [path, key] of listRoutes) {
      const response = await exports.default.fetch(api("alpha.localhost", path, cookie));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ [key]: [] });
    }

    const invalidDuesRefund = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/dues/not-a-uuid/refund", cookie, {
        method: "POST",
      }),
    );
    expect(invalidDuesRefund.status).toBe(400);
    expect(await invalidDuesRefund.json()).toMatchObject({ code: "validation_failed" });

    const invalidDonationRefund = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/donations/not-a-uuid/refund", cookie, {
        method: "POST",
      }),
    );
    expect(invalidDonationRefund.status).toBe(400);
    expect(await invalidDonationRefund.json()).toMatchObject({ code: "validation_failed" });

    const donationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `INSERT INTO donations
            (id, checkout_request_id, status, amount_cents, fee_cents,
             tribute_type, tribute_name, tribute_notify_email, anonymous, marketing_consent,
             buyer_name, buyer_email, patron_id, provider_session_id, provider_payment_id,
             created_at, updated_at, refunded_at)
           VALUES (?, ?, 'paid', 2500, 0, 'none', '', '', 0, 0,
             'Route Donor', 'route-donor@example.test', NULL, ?, ?, ?, ?, NULL)`,
          donationId,
          crypto.randomUUID(),
          `fake_session_${donationId}`,
          `fake_payment_${donationId}`,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO payment_attempts
            (id, payment_type, resource_id, checkout_request_id, provider_session_id,
             provider_payment_id, status, amount_cents, created_at, updated_at)
           SELECT ?, 'donation', id, checkout_request_id, provider_session_id,
             provider_payment_id, 'paid', amount_cents, created_at, updated_at
           FROM donations WHERE id = ?`,
          `payment-attempt:${donationId}`,
          donationId,
        );
        return null;
      },
    );
    const refundedDonation = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/donations/${donationId}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(refundedDonation.status).toBe(200);
    expect(await refundedDonation.json()).toMatchObject({
      id: donationId,
      status: "refunded",
    });
    const crossTenantRefund = await exports.default.fetch(
      api("bravo.localhost", `/api/organization/donations/${donationId}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(crossTenantRefund.status).toBe(404);

    // Record a manual check donation with email
    const manualCheckResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/donations/manual", cookie, {
        body: JSON.stringify({
          amountCents: 5000,
          anonymous: false,
          buyerEmail: "manual-donor@example.test",
          buyerName: "Manual Donor",
          paymentMethod: "check",
          paymentReference: "Check #789",
          thankYouSent: false,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(manualCheckResponse.status).toBe(201);
    const manualCheck = donationResponseSchema.parse(await manualCheckResponse.json());
    expect(manualCheck.donation.thankYouSentAt).toBeNull();

    // Verify patron was linked
    const patronsAfterManual = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/patrons", cookie),
    );
    expect(patronsAfterManual.status).toBe(200);
    expect(await patronsAfterManual.json()).toMatchObject({
      patrons: [
        expect.objectContaining({
          email: "manual-donor@example.test",
          name: "Manual Donor",
          totalDonatedCents: 5000,
        }),
      ],
    });

    // Toggle thank-you letter status to sent
    const thankYouSentResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/donations/thank-you", cookie, {
        body: JSON.stringify({
          donationId: manualCheck.donation.id,
          thankYouSent: true,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(thankYouSentResponse.status).toBe(200);
    const thankYouSentData = donationResponseSchema.parse(await thankYouSentResponse.json());
    expect(thankYouSentData.donation.thankYouSentAt).not.toBeNull();

    // Toggle thank-you letter status back to pending
    const thankYouPendingResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/donations/thank-you", cookie, {
        body: JSON.stringify({
          donationId: manualCheck.donation.id,
          thankYouSent: false,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(thankYouPendingResponse.status).toBe(200);
    const thankYouPendingData = donationResponseSchema.parse(await thankYouPendingResponse.json());
    expect(thankYouPendingData.donation.thankYouSentAt).toBeNull();

    // Refund manual check donation
    const refundManualResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/donations/${manualCheck.donation.id}/refund`,
        cookie,
        {
          method: "POST",
        },
      ),
    );
    expect(refundManualResponse.status).toBe(200);
    expect(await refundManualResponse.json()).toMatchObject({
      id: manualCheck.donation.id,
      status: "refunded",
    });

    const seasonId = crypto.randomUUID();
    const duesId = crypto.randomUUID();
    const duesProfileId = crypto.randomUUID();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
          duesProfileId,
          "Dues Payer",
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO seasons (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
           VALUES (?, 'Refund Season', ?, ?, 2500, ?, ?)`,
          seasonId,
          now,
          now,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO dues
            (id, season_id, profile_id, amount_cents, fee_cents, provider_session_id,
             provider_payment_id, payer_email, status, payment_method, paid_at, created_at, updated_at)
           VALUES (?, ?, ?, 2500, 0, ?, ?, 'dues@example.test', 'paid', 'online', ?, ?, ?)`,
          duesId,
          seasonId,
          duesProfileId,
          `fake_session_${duesId}`,
          `fake_payment_${duesId}`,
          now,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO payment_attempts
            (id, payment_type, resource_id, checkout_request_id, provider_session_id,
             provider_payment_id, status, amount_cents, created_at, updated_at)
           VALUES (?, 'dues', ?, ?, ?, ?, 'paid', 2500, ?, ?)`,
          `payment-attempt:${duesId}`,
          duesId,
          crypto.randomUUID(),
          `fake_session_${duesId}`,
          `fake_payment_${duesId}`,
          now,
          now,
        );
        return null;
      },
    );
    const refundedDues = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/dues/${duesId}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(refundedDues.status).toBe(200);
    expect(await refundedDues.json()).toMatchObject({
      id: duesId,
      status: "refunded",
    });
    const crossTenantDuesRefund = await exports.default.fetch(
      api("bravo.localhost", `/api/organization/dues/${duesId}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(crossTenantDuesRefund.status).toBe(404);
  });
});
