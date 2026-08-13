import { env, exports } from "cloudflare:workers";
import { publicAuditionInquiryResponseSchema } from "@choir/contracts";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import { issueSignedLink } from "../src/security/signedLinks";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { auditionSystemCommunicationTemplateIds } from "../src/organization/schema";
import { deleteAuditionInStore, updateAuditionInStore } from "../src/organization/auditionStore";

const ALPHA_ORG = "organization-alpha";
const BRAVO_ORG = "organization-bravo";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const signedLinkSecret = requireBinding(env.SIGNED_LINK_SECRET, "SIGNED_LINK_SECRET");

function api(host: string, path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function provision(id: string, slug: string): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 26, ?, ?, ?)`,
      )
      .bind(id, `Organization ${slug}`, slug, id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, id, `${slug}.localhost`, now, now),
  ]);
  const stub = stores.get(stores.idFromName(id));
  const response = await stub.fetch("https://organization.internal/internal/provision", {
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

async function createAuditionInOrg(id: string, name: string, email: string): Promise<string> {
  return runInDurableObject<OrganizationStore, string>(
    stores.get(stores.idFromName(id)),
    (_instance, state) => {
      const now = new Date().toISOString();
      const auditionId = crypto.randomUUID();
      state.storage.sql.exec(
        `INSERT INTO auditions (id, name, email, phone, voice_part, experience, availability_notes, status, created_at, updated_at)
         VALUES (?, ?, ?, '', '', '', '', 'pending', ?, ?)`,
        auditionId,
        name,
        email,
        now,
        now,
      );
      return auditionId;
    },
  );
}

async function issueAuditionToken(organizationId: string, auditionId: string): Promise<string> {
  return issueSignedLink(signedLinkSecret, {
    algorithm: "HS256",
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    issuedAt: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "audition",
    resourceId: auditionId,
    subjectId: auditionId,
    version: 1,
  });
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  await provision(ALPHA_ORG, "alpha");
  await provision(BRAVO_ORG, "bravo");
});

afterEach(async () => {
  await reset();
});

describe("public audition signed flow", () => {
  it("rejects inquiries when auditions are disabled or a slot is not configured", async () => {
    const settings = {
      adminNotifyEnabled: false,
      adminNotifyUsers: [],
      confirmationMessage: "Closed",
      defaultPerformanceId: null,
      enabled: false,
      slots: [],
    };
    const disabledSettings = JSON.stringify(settings);
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName(ALPHA_ORG)),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE organization_metadata SET audition_settings_json = ?",
          disabledSettings,
        );
        return null;
      },
    );
    const disabled = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-inquiry", {
        body: JSON.stringify({ email: "closed@example.com", name: "Closed Singer" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(disabled.status).toBe(409);

    const openSettings = JSON.stringify({ ...settings, enabled: true });
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName(ALPHA_ORG)),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE organization_metadata SET audition_settings_json = ?",
          openSettings,
        );
        return null;
      },
    );
    const invalidSlot = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-inquiry", {
        body: JSON.stringify({
          email: "invalid-slot@example.com",
          name: "Invalid Slot",
          requestedSlots: ["2026-08-01T14:00:00.000Z"],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(invalidSlot.status).toBe(400);
  });

  it("submits an inquiry and returns an ID", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-inquiry", {
        body: JSON.stringify({
          email: "singer@example.com",
          experience: "10 years in choir",
          name: "Test Singer",
          phone: "555-0100",
          voicePart: "Tenor",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ id: expect.any(String) });
  });

  it("rate-limits repeated public inquiries before creating the fourth record", async () => {
    const request = () =>
      exports.default.fetch(
        api("alpha.localhost", "/api/public/audition-inquiry", {
          body: JSON.stringify({ email: "limited@example.com", name: "Limited Singer" }),
          headers: {
            "cf-connecting-ip": "192.0.2.10",
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );
    await expect(request()).resolves.toMatchObject({ status: 201 });
    await expect(request()).resolves.toMatchObject({ status: 201 });
    await expect(request()).resolves.toMatchObject({ status: 201 });
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    const body: unknown = await limited.json();
    expect(body).toMatchObject({ code: "public_rate_limit_exceeded" });
    const auditionCount = await runInDurableObject<OrganizationStore, number>(
      stores.get(stores.idFromName(ALPHA_ORG)),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM auditions WHERE email = ?",
            "limited@example.com",
          )
          .toArray()
          .at(0)?.count ?? 0,
    );
    expect(auditionCount).toBe(3);
  });

  it("queues a confirmation notification inside the same Organization", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-inquiry", {
        body: JSON.stringify({
          email: "queued@example.com",
          name: "Queued Singer",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    const counts = await runInDurableObject<
      OrganizationStore,
      { notifications: number; jobs: number }
    >(stores.get(stores.idFromName(ALPHA_ORG)), (_instance, state) => ({
      jobs:
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE kind = 'audition_notification'",
          )
          .toArray()
          .at(0)?.count ?? 0,
      notifications:
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM audition_notifications WHERE destination = 'queued@example.com'",
          )
          .toArray()
          .at(0)?.count ?? 0,
    }));
    expect(counts).toEqual({ jobs: 1, notifications: 1 });
  });

  it("does not resolve an audition notification after its source is deleted", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-inquiry", {
        body: JSON.stringify({
          email: "deleted-source@example.test",
          name: "Deleted Source Singer",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    const auditionId = publicAuditionInquiryResponseSchema.parse(await response.json()).id;
    const stub = stores.get(stores.idFromName(ALPHA_ORG));
    const notificationJob = await runInDurableObject<
      OrganizationStore,
      { readonly jobId: string } | null
    >(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{
            readonly jobId: string;
          }>(
            `SELECT o.job_id AS jobId
           FROM audition_notifications n
           JOIN scheduled_job_outbox o
             ON o.idempotency_key = 'audition-notification:' || n.id
           WHERE n.audition_id = ? LIMIT 1`,
            auditionId,
          )
          .toArray()
          .at(0) ?? null,
    );
    if (!notificationJob) throw new Error("The audition notification fixture was not queued.");

    const deleteStatus = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        deleteAuditionInStore(state.storage, auditionId, {
          actorUserId: "integration-test",
          requestId: crypto.randomUUID(),
        }).status,
    );
    expect(deleteStatus).toBe(200);

    const deliveryResolution = await stub.fetch(
      `https://organization.internal/internal/audition/notification-job?organizationId=${encodeURIComponent(ALPHA_ORG)}&jobId=${encodeURIComponent(notificationJob.jobId)}`,
    );
    expect(deliveryResolution.status).toBe(404);
  });

  it("renders the Organization's edited audition submission template", async () => {
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName(ALPHA_ORG)),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE communication_templates
           SET subject = ?, content_markdown = ?
           WHERE id = ?`,
          "Custom audition thanks",
          "Hello {singerName},\n\nYour custom audition acknowledgement.",
          auditionSystemCommunicationTemplateIds.submission,
        );
        return null;
      },
    );
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-inquiry", {
        body: JSON.stringify({ email: "templated@example.com", name: "Template Singer" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    const notification = await runInDurableObject<
      OrganizationStore,
      { readonly contentMarkdown: string; readonly kind: string; readonly subject: string } | null
    >(
      stores.get(stores.idFromName(ALPHA_ORG)),
      (_instance, state) =>
        state.storage.sql
          .exec<{
            readonly contentMarkdown: string;
            readonly kind: string;
            readonly subject: string;
          }>(
            `SELECT kind, subject, content_markdown AS contentMarkdown
           FROM audition_notifications WHERE destination = ? LIMIT 1`,
            "templated@example.com",
          )
          .toArray()
          .at(0) ?? null,
    );
    expect(notification).toEqual({
      contentMarkdown: "Hello Template Singer,\n\nYour custom audition acknowledgement.",
      kind: "inquiry_confirmation",
      subject: "Custom audition thanks",
    });
  });

  it("queues editable confirmation and 24-hour reminder templates when scheduled", async () => {
    const auditionId = await createAuditionInOrg(
      ALPHA_ORG,
      "Scheduled Template Singer",
      "scheduled-templated@example.com",
    );
    const scheduledTimeSlot = new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName(ALPHA_ORG)),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE communication_templates
           SET subject = ?, content_markdown = ?
           WHERE id = ?`,
          "Confirmed for {auditionDate}",
          "Confirmed: {singerName} at {auditionTime} in {auditionLocation}.",
          auditionSystemCommunicationTemplateIds.confirmation,
        );
        state.storage.sql.exec(
          `UPDATE communication_templates
           SET subject = ?, content_markdown = ?
           WHERE id = ?`,
          "Reminder for {auditionDate}",
          "Reminder: {singerName} at {auditionTime} in {auditionLocation}.",
          auditionSystemCommunicationTemplateIds.reminder,
        );
        updateAuditionInStore(state.storage, auditionId, {
          scheduledTimeSlot,
          status: "scheduled",
        });
        return null;
      },
    );
    const notifications = await runInDurableObject<
      OrganizationStore,
      readonly {
        readonly contentMarkdown: string;
        readonly kind: string;
        readonly scheduledFor: string;
        readonly subject: string;
      }[]
    >(stores.get(stores.idFromName(ALPHA_ORG)), (_instance, state) =>
      state.storage.sql
        .exec<{
          readonly contentMarkdown: string;
          readonly kind: string;
          readonly scheduledFor: string;
          readonly subject: string;
        }>(
          `SELECT kind, subject, content_markdown AS contentMarkdown,
                  scheduled_for AS scheduledFor
           FROM audition_notifications WHERE audition_id = ? ORDER BY kind`,
          auditionId,
        )
        .toArray(),
    );
    const confirmation = notifications.find(({ kind }) => kind === "scheduled_confirmation");
    const reminder = notifications.find(({ kind }) => kind === "audition_reminder");
    expect(confirmation).toMatchObject({
      contentMarkdown: expect.stringContaining("Scheduled Template Singer"),
      subject: expect.stringContaining("Confirmed for"),
    });
    expect(reminder).toMatchObject({
      contentMarkdown: expect.stringContaining("Scheduled Template Singer"),
      subject: expect.stringContaining("Reminder for"),
    });
    expect(reminder?.scheduledFor).toBe(
      new Date(Date.parse(scheduledTimeSlot) - 24 * 60 * 60 * 1_000).toISOString(),
    );
  });

  it("rejects inquiry without a name", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-inquiry", {
        body: JSON.stringify({ email: "singer@example.com", name: "" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects inquiry without an email", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-inquiry", {
        body: JSON.stringify({ name: "Test Singer" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("resolves audition details for a valid token", async () => {
    const auditionId = await createAuditionInOrg(ALPHA_ORG, "Test Singer", "singer@example.com");
    const token = await issueAuditionToken(ALPHA_ORG, auditionId);
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      id: auditionId,
      name: "Test Singer",
      status: "pending",
    });
    expect(body).not.toHaveProperty("adminNotes");
    expect(body).not.toHaveProperty("email");
  });

  it("rejects a token used on the wrong hostname", async () => {
    const auditionId = await createAuditionInOrg(ALPHA_ORG, "Test Singer", "singer@example.com");
    const token = await issueAuditionToken(ALPHA_ORG, auditionId);
    const response = await exports.default.fetch(
      api("bravo.localhost", "/api/public/audition-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a completely bogus token", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-details", {
        body: JSON.stringify({ token: "bogus-token-value" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects an expired token", async () => {
    const auditionId = await createAuditionInOrg(ALPHA_ORG, "Test Singer", "singer@example.com");
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) - 60,
      issuedAt: Math.floor(Date.now() / 1000) - 120,
      nonce: crypto.randomUUID(),
      organizationId: ALPHA_ORG,
      purpose: "audition",
      resourceId: auditionId,
      subjectId: auditionId,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a token for a non-existent audition", async () => {
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId: ALPHA_ORG,
      purpose: "audition",
      resourceId: "00000000-0000-0000-0000-000000000000",
      subjectId: "00000000-0000-0000-0000-000000000000",
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("submits a candidate update and persists it", async () => {
    const auditionId = await createAuditionInOrg(ALPHA_ORG, "Test Singer", "singer@example.com");
    const token = await issueAuditionToken(ALPHA_ORG, auditionId);

    const submitResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-submit", {
        body: JSON.stringify({
          availabilityNotes: "Available weekends",
          token,
          voicePart: "Soprano",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(submitResponse.status).toBe(200);
    const submitBody: unknown = await submitResponse.json();
    expect(submitBody).toMatchObject({
      availabilityNotes: "Available weekends",
      id: auditionId,
      voicePart: "Soprano",
    });
    expect(submitBody).not.toHaveProperty("adminNotes");
    expect(submitBody).not.toHaveProperty("email");

    const row = await runInDurableObject<
      OrganizationStore,
      { voicePart: string; availabilityNotes: string } | null
    >(
      stores.get(stores.idFromName(ALPHA_ORG)),
      (_instance, state) =>
        state.storage.sql
          .exec<{ voicePart: string; availabilityNotes: string }>(
            `SELECT voice_part AS voicePart, availability_notes AS availabilityNotes
             FROM auditions WHERE id = ?`,
            auditionId,
          )
          .toArray()
          .at(0) ?? null,
    );
    expect(row).toEqual({ availabilityNotes: "Available weekends", voicePart: "Soprano" });
  });

  it("rejects submit with invalid token", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-submit", {
        body: JSON.stringify({
          availabilityNotes: "",
          token: "bogus",
          voicePart: "Soprano",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("isolates audition tokens between organizations", async () => {
    const auditionId = await createAuditionInOrg(ALPHA_ORG, "Test Singer", "singer@example.com");
    const token = await issueAuditionToken(ALPHA_ORG, auditionId);

    const bravoResponse = await exports.default.fetch(
      api("bravo.localhost", "/api/public/audition-submit", {
        body: JSON.stringify({
          availabilityNotes: "Weekdays",
          token,
          voicePart: "Bass",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(bravoResponse.status).toBe(404);

    const row = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName(ALPHA_ORG)),
      (_instance, state) =>
        state.storage.sql
          .exec<{ voicePart: string }>(
            `SELECT voice_part AS voicePart FROM auditions WHERE id = ?`,
            auditionId,
          )
          .toArray()
          .at(0)?.voicePart ?? "missing",
    );
    expect(row).toBe("");
  });

  it("rejects a token used for the wrong purpose", async () => {
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId: ALPHA_ORG,
      purpose: "rsvp",
      resourceId: crypto.randomUUID(),
      subjectId: crypto.randomUUID(),
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });
});
