import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { reconciliationReportSchema } from "../src/organization/reconciliationStore";

function requireStores(): NonNullable<typeof env.ORGANIZATION_STORE> {
  if (!env.ORGANIZATION_STORE) throw new Error("The ORGANIZATION_STORE binding is missing.");
  return env.ORGANIZATION_STORE;
}

afterEach(async () => {
  await reset();
});

describe("Organization reconciliation report", () => {
  it("reports expired-paid tickets, inconsistent attempts, orphan exports, and terminal jobs", async () => {
    const organizationId = "reconciliation-report";
    const stores = requireStores();
    const stub = stores.get(stores.idFromName(organizationId));
    const provisionResponse = await stub.fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: "reconciliation.localhost",
        canonicalStatus: "active",
        name: "Reconciliation Organization",
        organizationId,
        requestId: "88888888-8888-4888-8888-888888888888",
        slug: "reconciliation",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(provisionResponse.status).toBe(200);

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at, fulfilled_at, expired_at, refunded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1000, 0, 1000, 'usd', ?, ?, 'paid', 0, ?, ?, ?, ?, NULL)`,
        "ticket-reconciliation",
        "99999999-9999-4999-8999-999999999999",
        "event-reconciliation",
        "Reconciliation Performance",
        now,
        "UTC",
        "Test Buyer",
        "buyer@example.test",
        "session-reconciliation",
        "payment-reconciliation",
        now,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES (?, 'ticket', ?, ?, ?, ?, 'pending', 1000, ?, ?)`,
        "attempt-reconciliation",
        "ticket-reconciliation",
        "99999999-9999-4999-8999-999999999998",
        "session-reconciliation",
        "payment-reconciliation",
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO organization_exports
          (id, format, status, actor_user_id, request_id, archive_key, error_code,
           created_at, updated_at)
         VALUES (?, 'json', 'failed', ?, ?, ?, '', ?, ?)`,
        "export-reconciliation",
        "bootstrap",
        "99999999-9999-4999-8999-999999999997",
        "organizations/reconciliation/exports/export-reconciliation.json",
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO job_ledger
          (idempotency_key, job_id, kind, status, attempt, claimed_at, failed_at, terminal_at,
           last_error_code)
         VALUES (?, ?, 'attendance_report', 'failed', 2, ?, ?, ?, 'queue_dead_lettered')`,
        "job-reconciliation",
        "job-reconciliation",
        now,
        now,
        now,
      );
    });

    const response = await stub.fetch(
      "https://organization.internal/internal/reconciliation-report?organizationId=reconciliation-report",
    );
    expect(response.status).toBe(200);
    const report = reconciliationReportSchema.parse(await response.json());
    expect(report.expiredPaidTickets).toHaveLength(1);
    expect(report.inconsistentPaymentAttempts).toHaveLength(1);
    expect(report.orphanedExportArchives).toHaveLength(1);
    expect(report.terminalJobs).toHaveLength(1);
  });
});
