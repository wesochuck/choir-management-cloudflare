import {
  communicationDeliverySummaryResponseSchema,
  communicationMessageResponseSchema,
  communicationReachResponseSchema,
  communicationRetryResponseSchema,
  communicationDeleteResponseSchema,
  communicationTemplateResponseSchema,
  communicationTemplatesResponseSchema,
  communicationUnsubscribeResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import { z } from "zod";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import { processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

function binding<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return value;
}

const database = binding(env.CONTROL_DB, "CONTROL_DB");
const stores = binding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const managerEmail = "communications.manager@example.test";

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function write(host: string, path: string, cookie: string, body: unknown) {
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

async function provision(id: string, slug: string, role: "admin" | "member") {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 18, ?, ?, ?)`,
      )
      .bind(id, `Organization ${slug}`, slug, id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, id, `${slug}.localhost`, now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, 'communications-manager', ?, ?)`,
      )
      .bind(`member-${slug}`, id, role, Date.now()),
  ]);
  const response = await stores
    .get(stores.idFromName(id))
    .fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: `${slug}.localhost`,
        canonicalStatus: "active",
        name: `Organization ${slug}`,
        organizationId: id,
        requestId: crypto.randomUUID(),
        slug,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  expect(response.status).toBe(200);
}

async function signIn() {
  await exports.default.fetch(
    api("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email: managerEmail, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const otp = readCapturedPlatformEmailsForTest()
    .find(({ recipient }) => recipient === managerEmail)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    api("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email: managerEmail, otp }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function createProfile(cookie: string, body: Record<string, unknown>) {
  const response = await write("alpha.localhost", "/api/organization/profiles", cookie, body);
  const parsed = z.object({ id: z.uuid() }).parse(await response.json());
  return parsed.id;
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('communications-manager', 'Communications Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(managerEmail, now, now)
    .run();
  await provision("organization-alpha", "alpha", "admin");
  await provision("organization-bravo", "bravo", "member");
});

afterEach(async () => reset());

describe("Organization communications", () => {
  it("saves drafts without queueing work and rejects invalid or unreachable sends", async () => {
    const cookie = await signIn();
    const audience = {
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      voiceParts: [],
    };
    const draftResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      { audience, channel: "SMS", contentMarkdown: "", subject: "" },
    );
    expect(draftResponse.status).toBe(201);
    const draft = communicationMessageResponseSchema.parse(await draftResponse.json());
    expect(draft.status).toBe("Draft");
    const outboxCount = await runInDurableObject<OrganizationStore, number>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { count: number }>(
            "SELECT COUNT(*) AS count FROM scheduled_job_outbox",
          )
          .one().count,
    );
    expect(outboxCount).toBe(0);
    const template = communicationTemplateResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/templates", cookie, {
          channel: "SMS",
          contentMarkdown: "Hello {singerName}",
          subject: "",
          title: "Welcome",
        })
      ).json(),
    );
    const templates = communicationTemplatesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/templates", cookie),
        )
      ).json(),
    );
    expect(templates.templates.map(({ title }) => title)).toEqual(["Welcome"]);
    expect(
      communicationDeleteResponseSchema.parse(
        await (
          await exports.default.fetch(
            api(
              "alpha.localhost",
              `/api/organization/communications/templates/${template.id}`,
              cookie,
              { method: "DELETE" },
            ),
          )
        ).json(),
      ).status,
    ).toBe("deleted");
    expect(
      communicationDeleteResponseSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/communications/drafts/${draft.id}`, cookie, {
              method: "DELETE",
            }),
          )
        ).json(),
      ).status,
    ).toBe("deleted");
    expect(
      (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "Email",
          contentMarkdown: "Missing subject",
          subject: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "SMS",
          contentMarkdown: "Nobody can receive this",
          subject: "",
        })
      ).status,
    ).toBe(409);
  });

  it("resolves reach, queues fake delivery, summarizes it, audits it, and isolates Organizations", async () => {
    const cookie = await signIn();
    const managerProfileId = await createProfile(cookie, {
      displayName: "Communications Manager",
      phone: "+1 555 100 0001",
      voicePart: "S1",
    });
    const optedOutProfileId = await createProfile(cookie, {
      displayName: "SMS Singer",
      doNotEmail: true,
      phone: "+1 555 100 0002",
      voicePart: "A1",
    });
    const now = Date.now();
    await database.batch([
      database
        .prepare("UPDATE member SET profileId = ? WHERE id = 'member-alpha'")
        .bind(managerProfileId),
      database
        .prepare(
          `INSERT INTO user
            (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
           VALUES ('communications-singer', 'SMS Singer', 'sms.singer@example.test', 1, ?, ?, 0)`,
        )
        .bind(now, now),
      database
        .prepare(
          `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
           VALUES ('member-singer', 'organization-alpha', 'communications-singer', 'member', ?, ?)`,
        )
        .bind(now, optedOutProfileId),
    ]);
    const audience = {
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      voiceParts: [],
    };
    const reach = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience,
          channel: "Both",
        })
      ).json(),
    );
    expect(reach).toMatchObject({ both: 1, email: 1, sms: 2, total: 2, unreachable: 0 });

    const sentResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience,
        channel: "Both",
        contentMarkdown: "Hello {singerName}",
        subject: "Rehearsal update",
      },
    );
    expect(sentResponse.status).toBe(202);
    const message = communicationMessageResponseSchema.parse(await sentResponse.json());
    expect(message).toMatchObject({ channel: "Both", status: "Queued" });
    const unsubscribeUrl = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { unsubscribeUrl: string }>(
            `SELECT unsubscribe_url AS unsubscribeUrl FROM communication_deliveries
             WHERE message_id = ? AND channel = 'email' LIMIT 1`,
            message.id,
          )
          .one().unsubscribeUrl,
    );
    const unsubscribeToken = new URL(unsubscribeUrl).searchParams.get("token");
    expect(unsubscribeToken).toBeTruthy();
    expect(
      (
        await write("bravo.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "SMS",
          contentMarkdown: "Forbidden",
          subject: "",
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await write("bravo.localhost", "/api/public/unsubscribe", cookie, {
          token: unsubscribeToken,
        })
      ).status,
    ).toBe(400);
    const unsubscribe = communicationUnsubscribeResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/public/unsubscribe", cookie, {
          token: unsubscribeToken,
        })
      ).json(),
    );
    expect(unsubscribe.success).toBe(true);
    const afterUnsubscribe = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience,
          channel: "Email",
        })
      ).json(),
    );
    expect(afterUnsubscribe).toMatchObject({ email: 0, total: 0, unreachable: 2 });

    const stub = stores.get(stores.idFromName("organization-alpha"));
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const job = await runInDurableObject<OrganizationStore, DeliveryJob>(
      stub,
      (_instance, state) => {
        const row = state.storage.sql
          .exec<
            Record<string, SqlStorageValue> & {
              idempotencyKey: string;
              jobId: string;
              kind: DeliveryJob["kind"];
            }
          >(
            `SELECT job_id AS jobId, idempotency_key AS idempotencyKey, kind
             FROM scheduled_job_outbox WHERE kind = 'communication_delivery' LIMIT 1`,
          )
          .one();
        return {
          attempt: 1,
          idempotencyKey: row.idempotencyKey,
          jobId: row.jobId,
          kind: row.kind,
          organizationId: "organization-alpha",
          version: 1,
        };
      },
    );
    const batch = createMessageBatch("choir-management-jobs-local", [
      { attempts: 1, body: job, id: "communication-job", timestamp: new Date() },
    ]);
    await processDeliveryBatch(batch, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_STORE: stores,
    });
    const queueResult = z
      .object({ explicitAcks: z.array(z.string()) })
      .parse(await getQueueResult(batch, createExecutionContext()));
    expect(queueResult.explicitAcks).toEqual(["communication-job"]);

    const summary = communicationDeliverySummaryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/${message.id}/delivery-summary`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(summary.state).toBe("sent");
    expect(summary.total).toMatchObject({ sent: 2, suppressed: 1, total: 3 });
    expect(summary.failures).toEqual([]);

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE communication_deliveries
         SET status = 'failed', failure_detail = 'provider rejected', updated_at = ?
         WHERE id = (SELECT id FROM communication_deliveries
                     WHERE message_id = ? AND status = 'sent' LIMIT 1)`,
        new Date().toISOString(),
        message.id,
      );
      return undefined;
    });
    const retry = communicationRetryResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/communications/${message.id}/retry-failed`,
          cookie,
          {},
        )
      ).json(),
    );
    expect(retry.retried).toBe(1);
    const retrySummary = communicationDeliverySummaryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/${message.id}/delivery-summary`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(retrySummary.state).toBe("sending");
    expect(retrySummary.total.queued).toBe(1);

    const actions = await runInDurableObject<OrganizationStore, string[]>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE action LIKE 'organization.communication.%'",
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(actions).toContain("organization.communication.queued");
    expect(actions).toContain("organization.communication.retry.queued");
    expect(actions).toContain("organization.communication.unsubscribed");
  });
});
