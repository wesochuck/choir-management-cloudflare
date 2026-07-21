import { env } from "cloudflare:workers";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";

interface OutboxState {
  readonly enqueuedAt: string | null;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly nextDueAt: string;
}

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

async function provisionScheduler(): Promise<DurableObjectStub<OrganizationStore>> {
  const objectId = organizationStore.idFromName("organization-scheduler");
  const stub = organizationStore.get(objectId);
  const response = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: "scheduler.localhost",
      canonicalStatus: "active",
      name: "Scheduler Organization",
      organizationId: "organization-scheduler",
      requestId: "77777777-7777-4777-8777-777777777777",
      slug: "scheduler",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return stub;
}

async function readOutbox(stub: DurableObjectStub<OrganizationStore>): Promise<OutboxState> {
  return runInDurableObject<OrganizationStore, OutboxState>(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<
        Record<string, SqlStorageValue> & {
          enqueuedAt: string | null;
          idempotencyKey: string;
          jobId: string;
        }
      >(
        `SELECT job_id AS jobId, idempotency_key AS idempotencyKey,
          enqueued_at AS enqueuedAt
         FROM scheduled_job_outbox LIMIT 1`,
      )
      .one();
    const scheduler = state.storage.sql
      .exec<Record<string, SqlStorageValue> & { nextDueAt: string }>(
        "SELECT next_due_at AS nextDueAt FROM scheduler_state WHERE singleton = 1",
      )
      .one();
    return { ...row, nextDueAt: scheduler.nextDueAt };
  });
}

afterEach(async () => {
  await reset();
});

describe("Organization scheduler", () => {
  it("creates one stable job and safely re-enqueues an uncertain outbox delivery", async () => {
    const stub = await provisionScheduler();
    const overdueAt = new Date(Date.now() - 1_000).toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
        overdueAt,
        overdueAt,
      );
      return state.storage.setAlarm(Date.now() + 60_000).then(() => undefined);
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const firstDelivery = await readOutbox(stub);
    expect(firstDelivery).toMatchObject({
      enqueuedAt: expect.any(String),
      idempotencyKey: `scheduler:organization-scheduler:stale_checkout_cleanup:${overdueAt}`,
      jobId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(new Date(firstDelivery.nextDueAt).getTime()).toBeGreaterThan(
      new Date(overdueAt).getTime(),
    );

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE scheduled_job_outbox SET enqueued_at = NULL");
      return state.storage.setAlarm(Date.now() + 60_000).then(() => undefined);
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const replayedDelivery = await readOutbox(stub);
    expect(replayedDelivery.jobId).toBe(firstDelivery.jobId);
    expect(replayedDelivery.idempotencyKey).toBe(firstDelivery.idempotencyKey);
    expect(replayedDelivery.enqueuedAt).toEqual(expect.any(String));

    await expect(
      runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<Record<string, SqlStorageValue> & { count: number }>(
              "SELECT COUNT(*) AS count FROM scheduled_job_outbox",
            )
            .one().count,
      ),
    ).resolves.toBe(1);
  });
});
