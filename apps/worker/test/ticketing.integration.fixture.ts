import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
  runInDurableObject,
} from "cloudflare:test";
import { expect, inject } from "vitest";

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

export const database = binding(env.CONTROL_DB, "CONTROL_DB");
export const stores = binding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
export const organizationFiles = binding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");

export const api = organizationRequest;

export async function jsonWrite(
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

const provision = (id: string, slug: string, role: "admin" | "member") =>
  provisionOrganization(database, stores, { id, role, slug, userId: "ticket-manager" });

export async function signIn(): Promise<string> {
  return signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );
}

export async function deliverQueuedTicketNotification(organizationId: string): Promise<void> {
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
  expect(await getQueueResult(batch, createExecutionContext())).toMatchObject({
    explicitAcks: [`ticket-${job.jobId}`],
  });
}

export async function setupTicketingIntegration(): Promise<void> {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "ticket-manager", USER_EMAIL, "Ticket Manager");
  await provision("organization-alpha", "alpha", "admin");
  await provision("organization-bravo", "bravo", "member");
  const nowIso = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES ('domain-alpha-public', 'organization-alpha', 'tickets.example.test',
        'custom_public', 'active', 1, ?, ?)`,
    )
    .bind(nowIso, nowIso)
    .run();
}

export async function teardownTicketingIntegration(): Promise<void> {
  await reset();
}
