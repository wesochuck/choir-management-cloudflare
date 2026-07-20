import {
  organizationContextResponseSchema,
  organizationProvisionResponseSchema,
  platformOrganizationContextResponseSchema,
} from "@choir/contracts";
import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  introspectWorkflow,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import { z } from "zod";

import worker from "../src";
import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { Env } from "../src/env";

const BASE_AUTH_ORIGIN = "http://localhost";
const ALPHA_AUTH_ORIGIN = "http://alpha.localhost";
const INVITED_EMAIL = "invited.member@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const testEnv: Env = {
  APP_ENV: env.APP_ENV,
  ASSETS: env.ASSETS,
  BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
  BUILD_VERSION: env.BUILD_VERSION,
  CONTROL_DB: requireBinding(env.CONTROL_DB, "CONTROL_DB"),
  EXTERNAL_EFFECTS_MODE: env.EXTERNAL_EFFECTS_MODE,
  JOBS_QUEUE: requireBinding(env.JOBS_QUEUE, "JOBS_QUEUE"),
  ORGANIZATION_FILES: requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES"),
  ORGANIZATION_STORE: requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE"),
  PLATFORM_EMAIL_MODE: env.PLATFORM_EMAIL_MODE,
  PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
  PROVISIONING_WORKFLOW: requireBinding(env.PROVISIONING_WORKFLOW, "PROVISIONING_WORKFLOW"),
  ROUTING_CACHE: requireBinding(env.ROUTING_CACHE, "ROUTING_CACHE"),
};

const enrollmentResponseSchema = z.object({
  backupCodes: z.array(z.string()),
  totpURI: z.url(),
});

const invitationResponseSchema = z.object({ id: z.string().min(1), status: z.literal("pending") });

function authRequest(path: string, init?: RequestInit, origin = BASE_AUTH_ORIGIN): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", origin);
  if (init?.body) {
    headers.set("content-type", "application/json");
  }
  return new Request(`${origin}${path}`, { ...init, headers });
}

function decodeBase32(value: string): Uint8Array<ArrayBuffer> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error("The TOTP secret is not valid base32.");
    }
    bitBuffer = (bitBuffer << 5) | index;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bitBuffer >>> bitCount) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

async function generateTotp(totpUri: string, now = Date.now()): Promise<string> {
  const secret = new URL(totpUri).searchParams.get("secret");
  if (!secret) {
    throw new Error("The TOTP URI does not contain a secret.");
  }
  const counter = BigInt(Math.floor(now / 30_000));
  const counterBytes = new ArrayBuffer(8);
  new DataView(counterBytes).setBigUint64(0, counter);
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase32(secret),
    { hash: "SHA-1", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const lastByte = signature.at(-1);
  if (lastByte === undefined) {
    throw new Error("The TOTP signature is empty.");
  }
  const offset = lastByte & 0x0f;
  const byte0 = signature[offset];
  const byte1 = signature[offset + 1];
  const byte2 = signature[offset + 2];
  const byte3 = signature[offset + 3];
  if (byte0 === undefined || byte1 === undefined || byte2 === undefined || byte3 === undefined) {
    throw new Error("The TOTP signature has an invalid dynamic offset.");
  }
  const binary =
    ((byte0 & 0x7f) << 24) | ((byte1 & 0xff) << 16) | ((byte2 & 0xff) << 8) | (byte3 & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function fetchWorker(request: Request): Promise<Response> {
  const executionContext = createExecutionContext();
  const response = await worker.fetch(request, testEnv, executionContext);
  await waitOnExecutionContext(executionContext);
  return response;
}

async function seedInvitedUser(): Promise<void> {
  const now = Date.now();
  await testEnv.CONTROL_DB.prepare(
    `INSERT INTO user
      (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind("user-invited-member", "Invited Member", INVITED_EMAIL, 0, now, now, 0)
    .run();
}

async function seedOrganizations(includeBravoMembership = false): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.CONTROL_DB.batch([
    testEnv.CONTROL_DB.prepare(
      `INSERT INTO organizations
        (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
         created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, 1, ?, ?)`,
    ).bind("organization-alpha", "Organization Alpha", "alpha", "organization-alpha", now, now),
    testEnv.CONTROL_DB.prepare(
      `INSERT INTO organizations
        (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
         created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, 1, ?, ?)`,
    ).bind("organization-bravo", "Organization Bravo", "bravo", "organization-bravo", now, now),
    testEnv.CONTROL_DB.prepare(
      `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
    ).bind("domain-alpha", "organization-alpha", "alpha.localhost", now, now),
    testEnv.CONTROL_DB.prepare(
      `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
    ).bind("domain-bravo", "organization-bravo", "bravo.localhost", now, now),
    testEnv.CONTROL_DB.prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind("member-alpha", "organization-alpha", "user-invited-member", "admin", Date.now()),
  ]);

  if (includeBravoMembership) {
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind("member-bravo", "organization-bravo", "user-invited-member", "member", Date.now())
      .run();
  }
}

async function signInEmail(email: string, origin = BASE_AUTH_ORIGIN): Promise<string> {
  const captureCount = readCapturedPlatformEmailsForTest().length;
  const sendResponse = await fetchWorker(
    authRequest(
      "/api/auth/email-otp/send-verification-otp",
      {
        body: JSON.stringify({ email, type: "sign-in" }),
        method: "POST",
      },
      origin,
    ),
  );
  expect(sendResponse.status).toBe(200);
  const otp = readCapturedPlatformEmailsForTest()
    .slice(captureCount)
    .find((message) => message.kind === "email-one-time-code" && message.recipient === email)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  expect(otp).toMatch(/^\d{6}$/);

  const signInResponse = await fetchWorker(
    authRequest(
      "/api/auth/sign-in/email-otp",
      {
        body: JSON.stringify({ email, otp }),
        method: "POST",
      },
      origin,
    ),
  );
  expect(signInResponse.status).toBe(200);
  const sessionCookie = signInResponse.headers.get("set-cookie")?.split(";", 1)[0];
  expect(sessionCookie).toContain("choir-management.session_token=");
  return sessionCookie ?? "";
}

async function signInInvitedUser(origin = BASE_AUTH_ORIGIN): Promise<string> {
  return signInEmail(INVITED_EMAIL, origin);
}

async function grantPlatformAdministratorForCurrentSession(): Promise<string> {
  const session = await testEnv.CONTROL_DB.prepare(
    "SELECT id FROM session WHERE userId = ? ORDER BY createdAt DESC LIMIT 1",
  )
    .bind("user-invited-member")
    .first<{ id: string }>();
  if (!session) {
    throw new Error("The Platform Administrator test session was not created.");
  }
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  await testEnv.CONTROL_DB.batch([
    testEnv.CONTROL_DB.prepare(
      "UPDATE user SET twoFactorEnabled = 1, updatedAt = ? WHERE id = ?",
    ).bind(now, "user-invited-member"),
    testEnv.CONTROL_DB.prepare(
      `INSERT INTO twoFactor
        (id, secret, backupCodes, userId, verified, failedVerificationCount, lockedUntil)
       VALUES (?, ?, ?, ?, 1, 0, NULL)`,
    ).bind(
      crypto.randomUUID(),
      "integration-test-encrypted-secret",
      "integration-test-encrypted-backup-codes",
      "user-invited-member",
    ),
    testEnv.CONTROL_DB.prepare(
      `INSERT INTO platform_administrators
        (user_id, granted_by, granted_at, mfa_enrolled_at, recovery_codes_confirmed_at)
       VALUES (?, 'bootstrap', ?, ?, ?)`,
    ).bind("user-invited-member", nowIso, nowIso, nowIso),
    testEnv.CONTROL_DB.prepare(
      `INSERT INTO platform_mfa_assertions
        (session_id, user_id, method, verified_at, expires_at)
       VALUES (?, ?, 'totp', ?, ?)`,
    ).bind(session.id, "user-invited-member", now, now + 15 * 60 * 1000),
  ]);
  return session.id;
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.CONTROL_DB, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
});

afterEach(async () => {
  await reset();
});

describe("Better Auth Worker integration", () => {
  it("does not expose authentication on a non-product hostname", async () => {
    const response = await fetchWorker(
      new Request("https://public.example.test/api/auth/get-session"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: "Authentication is available only on a canonical product hostname.",
    });
  });

  it("does not expose authentication on an unregistered product subdomain", async () => {
    const response = await fetchWorker(
      authRequest("/api/auth/get-session", undefined, "http://unknown.localhost"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "not_found" });
  });

  it("does not create or email an unknown user through the public OTP endpoint", async () => {
    const response = await fetchWorker(
      authRequest("/api/auth/email-otp/send-verification-otp", {
        body: JSON.stringify({ email: "unknown@example.test", type: "sign-in" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(readCapturedPlatformEmailsForTest()).toEqual([]);
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM user").first(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM verification").first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("completes invited-user email OTP sign-in and stores no plaintext OTP", async () => {
    await seedInvitedUser();

    const sendResponse = await fetchWorker(
      authRequest("/api/auth/email-otp/send-verification-otp", {
        body: JSON.stringify({ email: INVITED_EMAIL, type: "sign-in" }),
        method: "POST",
      }),
    );
    expect(sendResponse.status).toBe(200);

    const capturedMessage = readCapturedPlatformEmailsForTest()[0];
    expect(capturedMessage).toBeDefined();
    const otp = capturedMessage?.text.match(/Use (\d{6}) to sign in/)?.[1];
    expect(otp).toMatch(/^\d{6}$/);

    const verification = await testEnv.CONTROL_DB.prepare(
      "SELECT value FROM verification WHERE identifier = ?",
    )
      .bind(`sign-in-otp-${INVITED_EMAIL}`)
      .first<{ value: string }>();
    expect(verification?.value).not.toContain(otp);

    const signInResponse = await fetchWorker(
      authRequest("/api/auth/sign-in/email-otp", {
        body: JSON.stringify({ email: INVITED_EMAIL, otp }),
        method: "POST",
      }),
    );
    expect(signInResponse.status).toBe(200);
    const sessionCookie = signInResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(sessionCookie).toContain("choir-management.session_token=");

    const sessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", {
        headers: { cookie: sessionCookie ?? "" },
        method: "GET",
      }),
    );
    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      user: { email: INVITED_EMAIL, emailVerified: true },
    });
  });

  it("keeps the email-and-password sign-up path disabled", async () => {
    const response = await fetchWorker(
      authRequest("/api/auth/sign-up/email", {
        body: JSON.stringify({
          email: "self-registered@example.test",
          name: "Self Registered",
          password: "not-a-real-password",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM user").first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("lists and revokes the user's own active sessions", async () => {
    await seedInvitedUser();
    const firstSessionCookie = await signInInvitedUser();
    const secondSessionCookie = await signInInvitedUser();
    const sessionRows = await testEnv.CONTROL_DB.prepare(
      "SELECT token FROM session WHERE userId = ?",
    )
      .bind("user-invited-member")
      .all<{ token: string }>();
    const secondSessionToken = sessionRows.results.find((row) =>
      decodeURIComponent(secondSessionCookie).includes(row.token),
    )?.token;
    expect(secondSessionToken).toBeDefined();

    const listResponse = await fetchWorker(
      authRequest("/api/auth/list-sessions", {
        headers: { cookie: firstSessionCookie },
      }),
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toHaveLength(2);

    const revokeResponse = await fetchWorker(
      authRequest("/api/auth/revoke-session", {
        body: JSON.stringify({ token: secondSessionToken }),
        headers: { cookie: firstSessionCookie },
        method: "POST",
      }),
    );
    expect(revokeResponse.status).toBe(200);

    const revokedSessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", {
        headers: { cookie: secondSessionCookie },
      }),
    );
    await expect(revokedSessionResponse.json()).resolves.toBeNull();
    const retainedSessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", {
        headers: { cookie: firstSessionCookie },
      }),
    );
    await expect(retainedSessionResponse.json()).resolves.toMatchObject({
      user: { id: "user-invited-member" },
    });
  });
});

describe("host-derived Organization authorization", () => {
  it("ignores client-supplied Organization IDs and returns the host Organization", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const response = await fetchWorker(
      new Request(
        "http://alpha.localhost/api/organization/context?organizationId=organization-bravo",
        {
          headers: {
            cookie: sessionCookie,
            origin: ALPHA_AUTH_ORIGIN,
            "x-organization-id": "organization-bravo",
          },
        },
      ),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(organizationContextResponseSchema.parse(body)).toMatchObject({
      organizationId: "organization-alpha",
      role: "administrator",
      userId: "user-invited-member",
    });
  });

  it("rejects a membership that belongs only to another Organization", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const response = await fetchWorker(
      new Request("http://bravo.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: "http://bravo.localhost" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "forbidden" });
  });

  it("treats KV routing as a hint and confirms a poisoned entry against D1", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    await testEnv.ROUTING_CACHE.put(
      "host:alpha.localhost",
      JSON.stringify({
        organizationId: "organization-bravo",
        routeKind: "canonical",
        routingVersion: 1,
      }),
    );

    const response = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(organizationContextResponseSchema.parse(body).organizationId).toBe("organization-alpha");
  });

  it("supports multi-Organization selection without allowing it to select tenant storage", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const listResponse = await fetchWorker(
      authRequest(
        "/api/auth/organization/list",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(listResponse.status).toBe(200);
    const organizations = z
      .array(z.object({ id: z.string(), slug: z.string() }))
      .parse(await listResponse.json());
    expect(new Set(organizations.map((organization) => organization.slug))).toEqual(
      new Set(["alpha", "bravo"]),
    );

    const selectResponse = await fetchWorker(
      authRequest(
        "/api/auth/organization/set-active",
        {
          body: JSON.stringify({ organizationId: "organization-bravo" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(selectResponse.status).toBe(200);

    const contextResponse = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    const context = organizationContextResponseSchema.parse(await contextResponse.json());
    expect(context.organizationId).toBe("organization-alpha");
  });
});

describe("Platform Administrator MFA", () => {
  it("requires enrollment and a recent session-bound factor, then rejects revocation", async () => {
    await seedInvitedUser();
    const grantedAt = new Date().toISOString();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO platform_administrators (user_id, granted_by, granted_at)
       VALUES (?, ?, ?)`,
    )
      .bind("user-invited-member", "bootstrap", grantedAt)
      .run();
    let sessionCookie = await signInInvitedUser();

    const beforeEnrollment = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    expect(beforeEnrollment.status).toBe(403);

    const enableResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/enable", {
        body: JSON.stringify({}),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(enableResponse.status).toBe(200);
    const enrollment = enrollmentResponseSchema.parse(await enableResponse.json());
    expect(enrollment.backupCodes).toHaveLength(10);
    const enrollmentCode = await generateTotp(enrollment.totpURI);

    const verifyEnrollmentResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/verify-totp", {
        body: JSON.stringify({ code: enrollmentCode, trustDevice: false }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(verifyEnrollmentResponse.status).toBe(200);
    sessionCookie =
      verifyEnrollmentResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? sessionCookie;

    const confirmResponse = await fetchWorker(
      authRequest("/api/platform/mfa/confirm-enrollment", {
        body: JSON.stringify({}),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(confirmResponse.status).toBe(200);

    const beforeFreshFactor = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    expect(beforeFreshFactor.status).toBe(401);

    const challengeCode = await generateTotp(enrollment.totpURI);
    const challengeResponse = await fetchWorker(
      authRequest("/api/platform/mfa/verify", {
        body: JSON.stringify({ code: challengeCode, method: "totp" }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(challengeResponse.status).toBe(200);

    const authorized = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({
      mfaMethod: "totp",
      userId: "user-invited-member",
    });

    await testEnv.CONTROL_DB.prepare("DELETE FROM platform_mfa_assertions").run();
    const recoveryResponse = await fetchWorker(
      authRequest("/api/platform/mfa/verify", {
        body: JSON.stringify({ code: enrollment.backupCodes[0], method: "recovery_code" }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(recoveryResponse.status).toBe(200);
    const recoveryAuthorized = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    await expect(recoveryAuthorized.json()).resolves.toMatchObject({ mfaMethod: "recovery_code" });

    await testEnv.CONTROL_DB.prepare(
      "UPDATE platform_administrators SET revoked_at = ? WHERE user_id = ?",
    )
      .bind(new Date().toISOString(), "user-invited-member")
      .run();
    const revokedResponse = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    expect(revokedResponse.status).toBe(403);
  });

  it("bounds edit elevation to one Organization and supports explicit revocation", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    await grantPlatformAdministratorForCurrentSession();

    const initialResponse = await fetchWorker(
      authRequest(
        "/api/platform/organization-context",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const initialContext = platformOrganizationContextResponseSchema.parse(
      await initialResponse.json(),
    );
    expect(initialContext).toMatchObject({
      canEdit: false,
      organizationId: "organization-alpha",
      userId: "user-invited-member",
    });

    const elevationResponse = await fetchWorker(
      authRequest(
        "/api/platform/elevations",
        {
          body: JSON.stringify({ reason: "Verify scoped Organization maintenance" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(elevationResponse.status).toBe(201);
    const elevatedContext = platformOrganizationContextResponseSchema.parse(
      await elevationResponse.json(),
    );
    expect(elevatedContext.canEdit).toBe(true);

    const bravoResponse = await fetchWorker(
      authRequest(
        "/api/platform/organization-context",
        { headers: { cookie: sessionCookie } },
        "http://bravo.localhost",
      ),
    );
    const bravoContext = platformOrganizationContextResponseSchema.parse(
      await bravoResponse.json(),
    );
    expect(bravoContext).toMatchObject({
      canEdit: false,
      organizationId: "organization-bravo",
    });

    const revokeResponse = await fetchWorker(
      authRequest(
        `/api/platform/elevations/${elevatedContext.elevationId ?? "missing"}`,
        { headers: { cookie: sessionCookie }, method: "DELETE" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(revokeResponse.status).toBe(200);

    const revokedResponse = await fetchWorker(
      authRequest(
        "/api/platform/organization-context",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    await expect(revokedResponse.json()).resolves.toMatchObject({ canEdit: false });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT action, actor_user_id AS actorUserId, organization_id AS organizationId
         FROM platform_audit_events
         WHERE target_id = ?
         ORDER BY occurred_at`,
      )
        .bind(elevatedContext.elevationId)
        .all(),
    ).resolves.toMatchObject({
      results: [
        {
          action: "platform.elevation.created",
          actorUserId: "user-invited-member",
          organizationId: "organization-alpha",
        },
        {
          action: "platform.elevation.revoked",
          actorUserId: "user-invited-member",
          organizationId: "organization-alpha",
        },
      ],
    });
  });

  it("starts audited Organization provisioning from the exact product base host", async () => {
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();
    const workflowIntrospector = await introspectWorkflow(testEnv.PROVISIONING_WORKFLOW);
    try {
      const response = await fetchWorker(
        authRequest("/api/platform/organizations", {
          body: JSON.stringify({ name: "Organization Charlie", slug: "charlie" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        }),
      );
      expect(response.status).toBe(202);
      const provisioning = organizationProvisionResponseSchema.parse(await response.json());
      expect(provisioning).toMatchObject({
        canonicalHostname: "charlie.localhost",
        canonicalStatus: "active",
        lifecycleState: "provisioning",
      });

      const workflowInstances = await workflowIntrospector.get();
      expect(workflowInstances).toHaveLength(1);
      await workflowInstances[0]?.waitForStatus("complete");

      await expect(
        testEnv.CONTROL_DB.prepare(
          `SELECT name, slug, lifecycle_state AS lifecycleState,
            provisioning_workflow_id AS workflowId
           FROM organizations WHERE id = ?`,
        )
          .bind(provisioning.organizationId)
          .first(),
      ).resolves.toEqual({
        lifecycleState: "active",
        name: "Organization Charlie",
        slug: "charlie",
        workflowId: provisioning.workflowId,
      });
      await expect(
        testEnv.CONTROL_DB.prepare(
          `SELECT action, actor_user_id AS actorUserId
           FROM platform_audit_events
           WHERE organization_id = ? AND action = 'organization.provisioning.requested'`,
        )
          .bind(provisioning.organizationId)
          .first(),
      ).resolves.toEqual({
        action: "organization.provisioning.requested",
        actorUserId: "user-invited-member",
      });

      const wrongHostResponse = await fetchWorker(
        authRequest(
          "/api/platform/organizations",
          {
            body: JSON.stringify({ name: "Wrong Host", slug: "wrong-host" }),
            headers: { cookie: sessionCookie },
            method: "POST",
          },
          "http://charlie.localhost",
        ),
      );
      expect(wrongHostResponse.status).toBe(404);
    } finally {
      await workflowIntrospector.dispose();
    }
  });
});

describe("Organization invitations", () => {
  it("creates a pending identity that can sign in and accept its invitation", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const inviterCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const invitedEmail = "new.member@example.test";

    const invitationResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        {
          body: JSON.stringify({ email: invitedEmail, role: "member" }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = invitationResponseSchema.parse(await invitationResponse.json());
    expect(invitation.status).toBe("pending");
    expect(
      readCapturedPlatformEmailsForTest().some(
        (message) =>
          message.kind === "organization-invitation" && message.recipient === invitedEmail,
      ),
    ).toBe(true);

    const pendingUser = await testEnv.CONTROL_DB.prepare(
      "SELECT id, emailVerified FROM user WHERE email = ?",
    )
      .bind(invitedEmail)
      .first<{ emailVerified: number; id: string }>();
    expect(pendingUser).toMatchObject({ emailVerified: 0 });

    const invitedCookie = await signInEmail(invitedEmail, ALPHA_AUTH_ORIGIN);
    const acceptResponse = await fetchWorker(
      authRequest(
        "/api/auth/organization/accept-invitation",
        {
          body: JSON.stringify({ invitationId: invitation.id }),
          headers: { cookie: invitedCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(acceptResponse.status).toBe(200);
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT role FROM member WHERE organizationId = ? AND userId = ?")
        .bind("organization-alpha", pendingUser?.id)
        .first(),
    ).resolves.toEqual({ role: "member" });
  });

  it("rejects an expired invitation without creating a membership", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    await testEnv.CONTROL_DB.prepare("DELETE FROM member WHERE userId = ?")
      .bind("user-invited-member")
      .run();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "invitation-expired",
        "organization-alpha",
        INVITED_EMAIL,
        "member",
        "pending",
        Date.now() - 60_000,
        Date.now() - 120_000,
        "user-invited-member",
      )
      .run();

    const response = await fetchWorker(
      authRequest(
        "/api/auth/organization/accept-invitation",
        {
          body: JSON.stringify({ invitationId: "invitation-expired" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(
      testEnv.CONTROL_DB.prepare(
        "SELECT COUNT(*) AS count FROM member WHERE organizationId = ? AND userId = ?",
      )
        .bind("organization-alpha", "user-invited-member")
        .first(),
    ).resolves.toEqual({ count: 0 });
  });
});
