import {
  organizationProfileSchema,
  organizationProfileResponseSchema,
  organizationProfileImportResponseSchema,
  organizationProfileDeliveriesResponseSchema,
  organizationProfilesResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "profile.manager@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function apiRequest(hostname: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${hostname}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${hostname}${path}`, { ...init, headers });
}

async function provision(
  organizationId: string,
  name: string,
  slug: string,
  role: "admin" | "member",
): Promise<void> {
  const now = new Date().toISOString();
  await controlDatabase.batch([
    controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 14, ?, ?, ?)`,
      )
      .bind(organizationId, name, slug, organizationId, now, now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, organizationId, `${slug}.localhost`, now, now),
    controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, 'profile-manager', ?, ?)`,
      )
      .bind(`member-${slug}`, organizationId, role, Date.now()),
  ]);
  const response = await organizationStore
    .get(organizationStore.idFromName(organizationId))
    .fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: `${slug}.localhost`,
        canonicalStatus: "active",
        name,
        organizationId,
        requestId: crypto.randomUUID(),
        slug,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  expect(response.status).toBe(200);
}

async function signIn(): Promise<string> {
  const send = await exports.default.fetch(
    apiRequest("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(send.status).toBe(200);
  const code = readCapturedPlatformEmailsForTest()
    .find((message) => message.kind === "email-one-time-code" && message.recipient === USER_EMAIL)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    apiRequest("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, otp: code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toContain("choir-management.session_token=");
  return cookie ?? "";
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await controlDatabase
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('profile-manager', 'Profile Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "Organization Alpha", "alpha", "admin");
  await provision("organization-bravo", "Organization Bravo", "bravo", "member");
});

afterEach(async () => {
  await reset();
});

describe("Organization Profiles", () => {
  it("rejects suppressed email recipients before Profile creation or CSV import", async () => {
    await controlDatabase
      .prepare(
        `INSERT INTO email_recipient_suppressions
          (email_normalized, reason, source_event_id, provider_message_id, detail, active, created_at, updated_at)
         VALUES (?, 'bounce', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        "suppressed@example.test",
        "event-profile-guard",
        "provider-profile-guard",
        "Mailbox unavailable",
        "2026-08-06T12:00:00.000Z",
        "2026-08-06T12:00:00.000Z",
      )
      .run();
    const cookie = await signIn();
    const createResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({
          displayName: "Suppressed Singer",
          email: "SUPPRESSED@example.test",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createResponse.status).toBe(409);
    expect(await createResponse.json()).toMatchObject({
      code: "email_recipient_suppressed",
      message: expect.stringContaining("Platform Administrator"),
    });

    const importResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/import", cookie, {
        body: "Name,Email\nSuppressed Import,suppressed@example.test",
        headers: { "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(importResponse.status).toBe(409);
    expect(
      await runInDurableObject<OrganizationStore, number>(
        organizationStore.get(organizationStore.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>("SELECT COUNT(*) AS count FROM profiles")
            .one().count,
      ),
    ).toBe(0);
  });

  it("imports Profiles atomically without creating login identities", async () => {
    const cookie = await signIn();
    const response = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/import", cookie, {
        body: [
          "Name,Email,Phone,Voice Part,Status,Notes,Section Leader",
          '"Singer, One",one@example.test,555-0101,S1,Active,"First line\nSecond line",yes',
          "Singer Two,,555-0102,A2,On Break,,no",
        ].join("\n"),
        headers: { "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    expect(organizationProfileImportResponseSchema.parse(await response.json())).toMatchObject({
      imported: 2,
      invitationCandidates: 1,
    });
    const profiles = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
        )
      ).json(),
    ).profiles;
    expect(profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Singer, One",
          isSectionLeader: true,
          notes: "First line\nSecond line",
          voicePart: "S1",
        }),
        expect.objectContaining({
          displayName: "Singer Two",
          globalStatus: "Idle",
          voicePart: "A2",
        }),
      ]),
    );
    expect(
      await controlDatabase.prepare("SELECT COUNT(*) AS count FROM user").first<number>("count"),
    ).toBe(1);
    expect(
      await runInDurableObject<OrganizationStore, number>(
        organizationStore.get(organizationStore.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'profile.imported'",
            )
            .one().count,
      ),
    ).toBe(2);

    const rejected = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/import", cookie, {
        body: "Name,Voice Part\nValid Singer,S1\nInvalid Singer,NotConfigured",
        headers: { "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(rejected.status).toBe(400);
    const afterRejected = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
        )
      ).json(),
    ).profiles;
    expect(afterRejected).toHaveLength(2);
  });

  it("creates and lists Profiles only within the canonical authenticated Organization", async () => {
    expect(
      await exports.default.fetch(apiRequest("alpha.localhost", "/api/organization/profiles")),
    ).toMatchObject({ status: 401 });
    const cookie = await signIn();
    const createdResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "  Alpha Singer  " }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createdResponse.status).toBe(201);
    const created = organizationProfileResponseSchema.parse(await createdResponse.json());
    expect(created.displayName).toBe("Alpha Singer");

    const updatedResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${created.id}`, cookie, {
        body: JSON.stringify({
          displayName: 'Alpha "Ace", Singer',
          doNotEmail: true,
          globalStatus: "Idle",
          isSectionLeader: true,
          notes: "On Break through September",
          phone: "555-0100",
          receiveAdminNotifications: false,
          receiveAttendanceReports: false,
          receiveFinancialAlerts: true,
          receiveRsvpDeclineNotices: true,
          showInDirectory: false,
          voicePart: "S1",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updatedResponse.status).toBe(200);
    const updated = organizationProfileResponseSchema.parse(await updatedResponse.json());
    expect(updated).toMatchObject({
      displayName: 'Alpha "Ace", Singer',
      doNotEmail: true,
      globalStatus: "Idle",
      isSectionLeader: true,
      notes: "On Break through September",
      phone: "555-0100",
      showInDirectory: false,
      voicePart: "S1",
    });
    await controlDatabase
      .prepare(
        `UPDATE member SET profileId = ?
         WHERE organizationId = 'organization-alpha' AND userId = 'profile-manager'`,
      )
      .bind(created.id)
      .run();

    const rosterExport = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/export.csv", cookie),
    );
    expect(rosterExport.status).toBe(200);
    expect(rosterExport.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(rosterExport.headers.get("cache-control")).toBe("no-store");
    expect(rosterExport.headers.get("content-disposition")).toBe(
      'attachment; filename="choir_roster_export.csv"',
    );
    expect(await rosterExport.text()).toBe(
      [
        "Name,Email,Phone,Voice Part,Status",
        '"Alpha ""Ace"", Singer","profile.manager@example.test","555-0100","S1","Idle"',
        "",
        "Section Leaders",
        "Name,Email,Phone,Voice Part,Status",
        '"Alpha ""Ace"", Singer","profile.manager@example.test","555-0100","S1","Idle"',
      ].join("\n"),
    );
    expect(
      await exports.default.fetch(
        apiRequest("bravo.localhost", "/api/organization/profiles/export.csv", cookie),
      ),
    ).toMatchObject({ status: 403 });

    const alphaList = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
        )
      ).json(),
    );
    expect(alphaList.profiles).toEqual([organizationProfileSchema.parse(updated)]);
    expect(
      await exports.default.fetch(
        apiRequest("bravo.localhost", "/api/organization/profiles", cookie),
      ),
    ).toMatchObject({ status: 403 });
    expect(
      await exports.default.fetch(
        apiRequest("bravo.localhost", "/api/organization/profiles", cookie, {
          body: JSON.stringify({ displayName: "Forbidden Singer" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    ).toMatchObject({ status: 403 });

    const auditCount = await runInDurableObject<OrganizationStore, number>(
      organizationStore.get(organizationStore.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM audit_events
             WHERE action IN ('profile.created', 'profile.updated') AND target_id = ?
               AND actor_id = 'profile-manager'`,
            created.id,
          )
          .one().count,
    );
    expect(auditCount).toBe(2);
  });
});

describe("provider bounces and delivery history", () => {
  it("records a hard bounce, suppresses the profile, and exposes delivery history", async () => {
    const organizationId = "organization-alpha";
    const profileId = "33333333-3333-4333-8333-333333333333";
    const requestId = "44444444-4444-4444-8444-444444444444";
    const now = "2026-08-05T12:00:00.000Z";
    const stub = organizationStore.get(organizationStore.idFromName(organizationId));

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        profileId,
        "Bounced Singer",
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, 'Bounced Singer', 'email', 'bounced@example.test', 'sent', 1, ?, ?)`,
        "delivery-1",
        "55555555-5555-4555-8555-555555555555",
        profileId,
        now,
        now,
      );
    });

    const bounceResponse = await stub.fetch(
      "https://organization.internal/internal/email/provider-event",
      {
        body: JSON.stringify({
          bounceType: "hard",
          eventId: requestId,
          eventTimestamp: now,
          organizationId,
          providerMessageId: "cloudflare-bounced-id",
          providerReason: "550 5.1.1 User unknown",
          providerSmtpEnhancedStatusCode: "5.1.1",
          providerSmtpResponse: "550 5.1.1 User unknown",
          providerSmtpStatusCode: "550",
          providerStatus: "bounced",
          recipient: "bounced@example.test",
          shouldSuppress: true,
          sourceId: "delivery-1",
          sourceKind: "communication_delivery",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(bounceResponse.status).toBe(200);

    const outOfOrderDeliveredResponse = await stub.fetch(
      "https://organization.internal/internal/email/provider-event",
      {
        body: JSON.stringify({
          bounceType: null,
          eventId: `${requestId}-delivered`,
          eventTimestamp: "2026-08-05T12:01:00.000Z",
          organizationId,
          providerMessageId: "cloudflare-bounced-id",
          providerReason: "",
          providerSmtpEnhancedStatusCode: "2.0.0",
          providerSmtpResponse: "250 2.0.0 OK",
          providerSmtpStatusCode: "250",
          providerStatus: "delivered",
          recipient: "bounced@example.test",
          shouldSuppress: false,
          sourceId: "delivery-1",
          sourceKind: "communication_delivery",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(outOfOrderDeliveredResponse.status).toBe(200);

    const state = await runInDurableObject<
      OrganizationStore,
      {
        readonly auditCount: number;
        readonly doNotEmail: number;
        readonly lastBounceAt: string;
        readonly suppressionReason: string;
        readonly suppressionCount: number;
        readonly providerStatus: string;
      }
    >(stub, (_instance, s) => {
      const profile = s.storage.sql
        .exec<{
          readonly bounceReason: string;
          readonly doNotEmail: number;
          readonly lastBounceAt: string;
        }>(
          "SELECT do_not_email AS doNotEmail, last_bounce_at AS lastBounceAt, bounce_reason AS bounceReason FROM profiles WHERE id = ?",
          profileId,
        )
        .one();
      const suppression = s.storage.sql
        .exec<{ readonly reason: string }>(
          "SELECT reason FROM communication_suppressions WHERE profile_id = ? AND channel = 'email'",
          profileId,
        )
        .toArray();
      const audit = s.storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM audit_events WHERE target_id = ? AND action = 'organization.email_provider_bounced'",
          "delivery-1",
        )
        .one();
      const delivery = s.storage.sql
        .exec<{ readonly providerStatus: string }>(
          "SELECT provider_status AS providerStatus FROM communication_deliveries WHERE id = ?",
          "delivery-1",
        )
        .one();
      return {
        auditCount: audit.count,
        doNotEmail: profile.doNotEmail,
        lastBounceAt: profile.lastBounceAt,
        providerStatus: delivery.providerStatus,
        suppressionCount: suppression.length,
        suppressionReason: suppression[0]?.reason ?? "",
      };
    });
    expect(state.doNotEmail).toBe(1);
    expect(new Date(state.lastBounceAt).toISOString()).toBe(state.lastBounceAt);
    expect(state.suppressionCount).toBe(1);
    expect(state.suppressionReason).toBe("provider");
    expect(state.auditCount).toBe(1);
    expect(state.providerStatus).toBe("bounced");

    const deliveriesUrl = new URL(
      "https://organization.internal/internal/communications/deliveries",
    );
    deliveriesUrl.searchParams.set("organizationId", organizationId);
    deliveriesUrl.searchParams.set("profileId", profileId);
    const deliveriesResponse = await stub.fetch(deliveriesUrl);
    expect(deliveriesResponse.status).toBe(200);
    const deliveriesBody = organizationProfileDeliveriesResponseSchema
      .omit({ requestId: true })
      .parse(await deliveriesResponse.json());
    expect(deliveriesBody.deliveries).toHaveLength(1);
    expect(deliveriesBody.deliveries[0]).toMatchObject({
      destination: "bounced@example.test",
      providerStatus: "bounced",
      status: "sent",
      subject: "(no subject)",
    });
  });
});
