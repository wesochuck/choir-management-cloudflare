import {
  paymentActivationSettingsSchema,
  platformStripeConnectResetResponseSchema,
  platformStripeConnectStatusResponseSchema,
  problemDetailsSchema,
} from "@choir/contracts";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authRequest,
  fetchWorker,
  grantPlatformAdministratorForCurrentSession,
  seedInvitedUser,
  setupAuthIntegration,
  signInInvitedUser,
  teardownAuthIntegration,
  testEnv,
} from "./auth.integration.fixture";
import {
  resolveOrganizationForStripeAccount,
  upsertStripeAccountOrganization,
} from "../src/payments/stripeRouting";

beforeEach(async () => setupAuthIntegration());
afterEach(async () => teardownAuthIntegration());

async function seedTestOrganization(orgId = crypto.randomUUID()): Promise<{
  orgId: string;
  stub: DurableObjectStub;
}> {
  const now = new Date().toISOString();
  await testEnv.CONTROL_DB.prepare(
    `INSERT INTO organizations
      (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version, created_at, updated_at)
     VALUES (?, 'Test Org', 'test-org', 'active', ?, 1, ?, ?)`,
  )
    .bind(orgId, orgId, now, now)
    .run();
  const stub = testEnv.ORGANIZATION_STORE.get(testEnv.ORGANIZATION_STORE.idFromName(orgId));
  await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO organization_metadata
        (organization_id, name, slug, lifecycle_state, payment_activation_json, created_at, updated_at)
       VALUES (?, 'Test Org', 'test-org', 'active', '{"tickets":false,"donations":false,"dues":false}', ?, ?)`,
      orgId,
      now,
      now,
    );
    return null;
  });
  return { orgId, stub };
}

async function seedConnectedStripe(
  stub: DurableObjectStub,
  orgId: string,
  accountId: string,
  activations = { donations: true, dues: true, tickets: true },
): Promise<void> {
  const now = new Date().toISOString();
  await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO organization_metadata
        (organization_id, name, slug, payment_activation_json, created_at, updated_at)
       VALUES (?, 'Test Org', 'test-org', ?, ?, ?)`,
      orgId,
      JSON.stringify(activations),
      now,
      now,
    );
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO stripe_connect_accounts
        (organization_id, account_id, details_submitted, charges_enabled, payouts_enabled,
         requirements_due_json, card_payments_status, payouts_status, dashboard_type,
         fees_collector, losses_collector, last_synced_at, status, created_at, updated_at)
       VALUES (?, ?, 1, 1, 1, '[]', 'active', 'active', 'full', 'stripe', 'stripe', ?, 'ready', ?, ?)`,
      orgId,
      accountId,
      now,
      now,
      now,
    );
    return null;
  });
  await upsertStripeAccountOrganization(testEnv.CONTROL_DB, {
    accountId,
    now,
    organizationId: orgId,
    status: "active",
  });
}

describe("Platform Administrator Stripe Connect recovery", () => {
  it("enforces authentication and platform administrator authorization", async () => {
    const { orgId } = await seedTestOrganization();

    // 1. Unauthenticated
    const unauthGet = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect`),
    );
    expect([401, 403]).toContain(unauthGet.status);

    const unauthPost = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect/reset`, {
        body: JSON.stringify({
          confirm: true,
          expectedAccountId: "acct_test123",
          reason: "Testing auth",
        }),
        method: "POST",
      }),
    );
    expect([401, 403]).toContain(unauthPost.status);

    // 2. Authenticated as non-platform admin
    await seedInvitedUser();
    const memberCookie = await signInInvitedUser();

    const memberGet = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect`, {
        headers: { cookie: memberCookie },
      }),
    );
    expect(memberGet.status).toBe(403);

    const memberPost = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect/reset`, {
        body: JSON.stringify({
          confirm: true,
          expectedAccountId: "acct_test123",
          reason: "Testing auth",
        }),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(memberPost.status).toBe(403);
  });

  it("enforces product base domain and valid organization existence", async () => {
    const { orgId } = await seedTestOrganization();
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();

    // Wrong origin (tenant domain instead of base domain)
    const tenantOriginGet = await fetchWorker(
      authRequest(
        `/api/platform/organizations/${orgId}/stripe-connect`,
        { headers: { cookie: sessionCookie } },
        "https://alpha.localhost",
      ),
    );
    expect(tenantOriginGet.status).toBe(404);

    // Non-existent organization UUID
    const nonExistentOrgId = crypto.randomUUID();
    const missingOrgGet = await fetchWorker(
      authRequest(`/api/platform/organizations/${nonExistentOrgId}/stripe-connect`, {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(missingOrgGet.status).toBe(404);

    // Invalid non-UUID organization ID
    const invalidOrgGet = await fetchWorker(
      authRequest("/api/platform/organizations/not-a-uuid/stripe-connect", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(invalidOrgGet.status).toBe(404);
  });

  it("reports eligibility status for not connected and connected organizations", async () => {
    const { orgId, stub } = await seedTestOrganization();
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();

    // 1. Not connected
    const notConnectedGet = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect`, {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(notConnectedGet.status).toBe(200);
    const notConnectedStatus = platformStripeConnectStatusResponseSchema.parse(
      await notConnectedGet.json(),
    );
    expect(notConnectedStatus).toMatchObject({
      accountId: null,
      activations: { donations: false, dues: false, tickets: false },
      eligibleForReset: false,
      hasPaymentHistory: false,
      hasPendingPayments: false,
      ineligibilityReason: "not_connected",
      organizationId: orgId,
      status: "not_started",
    });

    // 2. Connected, no transactions -> eligible
    const accountId = "acct_testconnect123";
    await seedConnectedStripe(stub, orgId, accountId, {
      donations: true,
      dues: true,
      tickets: true,
    });

    const connectedGet = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect`, {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(connectedGet.status).toBe(200);
    const connectedStatus = platformStripeConnectStatusResponseSchema.parse(
      await connectedGet.json(),
    );
    expect(connectedStatus).toMatchObject({
      accountId,
      activations: { donations: true, dues: true, tickets: true },
      eligibleForReset: true,
      hasPaymentHistory: false,
      hasPendingPayments: false,
      ineligibilityReason: null,
      organizationId: orgId,
      status: "ready",
    });
  });

  it("permits reset when only fake transactions exist, but blocks reset when real payment history exists", async () => {
    const { orgId, stub } = await seedTestOrganization();
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();

    const accountId = "acct_testconnect123";
    await seedConnectedStripe(stub, orgId, accountId);

    // Insert fake ticket purchase and fake payment attempt
    const now = new Date().toISOString();
    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           provider_session_id, provider_payment_id, status, created_at, updated_at)
         VALUES ('tp_fake1', 'cr_fake1', 'event_1', 'Concert', '2026-12-01T20:00:00Z', 'America/New_York',
                 'Buyer', 'buyer@test.org', 1, 5000, 0, 5000,
                 'fake_cs_123', 'fake_pi_123', 'paid', ?, ?)`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, amount_cents, status,
           provider_session_id, provider_payment_id, created_at, updated_at)
         VALUES ('pa_fake1', 'ticket', 'tp_fake1', 'cr_fake1', 5000, 'paid',
                 'fake_cs_123', 'fake_pi_123', ?, ?)`,
        now,
        now,
      );
      return null;
    });

    // Still eligible because transactions were test / fake provider sessions
    const fakeEligibleGet = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect`, {
        headers: { cookie: sessionCookie },
      }),
    );
    const fakeEligibleStatus = platformStripeConnectStatusResponseSchema.parse(
      await fakeEligibleGet.json(),
    );
    expect(fakeEligibleStatus.eligibleForReset).toBe(true);
    expect(fakeEligibleStatus.hasPaymentHistory).toBe(false);

    // Now insert a REAL completed payment
    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           provider_session_id, provider_payment_id, status, created_at, updated_at)
         VALUES ('tp_real1', 'cr_real1', 'event_1', 'Concert', '2026-12-01T20:00:00Z', 'America/New_York',
                 'Real Buyer', 'realbuyer@test.org', 1, 7500, 0, 7500,
                 'cs_live_real_1', 'pi_stripe_live_real_1', 'paid', ?, ?)`,
        now,
        now,
      );
      return null;
    });

    const realHistoryGet = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect`, {
        headers: { cookie: sessionCookie },
      }),
    );
    const realHistoryStatus = platformStripeConnectStatusResponseSchema.parse(
      await realHistoryGet.json(),
    );
    expect(realHistoryStatus.eligibleForReset).toBe(false);
    expect(realHistoryStatus.hasPaymentHistory).toBe(true);
    expect(realHistoryStatus.ineligibilityReason).toBe("has_payment_history");

    // Attempting reset returns 409
    const rejectReset = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect/reset`, {
        body: JSON.stringify({
          confirm: true,
          expectedAccountId: accountId,
          reason: "Organization wants to switch accounts",
        }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(rejectReset.status).toBe(409);
    const rejectBody = problemDetailsSchema.parse(await rejectReset.json());
    expect(rejectBody.code).toBe("stripe_connect_reset_has_payment_history");
  });

  it("blocks reset when real pending checkout exists", async () => {
    const { orgId, stub } = await seedTestOrganization();
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();

    const accountId = "acct_testpending123";
    await seedConnectedStripe(stub, orgId, accountId);

    // Insert pending payment attempt with real provider session
    const now = new Date().toISOString();
    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, amount_cents, status,
           provider_session_id, created_at, updated_at)
         VALUES ('pa_pending1', 'ticket', 'tp_pending1', 'cr_pending1', 3000, 'pending',
                 'cs_live_real_pending', ?, ?)`,
        now,
        now,
      );
      return null;
    });

    const pendingGet = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect`, {
        headers: { cookie: sessionCookie },
      }),
    );
    const pendingStatus = platformStripeConnectStatusResponseSchema.parse(await pendingGet.json());
    expect(pendingStatus.eligibleForReset).toBe(false);
    expect(pendingStatus.hasPendingPayments).toBe(true);
    expect(pendingStatus.ineligibilityReason).toBe("has_pending_payments");

    const rejectReset = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect/reset`, {
        body: JSON.stringify({
          confirm: true,
          expectedAccountId: accountId,
          reason: "Attempt reset during checkout",
        }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(rejectReset.status).toBe(409);
    const rejectBody = problemDetailsSchema.parse(await rejectReset.json());
    expect(rejectBody.code).toBe("stripe_connect_reset_has_pending_payments");
  });

  it("rejects reset when expectedAccountId does not match current connected account", async () => {
    const { orgId, stub } = await seedTestOrganization();
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();

    const accountId = "acct_testconnect123";
    await seedConnectedStripe(stub, orgId, accountId);

    const mismatchReset = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect/reset`, {
        body: JSON.stringify({
          confirm: true,
          expectedAccountId: "acct_different456",
          reason: "Stale confirmation dialog",
        }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(mismatchReset.status).toBe(409);
    const mismatchBody = problemDetailsSchema.parse(await mismatchReset.json());
    expect(mismatchBody.code).toBe("stripe_connect_account_changed");
  });

  it("successfully resets Stripe Connect account, disables activations, cleans up routing, and logs audit events", async () => {
    const { orgId, stub } = await seedTestOrganization();
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();

    const accountId = "acct_testconnecttoreset";
    await seedConnectedStripe(stub, orgId, accountId, {
      donations: true,
      dues: true,
      tickets: true,
    });

    // Verify routing table has entry before reset
    const routingBefore = await resolveOrganizationForStripeAccount(testEnv.CONTROL_DB, accountId);
    expect(routingBefore?.organizationId).toBe(orgId);

    // Perform reset
    const resetResponse = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect/reset`, {
        body: JSON.stringify({
          confirm: true,
          expectedAccountId: accountId,
          reason: "Choir leadership connected wrong bank Stripe account during setup",
        }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(resetResponse.status).toBe(200);
    const resetBody = platformStripeConnectResetResponseSchema.parse(await resetResponse.json());
    expect(resetBody).toMatchObject({
      accountId: null,
      activations: { donations: false, dues: false, tickets: false },
      organizationId: orgId,
      status: "not_started",
    });

    // 1. Verify routing table entry in CONTROL_DB was deleted
    const routingAfter = await resolveOrganizationForStripeAccount(testEnv.CONTROL_DB, accountId);
    expect(routingAfter).toBeNull();

    // 2. Verify platform audit events were recorded in CONTROL_DB
    const auditRequested = await testEnv.CONTROL_DB.prepare(
      `SELECT * FROM platform_audit_events
       WHERE organization_id = ? AND action = 'platform.stripe_connect.reset_requested'`,
    )
      .bind(orgId)
      .first<{ action: string; target_id: string }>();
    expect(auditRequested?.target_id).toBe(accountId);

    const auditCompleted = await testEnv.CONTROL_DB.prepare(
      `SELECT * FROM platform_audit_events
       WHERE organization_id = ? AND action = 'platform.stripe_connect.reset_completed'`,
    )
      .bind(orgId)
      .first<{ action: string; target_id: string }>();
    expect(auditCompleted?.target_id).toBe(accountId);

    // 3. Verify DO storage state: stripe_connect_accounts deleted, activations false, audit recorded
    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      const connectRows = state.storage.sql
        .exec("SELECT * FROM stripe_connect_accounts WHERE organization_id = ?", orgId)
        .toArray();
      expect(connectRows).toHaveLength(0);

      const metadataRows = state.storage.sql
        .exec<{ readonly payment_activation_json: string }>(
          "SELECT payment_activation_json FROM organization_metadata WHERE organization_id = ?",
          orgId,
        )
        .toArray();
      expect(metadataRows).toHaveLength(1);
      const activationsJson = metadataRows[0]?.payment_activation_json ?? "{}";
      const parsedActivations = paymentActivationSettingsSchema.parse(JSON.parse(activationsJson));
      expect(parsedActivations).toEqual({ donations: false, dues: false, tickets: false });

      const doAuditRows = state.storage.sql
        .exec<{ readonly action: string; readonly change_summary: string }>(
          "SELECT * FROM audit_events WHERE action = 'stripe_connect.reset' AND target_id = ?",
          accountId,
        )
        .toArray();
      expect(doAuditRows).toHaveLength(1);
      expect(doAuditRows[0]?.change_summary).toContain("wrong bank");

      return null;
    });

    // 4. Verify GET status endpoint now reflects disconnected state
    const afterResetGet = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-connect`, {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(afterResetGet.status).toBe(200);
    const afterResetStatus = platformStripeConnectStatusResponseSchema.parse(
      await afterResetGet.json(),
    );
    expect(afterResetStatus.accountId).toBeNull();
    expect(afterResetStatus.eligibleForReset).toBe(false);
    expect(afterResetStatus.status).toBe("not_started");
  });
});
