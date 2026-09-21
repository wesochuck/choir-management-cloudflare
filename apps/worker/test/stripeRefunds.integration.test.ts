import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { reconcileProviderRefundInStore } from "../src/organization/paymentRefundStore";
import {
  setupTicketingIntegration,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("Organization Stripe refund reconciliation", () => {
  it("reconciles ticket refund by provider payment ID fallback", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at)
         VALUES
          ('pur-fallback-1', 'req-fallback-1', 'ev-1', 'Concert Title', '2026-10-01T20:00:00Z', 'America/New_York',
           'Fallback Buyer', 'buyer@example.test', 1, 2000, 0, 2000,
           'usd', 'cs_fallback_1', 'pi_fallback_ticket', 'paid', 0,
           ?, ?)`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES
          ('pa-fallback-1', 'ticket', 'pur-fallback-1', 'req-fallback-1', 'cs_fallback_1',
           'pi_fallback_ticket', 'paid', 2000, ?, ?)`,
        now,
        now,
      );
    });

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_fallback_ticket",
          stripeEventId: "evt_fallback_ticket_1",
        }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ refunded: 1 });

    const status = await runInDurableObject<OrganizationStore, string>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM ticket_purchases WHERE id = 'pur-fallback-1' LIMIT 1",
          )
          .one().status,
    );
    expect(status).toBe("refunded");

    // Replaying duplicate event returns duplicate: true
    const replayResponse = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_fallback_ticket",
          stripeEventId: "evt_fallback_ticket_1",
        }),
    );
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual({ duplicate: true, refunded: 0 });
  });

  it("reconciles donation refund by provider payment ID fallback", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO donations
          (id, buyer_name, buyer_email, amount_cents, fee_cents, anonymous,
           tribute_type, tribute_name, tribute_notify_email, checkout_request_id,
           provider_session_id, provider_payment_id, status, created_at, updated_at)
         VALUES
          ('don-fallback-1', 'Donor Fallback', 'donor@example.test', 5000, 0, 0,
           'none', '', '', 'req-don-1',
           'cs_don_1', 'pi_fallback_donation', 'paid', ?, ?)`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES
          ('pa-don-1', 'donation', 'don-fallback-1', 'req-don-1', 'cs_don_1',
           'pi_fallback_donation', 'paid', 5000, ?, ?)`,
        now,
        now,
      );
    });

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_fallback_donation",
          stripeEventId: "evt_fallback_donation_1",
        }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ refunded: 1 });

    const status = await runInDurableObject<OrganizationStore, string>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM donations WHERE id = 'don-fallback-1' LIMIT 1",
          )
          .one().status,
    );
    expect(status).toBe("refunded");
  });

  it("fails closed when multiple payment domains match the provider payment ID", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      const duplicatePi = "pi_duplicate_shared";
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at)
         VALUES
          ('pur-ambig-1', 'req-ambig-1', 'ev-1', 'Concert Title', '2026-10-01T20:00:00Z', 'America/New_York',
           'Ambig Buyer', 'buyer@example.test', 1, 2000, 0, 2000,
           'usd', 'cs_ambig_1', ?, 'paid', 0,
           ?, ?)`,
        duplicatePi,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO donations
          (id, buyer_name, buyer_email, amount_cents, fee_cents, anonymous,
           tribute_type, tribute_name, tribute_notify_email, checkout_request_id,
           provider_session_id, provider_payment_id, status, created_at, updated_at)
         VALUES
          ('don-ambig-1', 'Donor Ambig', 'donor@example.test', 2000, 0, 0,
           'none', '', '', 'req-ambig-2',
           'cs_ambig_2', ?, 'paid', ?, ?)`,
        duplicatePi,
        now,
        now,
      );
    });

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_duplicate_shared",
          stripeEventId: "evt_ambiguous_1",
        }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ambiguous_payment_refund" });
  });

  it("returns 404 when no matching payment is found", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_nonexistent",
          stripeEventId: "evt_missing_1",
        }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "payment_not_found" });
  });

  it("fails closed on organization identity mismatch", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: "organization-bravo",
          providerPaymentId: "pi_some_payment",
          stripeEventId: "evt_wrong_org_1",
        }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "organization_identity_conflict" });
  });
});
