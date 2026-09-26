import { calculatePaymentFinancialSummary, type FinancialOrderInput } from "@choir/domain";
import {
  platformStripeReconciliationApplyResponseSchema,
  platformStripeReconciliationPreviewResponseSchema,
} from "@choir/contracts";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as stripeConnect from "../src/payments/stripeConnect";
import { upsertStripeAccountOrganization } from "../src/payments/stripeRouting";
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

beforeEach(async () => {
  await setupAuthIntegration();
  Object.assign(testEnv, { STRIPE_SECRET_KEY: "sk_test_mock_secret_key" });
  vi.restoreAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await teardownAuthIntegration();
});

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
       VALUES (?, 'Test Org', 'test-org', 'active', '{"tickets":true,"donations":true,"dues":true}', ?, ?)`,
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
): Promise<void> {
  const now = new Date().toISOString();
  await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
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

async function grantPlatformElevation(
  orgId: string,
  sessionId: string,
  userId = "user-invited-member",
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  await testEnv.CONTROL_DB.prepare(
    `INSERT INTO platform_elevations
      (id, user_id, organization_id, request_id, expires_at, revoked_at, created_at, session_id)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      orgId,
      crypto.randomUUID(),
      expiresAt,
      now.toISOString(),
      sessionId,
    )
    .run();
}

describe("Platform Stripe Reconciliation", () => {
  it("enforces authentication, platform administrator authorization, and elevation", async () => {
    const { orgId, stub } = await seedTestOrganization();
    const accountId = "acct_auth_test";
    await seedConnectedStripe(stub, orgId, accountId);

    // 1. Unauthenticated preview
    const unauthPreview = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/preview`, {
        body: JSON.stringify({}),
        method: "POST",
      }),
    );
    expect([401, 403]).toContain(unauthPreview.status);

    // 2. Unauthenticated apply
    const unauthApply = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/apply`, {
        body: JSON.stringify({ confirm: true, reason: "Auth check" }),
        method: "POST",
      }),
    );
    expect([401, 403]).toContain(unauthApply.status);

    // 3. Authenticated as ordinary user (non-platform admin)
    await seedInvitedUser();
    const memberCookie = await signInInvitedUser();

    const memberPreview = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/preview`, {
        body: JSON.stringify({}),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(memberPreview.status).toBe(403);

    // 4. Authenticated as Platform Administrator WITHOUT elevation
    const sessionId = await grantPlatformAdministratorForCurrentSession();

    const adminPreview = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/preview`, {
        body: JSON.stringify({}),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(adminPreview.status).toBe(200);

    const adminApplyNoElevation = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/apply`, {
        body: JSON.stringify({ confirm: true, reason: "Elevation check" }),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(adminApplyNoElevation.status).toBe(403);
    const elevationError = (await adminApplyNoElevation.json()) as { code: string };
    expect(elevationError.code).toBe("platform_elevation_required");

    // 5. With elevation
    await grantPlatformElevation(orgId, sessionId);

    const adminApplyWithElevation = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/apply`, {
        body: JSON.stringify({ confirm: true, reason: "Applying reconciliation" }),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(adminApplyWithElevation.status).toBe(200);
  });

  it("dry-run preview does not mutate ticket status, fees, balance transactions, or timestamps", async () => {
    const { orgId, stub } = await seedTestOrganization();
    const accountId = "acct_dryrun_test";
    await seedConnectedStripe(stub, orgId, accountId);

    const now = new Date().toISOString();
    const ticketId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const eventId = crypto.randomUUID();

    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Spring Gala', 'Performance', ?, ?, ?)`,
        eventId,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           bundle_id, bundle_title, buyer_name, buyer_email, quantity, unit_price_cents,
           fee_cents, amount_paid_cents, currency, provider_session_id,
           provider_payment_id, status, marketing_opt_in, created_at, updated_at)
         VALUES (?, ?, ?, 'Spring Gala', ?, 'America/New_York', NULL, '',
                 'Alice Test', 'alice@test.com', 2, 2500, 0, 5000, 'usd',
                 'cs_dryrun_1', 'pi_dryrun_1', 'paid', 0, ?, ?)`,
        ticketId,
        crypto.randomUUID(),
        eventId,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id, provider_payment_id,
           status, amount_cents, created_at, updated_at)
         VALUES (?, 'ticket', ?, 'req_dryrun_1', 'cs_dryrun_1', 'pi_dryrun_1', 'paid', 5000, ?, ?)`,
        attemptId,
        ticketId,
        now,
        now,
      );
      return null;
    });

    vi.spyOn(stripeConnect, "retrieveStripePaymentReconciliationSnapshot").mockResolvedValueOnce({
      amountChargedCents: 5000,
      amountRefundedCents: 5000,
      chargeId: "ch_dryrun_1",
      currency: "usd",
      fullyRefunded: true,
      processorFeeCents: 175,
      providerBalanceTransactionId: "txn_dryrun_1",
      providerPaymentId: "pi_dryrun_1",
      refundCompletedAt: "2026-02-15T12:00:00.000Z",
    });

    await seedInvitedUser();
    const memberCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();

    const previewRes = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/preview`, {
        body: JSON.stringify({}),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(previewRes.status).toBe(200);
    const previewData = platformStripeReconciliationPreviewResponseSchema.parse(
      await previewRes.json(),
    );
    expect(previewData.scannedCount).toBe(1);
    expect(previewData.repairableCount).toBe(1);
    expect(previewData.rows[0]?.classification).toBe("refund_and_fee_mismatch");

    // Assert that NO mutations occurred in the Durable Object
    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      const ticket = state.storage.sql
        .exec<{ status: string; refunded_at: string | null }>(
          "SELECT status, refunded_at FROM ticket_purchases WHERE id = ?",
          ticketId,
        )
        .toArray()[0];
      expect(ticket?.status).toBe("paid");
      expect(ticket?.refunded_at).toBeNull();

      const attempt = state.storage.sql
        .exec<{
          processor_fee_cents: number | null;
          providerBalanceTransactionId: string | null;
          status: string;
        }>(
          "SELECT status, processor_fee_cents, provider_balance_transaction_id AS providerBalanceTransactionId FROM payment_attempts WHERE id = ?",
          attemptId,
        )
        .toArray()[0];
      expect(attempt?.status).toBe("paid");
      expect(attempt?.processor_fee_cents).toBeNull();
      expect(attempt?.providerBalanceTransactionId).toBeNull();

      const audits = state.storage.sql
        .exec<{ id: string }>(
          "SELECT id FROM audit_events WHERE action = 'payment.stripe_history.reconciled'",
        )
        .toArray();
      expect(audits).toHaveLength(0);

      return null;
    });
  });

  it("applies historical full refund on ticket purchase, preserves gross charged, backfills fees, without queuing refund email", async () => {
    const { orgId, stub } = await seedTestOrganization();
    const accountId = "acct_apply_ticket";
    await seedConnectedStripe(stub, orgId, accountId);

    const now = new Date().toISOString();
    const ticketId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const eventId = crypto.randomUUID();

    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Fall Concert', 'Performance', ?, ?, ?)`,
        eventId,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           bundle_id, bundle_title, buyer_name, buyer_email, quantity, unit_price_cents,
           fee_cents, amount_paid_cents, currency, provider_session_id,
           provider_payment_id, status, marketing_opt_in, created_at, updated_at)
         VALUES (?, ?, ?, 'Fall Concert', ?, 'America/New_York', NULL, '',
                 'Bob Buyer', 'bob@test.com', 2, 2500, 0, 5000, 'usd',
                 'cs_ticket_1', 'pi_ticket_1', 'paid', 0, ?, ?)`,
        ticketId,
        crypto.randomUUID(),
        eventId,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id, provider_payment_id,
           status, amount_cents, created_at, updated_at)
         VALUES (?, 'ticket', ?, 'req_ticket_1', 'cs_ticket_1', 'pi_ticket_1', 'paid', 5000, ?, ?)`,
        attemptId,
        ticketId,
        now,
        now,
      );
      return null;
    });

    const refundIso = "2026-02-20T14:30:00.000Z";
    vi.spyOn(stripeConnect, "retrieveStripePaymentReconciliationSnapshot").mockResolvedValue({
      amountChargedCents: 5000,
      amountRefundedCents: 5000,
      chargeId: "ch_ticket_1",
      currency: "usd",
      fullyRefunded: true,
      processorFeeCents: 175,
      providerBalanceTransactionId: "txn_ticket_1",
      providerPaymentId: "pi_ticket_1",
      refundCompletedAt: refundIso,
    });

    await seedInvitedUser();
    const memberCookie = await signInInvitedUser();
    const sessionId = await grantPlatformAdministratorForCurrentSession();
    await grantPlatformElevation(orgId, sessionId);

    // Apply reconciliation
    const applyRes = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/apply`, {
        body: JSON.stringify({
          confirm: true,
          providerPaymentIds: ["pi_ticket_1"],
          reason: "Repair historical refund and fee",
        }),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(applyRes.status).toBe(200);
    const applyData = platformStripeReconciliationApplyResponseSchema.parse(await applyRes.json());
    expect(applyData.appliedCount).toBe(1);
    expect(applyData.refundedCount).toBe(1);
    expect(applyData.feeBackfilledCount).toBe(1);
    expect(applyData.results[0]?.status).toBe("applied");

    // Verify mutations inside Durable Object
    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      const ticket = state.storage.sql
        .exec<{
          amount_paid_cents: number;
          refunded_at: string | null;
          status: string;
        }>(
          "SELECT status, amount_paid_cents, refunded_at FROM ticket_purchases WHERE id = ?",
          ticketId,
        )
        .toArray()[0];
      expect(ticket?.status).toBe("refunded");
      expect(ticket?.amount_paid_cents).toBe(5000); // Preserved original amount!
      expect(ticket?.refunded_at).toBe(refundIso);

      const attempt = state.storage.sql
        .exec<{
          amount_cents: number;
          processor_fee_cents: number | null;
          provider_balance_transaction_id: string | null;
          refunded_at: string | null;
          status: string;
        }>(
          "SELECT status, amount_cents, processor_fee_cents, provider_balance_transaction_id, refunded_at FROM payment_attempts WHERE id = ?",
          attemptId,
        )
        .toArray()[0];
      expect(attempt?.status).toBe("refunded");
      expect(attempt?.amount_cents).toBe(5000);
      expect(attempt?.processor_fee_cents).toBe(175);
      expect(attempt?.provider_balance_transaction_id).toBe("txn_ticket_1");
      expect(attempt?.refunded_at).toBe(refundIso);

      // Verify audit event
      const audits = state.storage.sql
        .exec<{ change_summary: string; id: string }>(
          "SELECT id, change_summary FROM audit_events WHERE action = 'payment.stripe_history.reconciled'",
        )
        .toArray();
      expect(audits).toHaveLength(1);
      expect(audits[0]?.id).toBe(
        "stripe-history-reconciled:pi_ticket_1:backfill_fee+mark_refunded",
      );
      const summary = JSON.parse(audits[0]!.change_summary) as {
        newResourceStatus: string;
        previousResourceStatus: string;
        source: string;
      };
      expect(summary.source).toBe("stripe_historical_reconciliation");
      expect(summary.previousResourceStatus).toBe("paid");
      expect(summary.newResourceStatus).toBe("refunded");

      // Verify NO customer refund email queued
      const queuedJobs = state.storage.sql
        .exec<{ idempotency_key: string }>("SELECT idempotency_key FROM scheduled_job_outbox")
        .toArray();
      expect(queuedJobs).toHaveLength(0);

      return null;
    });

    // Idempotency test: apply again!
    const applyAgainRes = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/apply`, {
        body: JSON.stringify({
          confirm: true,
          providerPaymentIds: ["pi_ticket_1"],
          reason: "Second apply run",
        }),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(applyAgainRes.status).toBe(200);
    const applyAgainData = platformStripeReconciliationApplyResponseSchema.parse(
      await applyAgainRes.json(),
    );
    expect(applyAgainData.appliedCount).toBe(0);
    expect(applyAgainData.skippedCount).toBe(1);

    // Verify rerun preview reports as matched
    const rerunPreviewRes = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/preview`, {
        body: JSON.stringify({}),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(rerunPreviewRes.status).toBe(200);
    const rerunPreviewData = platformStripeReconciliationPreviewResponseSchema.parse(
      await rerunPreviewRes.json(),
    );
    expect(rerunPreviewData.matchedCount).toBe(1);
    expect(rerunPreviewData.repairableCount).toBe(0);
    expect(rerunPreviewData.rows[0]?.classification).toBe("matched");
  });

  it("applies historical full refund on bundle purchase correctly", async () => {
    const { orgId, stub } = await seedTestOrganization();
    const accountId = "acct_apply_bundle";
    await seedConnectedStripe(stub, orgId, accountId);

    const now = new Date().toISOString();
    const bundlePurchaseId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const bundleId = crypto.randomUUID();

    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      state.storage.sql.exec(
        `INSERT INTO ticket_bundles
          (id, title, price_cents, sale_end_at, is_active, created_at, updated_at)
         VALUES (?, 'Season Pass', 10000, ?, 1, ?, ?)`,
        bundleId,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           bundle_id, bundle_title, buyer_name, buyer_email, quantity, unit_price_cents,
           fee_cents, amount_paid_cents, currency, provider_session_id,
           provider_payment_id, status, marketing_opt_in, created_at, updated_at)
         VALUES (?, ?, '', '', '', 'America/New_York', ?, 'Season Pass',
                 'Charlie', 'charlie@test.com', 1, 10000, 0, 10000, 'usd',
                 'cs_bundle_1', 'pi_bundle_1', 'paid', 0, ?, ?)`,
        bundlePurchaseId,
        crypto.randomUUID(),
        bundleId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id, provider_payment_id,
           status, amount_cents, created_at, updated_at)
         VALUES (?, 'bundle', ?, 'req_bundle_1', 'cs_bundle_1', 'pi_bundle_1', 'paid', 10000, ?, ?)`,
        attemptId,
        bundlePurchaseId,
        now,
        now,
      );
      return null;
    });

    vi.spyOn(stripeConnect, "retrieveStripePaymentReconciliationSnapshot").mockResolvedValue({
      amountChargedCents: 10000,
      amountRefundedCents: 10000,
      chargeId: "ch_bundle_1",
      currency: "usd",
      fullyRefunded: true,
      processorFeeCents: 320,
      providerBalanceTransactionId: "txn_bundle_1",
      providerPaymentId: "pi_bundle_1",
      refundCompletedAt: "2026-03-01T10:00:00.000Z",
    });

    await seedInvitedUser();
    const memberCookie = await signInInvitedUser();
    const sessionId = await grantPlatformAdministratorForCurrentSession();
    await grantPlatformElevation(orgId, sessionId);

    const applyRes = await fetchWorker(
      authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/apply`, {
        body: JSON.stringify({
          confirm: true,
          providerPaymentIds: ["pi_bundle_1"],
          reason: "Bundle refund repair",
        }),
        headers: { cookie: memberCookie },
        method: "POST",
      }),
    );
    expect(applyRes.status).toBe(200);

    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      const purchase = state.storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM ticket_purchases WHERE id = ?",
          bundlePurchaseId,
        )
        .toArray()[0];
      expect(purchase?.status).toBe("refunded");

      const attempt = state.storage.sql
        .exec<{ processor_fee_cents: number; status: string }>(
          "SELECT status, processor_fee_cents FROM payment_attempts WHERE id = ?",
          attemptId,
        )
        .toArray()[0];
      expect(attempt?.status).toBe("refunded");
      expect(attempt?.processor_fee_cents).toBe(320);

      return null;
    });
  });

  it("apply is idempotent: a second run skips repaired rows without duplicating audit history", async () => {
    const { orgId, stub } = await seedTestOrganization();
    const accountId = "acct_idempotent_test";
    await seedConnectedStripe(stub, orgId, accountId);

    const now = new Date().toISOString();
    const ticketId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const eventId = crypto.randomUUID();

    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Winter Concert', 'Performance', ?, ?, ?)`,
        eventId,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           bundle_id, bundle_title, buyer_name, buyer_email, quantity, unit_price_cents,
           fee_cents, amount_paid_cents, currency, provider_session_id,
           provider_payment_id, status, marketing_opt_in, created_at, updated_at)
         VALUES (?, ?, ?, 'Winter Concert', ?, 'America/New_York', NULL, '',
                 'Ida Test', 'ida@test.com', 1, 4000, 0, 4000, 'usd',
                 'cs_twice_1', 'pi_twice_1', 'paid', 0, ?, ?)`,
        ticketId,
        crypto.randomUUID(),
        eventId,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id, provider_payment_id,
           status, amount_cents, created_at, updated_at)
         VALUES (?, 'ticket', ?, 'req_twice_1', 'cs_twice_1', 'pi_twice_1', 'paid', 4000, ?, ?)`,
        attemptId,
        ticketId,
        now,
        now,
      );
      return null;
    });

    vi.spyOn(stripeConnect, "retrieveStripePaymentReconciliationSnapshot").mockResolvedValue({
      amountChargedCents: 4000,
      amountRefundedCents: 4000,
      chargeId: "ch_twice_1",
      currency: "usd",
      fullyRefunded: true,
      processorFeeCents: 120,
      providerBalanceTransactionId: "txn_twice_1",
      providerPaymentId: "pi_twice_1",
      refundCompletedAt: "2026-03-01T12:00:00.000Z",
    });

    await seedInvitedUser();
    const memberCookie = await signInInvitedUser();
    const sessionId = await grantPlatformAdministratorForCurrentSession();
    await grantPlatformElevation(orgId, sessionId);

    async function applyOnce() {
      const response = await fetchWorker(
        authRequest(`/api/platform/organizations/${orgId}/stripe-reconciliation/apply`, {
          body: JSON.stringify({
            confirm: true,
            providerPaymentIds: ["pi_twice_1"],
            reason: "Idempotency check",
          }),
          headers: { cookie: memberCookie },
          method: "POST",
        }),
      );
      expect(response.status).toBe(200);
      return platformStripeReconciliationApplyResponseSchema.parse(await response.json());
    }

    async function reconciliationAuditCount() {
      return runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
        const rows = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'payment.stripe_history.reconciled' AND target_id = ?",
            "pi_twice_1",
          )
          .toArray();
        return rows[0]?.count ?? 0;
      });
    }

    const first = await applyOnce();
    expect(first.appliedCount).toBe(1);
    expect(await reconciliationAuditCount()).toBe(1);

    const second = await applyOnce();
    expect(second.appliedCount).toBe(0);
    expect(second.results[0]?.status).toBe("skipped");
    expect(await reconciliationAuditCount()).toBe(1);

    await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) => {
      const ticket = state.storage.sql
        .exec<{ amount_paid_cents: number; status: string }>(
          "SELECT status, amount_paid_cents FROM ticket_purchases WHERE id = ?",
          ticketId,
        )
        .toArray()[0];
      expect(ticket?.status).toBe("refunded");
      expect(ticket?.amount_paid_cents).toBe(4000);

      const attempt = state.storage.sql
        .exec<{ processor_fee_cents: number; status: string }>(
          "SELECT status, processor_fee_cents FROM payment_attempts WHERE id = ?",
          attemptId,
        )
        .toArray()[0];
      expect(attempt?.status).toBe("refunded");
      expect(attempt?.processor_fee_cents).toBe(120);
      return null;
    });
  });

  it("KPI regression: reproduces the accounting problem and verifies financial summary post-reconciliation", () => {
    // Ticket A: $50 paid locally, but fully refunded in Stripe ($1.75 fee)
    // Ticket B: $75 paid locally and retained ($2.48 fee)
    const beforeReconciliationOrders: FinancialOrderInput[] = [
      {
        amountPaidCents: 5000,
        checkoutMode: "stripe",
        processorFeeCents: null,
        status: "paid",
      },
      {
        amountPaidCents: 7500,
        checkoutMode: "stripe",
        processorFeeCents: null,
        status: "paid",
      },
    ];

    const beforeSummary = calculatePaymentFinancialSummary(beforeReconciliationOrders);
    // Before reconciliation: Gross is $125, Refunds is $0
    expect(beforeSummary.grossChargedCents).toBe(12500);
    expect(beforeSummary.refundCents).toBe(0);

    // After reconciliation:
    // Ticket A is refunded, Ticket B is paid, fees are reconciled
    const afterReconciliationOrders: FinancialOrderInput[] = [
      {
        amountPaidCents: 5000, // Original $50 charge is preserved in gross!
        checkoutMode: "stripe",
        processorFeeCents: 175,
        status: "refunded",
      },
      {
        amountPaidCents: 7500,
        checkoutMode: "stripe",
        processorFeeCents: 248,
        status: "paid",
      },
    ];

    const afterSummary = calculatePaymentFinancialSummary(afterReconciliationOrders);
    // After reconciliation:
    // Gross charged: $125
    // Refunds: -$50
    // Processor fees: $1.75 + $2.48 = $4.23 (423 cents)
    // Net proceeds: $125 - $50 - $4.23 = $70.77 (7077 cents)
    expect(afterSummary.grossChargedCents).toBe(12500);
    expect(afterSummary.refundCents).toBe(5000);
    expect(afterSummary.processorFeeCents).toBe(423);
    expect(afterSummary.netProceedsCents).toBe(7077);
  });
});
