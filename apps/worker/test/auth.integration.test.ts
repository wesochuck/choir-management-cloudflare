import {
  accountSecurityResponseSchema,
  accountOrganizationsResponseSchema,
  organizationAuthStatusResponseSchema,
  organizationContextResponseSchema,
  organizationInvitationActionResponseSchema,
  organizationInvitationDetailsSchema,
  organizationInvitationsResponseSchema,
  organizationInvitationResponseSchema,
  organizationMfaPolicyResponseSchema,
  organizationMfaVerificationResponseSchema,
  organizationProvisionResponseSchema,
  organizationProfileLinkResponseSchema,
  platformMfaStatusResponseSchema,
  platformJobDeadLettersResponseSchema,
  platformOrganizationContextResponseSchema,
  platformOrganizationsResponseSchema,
  publicDomainResponseSchema,
} from "@choir/contracts";
import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  introspectWorkflow,
  reset,
  runInDurableObject,
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
  JOBS_DLQ_NAME: env.JOBS_DLQ_NAME,
  JOBS_QUEUE: requireBinding(env.JOBS_QUEUE, "JOBS_QUEUE"),
  ORGANIZATION_FILES: requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES"),
  ORGANIZATION_STORE: requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE"),
  PLATFORM_EMAIL_MODE: env.PLATFORM_EMAIL_MODE,
  PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
  PROVISIONING_WORKFLOW: requireBinding(env.PROVISIONING_WORKFLOW, "PROVISIONING_WORKFLOW"),
  ROUTING_CACHE: requireBinding(env.ROUTING_CACHE, "ROUTING_CACHE"),
  SIGNED_LINK_SECRET: requireBinding(env.SIGNED_LINK_SECRET, "SIGNED_LINK_SECRET"),
};

const enrollmentResponseSchema = z.object({
  backupCodes: z.array(z.string()),
  totpURI: z.url(),
});

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

function responseCookie(response: Response, name: string): string {
  const cookie = response.headers
    .getSetCookie()
    .find((candidate) => candidate.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  return cookie?.split(";", 1)[0] ?? "";
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

  it("lists only the signed-in user's Organizations from a canonical product host", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    const sessionCookie = await signInInvitedUser();

    const anonymousResponse = await fetchWorker(
      authRequest("/api/account/organizations?organizationId=organization-bravo"),
    );
    expect(anonymousResponse.status).toBe(401);

    const response = await fetchWorker(
      authRequest("/api/account/organizations?organizationId=organization-no-access", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(response.status).toBe(200);
    expect(accountOrganizationsResponseSchema.parse(await response.json()).organizations).toEqual([
      {
        canonicalHostname: "alpha.localhost",
        canonicalStatus: "active",
        lifecycleState: "active",
        name: "Organization Alpha",
        organizationId: "organization-alpha",
        profileId: null,
        role: "administrator",
        slug: "alpha",
      },
      {
        canonicalHostname: "bravo.localhost",
        canonicalStatus: "active",
        lifecycleState: "active",
        name: "Organization Bravo",
        organizationId: "organization-bravo",
        profileId: null,
        role: "member",
        slug: "bravo",
      },
    ]);

    const publicHostResponse = await fetchWorker(
      new Request("https://public.example.test/api/account/organizations", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(publicHostResponse.status).toBe(404);
  });

  it("lets an invited user set and then change only their own password", async () => {
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();

    const initialStatus = await fetchWorker(
      authRequest("/api/account/security", { headers: { cookie: sessionCookie } }),
    );
    expect(accountSecurityResponseSchema.parse(await initialStatus.json()).passwordSet).toBe(false);

    const shortPassword = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({ mode: "set", newPassword: "too-short" }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(shortPassword.status).toBe(400);

    const firstPassword = "correct-horse-battery-staple";
    const setResponse = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({ mode: "set", newPassword: firstPassword }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(setResponse.status).toBe(200);
    expect(accountSecurityResponseSchema.parse(await setResponse.json()).passwordSet).toBe(true);
    await expect(
      testEnv.CONTROL_DB.prepare(
        "SELECT password FROM account WHERE userId = ? AND providerId = 'credential'",
      )
        .bind("user-invited-member")
        .first<{ password: string }>(),
    ).resolves.not.toMatchObject({ password: firstPassword });

    const wrongCurrentPassword = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({
          currentPassword: "incorrect-current-password",
          mode: "change",
          newPassword: "another-secure-password",
        }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(wrongCurrentPassword.status).toBe(400);

    const secondPassword = "a-different-secure-password";
    const changeResponse = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({
          currentPassword: firstPassword,
          mode: "change",
          newPassword: secondPassword,
        }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(changeResponse.status).toBe(200);

    const oldPasswordSignIn = await fetchWorker(
      authRequest("/api/auth/sign-in/email", {
        body: JSON.stringify({ email: INVITED_EMAIL, password: firstPassword }),
        method: "POST",
      }),
    );
    expect(oldPasswordSignIn.status).toBeGreaterThanOrEqual(400);
    const newPasswordSignIn = await fetchWorker(
      authRequest("/api/auth/sign-in/email", {
        body: JSON.stringify({ email: INVITED_EMAIL, password: secondPassword }),
        method: "POST",
      }),
    );
    expect(newPasswordSignIn.status).toBe(200);
  });

  it("recovers only an invited identity with a single-use link and revokes its sessions", async () => {
    await seedInvitedUser();
    const firstSessionCookie = await signInInvitedUser();
    await signInInvitedUser();
    const oldPassword = "an-existing-secure-password";
    const setResponse = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({ mode: "set", newPassword: oldPassword }),
        headers: { cookie: firstSessionCookie },
        method: "PUT",
      }),
    );
    expect(setResponse.status).toBe(200);

    const requestBody = {
      email: INVITED_EMAIL,
    };
    const requestResponse = await fetchWorker(
      authRequest("/api/auth/request-password-reset", {
        body: JSON.stringify(requestBody),
        method: "POST",
      }),
    );
    expect(requestResponse.status).toBe(200);
    const requestResult: unknown = await requestResponse.json();

    const unknownResponse = await fetchWorker(
      authRequest("/api/auth/request-password-reset", {
        body: JSON.stringify({ ...requestBody, email: "unknown@example.test" }),
        method: "POST",
      }),
    );
    expect(unknownResponse.status).toBe(200);
    await expect(unknownResponse.json()).resolves.toEqual(requestResult);
    expect(
      readCapturedPlatformEmailsForTest().filter((message) => message.kind === "password-reset"),
    ).toHaveLength(1);

    const resetEmail = readCapturedPlatformEmailsForTest().find(
      (message) => message.kind === "password-reset" && message.recipient === INVITED_EMAIL,
    );
    const linkPrefix = "Use this link to reset your password: ";
    expect(resetEmail?.text.startsWith(linkPrefix)).toBe(true);
    const resetLinkValue = resetEmail?.text.slice(linkPrefix.length);
    if (!resetLinkValue) {
      throw new Error("The captured reset email did not contain a link.");
    }
    const resetLink = new URL(resetLinkValue);
    expect(resetLink.origin).toBe(BASE_AUTH_ORIGIN);
    expect(resetLink.pathname).toBe("/reset-password");
    expect(resetLink.search).toBe("");
    const resetToken = new URLSearchParams(resetLink.hash.replace(/^#/, "")).get("token");
    expect(resetToken).toMatch(/^[a-zA-Z0-9_-]+$/);

    const newPassword = "a-recovered-secure-password";
    const resetResponse = await fetchWorker(
      authRequest("/api/auth/reset-password", {
        body: JSON.stringify({ newPassword, token: resetToken }),
        method: "POST",
      }),
    );
    expect(resetResponse.status).toBe(200);
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM session WHERE userId = ?")
        .bind("user-invited-member")
        .first(),
    ).resolves.toEqual({ count: 0 });

    const reusedResponse = await fetchWorker(
      authRequest("/api/auth/reset-password", {
        body: JSON.stringify({ newPassword: "another-recovered-password", token: resetToken }),
        method: "POST",
      }),
    );
    expect(reusedResponse.status).toBe(400);

    const oldPasswordSignIn = await fetchWorker(
      authRequest("/api/auth/sign-in/email", {
        body: JSON.stringify({ email: INVITED_EMAIL, password: oldPassword }),
        method: "POST",
      }),
    );
    expect(oldPasswordSignIn.status).toBeGreaterThanOrEqual(400);
    const newPasswordSignIn = await fetchWorker(
      authRequest("/api/auth/sign-in/email", {
        body: JSON.stringify({ email: INVITED_EMAIL, password: newPassword }),
        method: "POST",
      }),
    );
    expect(newPasswordSignIn.status).toBe(200);
  });

  it("completes password sign-in challenges with TOTP and a recovery code", async () => {
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    const password = "a-password-with-second-factor";
    const setResponse = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({ mode: "set", newPassword: password }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(setResponse.status).toBe(200);

    const enableResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/enable", {
        body: JSON.stringify({ password }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(enableResponse.status).toBe(200);
    const enrollment = enrollmentResponseSchema.parse(await enableResponse.json());
    const verifyEnrollmentResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/verify-totp", {
        body: JSON.stringify({
          code: await generateTotp(enrollment.totpURI),
          trustDevice: false,
        }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(verifyEnrollmentResponse.status).toBe(200);

    const beginPasswordSignIn = async () => {
      const response = await fetchWorker(
        authRequest("/api/auth/sign-in/email", {
          body: JSON.stringify({ email: INVITED_EMAIL, password }),
          method: "POST",
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.clone().json()).resolves.toMatchObject({
        twoFactorMethods: ["totp"],
        twoFactorRedirect: true,
      });
      return responseCookie(response, "choir-management.two_factor");
    };

    const totpChallengeCookie = await beginPasswordSignIn();
    const totpResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/verify-totp", {
        body: JSON.stringify({
          code: await generateTotp(enrollment.totpURI),
          trustDevice: false,
        }),
        headers: { cookie: totpChallengeCookie },
        method: "POST",
      }),
    );
    expect(totpResponse.status).toBe(200);
    const totpSessionCookie = responseCookie(totpResponse, "choir-management.session_token");
    const totpSessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", { headers: { cookie: totpSessionCookie } }),
    );
    await expect(totpSessionResponse.json()).resolves.toMatchObject({
      user: { id: "user-invited-member" },
    });

    const recoveryChallengeCookie = await beginPasswordSignIn();
    const recoveryResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/verify-backup-code", {
        body: JSON.stringify({
          code: enrollment.backupCodes[0],
          trustDevice: false,
        }),
        headers: { cookie: recoveryChallengeCookie },
        method: "POST",
      }),
    );
    expect(recoveryResponse.status).toBe(200);
    const recoverySessionCookie = responseCookie(
      recoveryResponse,
      "choir-management.session_token",
    );
    const recoverySessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", { headers: { cookie: recoverySessionCookie } }),
    );
    await expect(recoverySessionResponse.json()).resolves.toMatchObject({
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

  it("enforces optional MFA per Organization and per session", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    await testEnv.CONTROL_DB.prepare(
      "UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?",
    )
      .bind("organization-alpha", "user-invited-member")
      .run();
    let sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const enableResponse = await fetchWorker(
      authRequest(
        "/api/auth/two-factor/enable",
        {
          body: JSON.stringify({}),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const enrollment = enrollmentResponseSchema.parse(await enableResponse.json());
    const enrollmentResponse = await fetchWorker(
      authRequest(
        "/api/auth/two-factor/verify-totp",
        {
          body: JSON.stringify({
            code: await generateTotp(enrollment.totpURI),
            trustDevice: false,
          }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(enrollmentResponse.status).toBe(200);
    sessionCookie = enrollmentResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? sessionCookie;

    const initialStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await initialStatusResponse.json()),
    ).toMatchObject({
      mfaRequired: false,
      mfaVerifiedUntil: null,
      organizationId: "organization-alpha",
      role: "owner",
      twoFactorEnabled: true,
      twoFactorVerified: true,
    });

    const policyResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-policy",
        {
          body: JSON.stringify({ mfaRequired: true }),
          headers: { cookie: sessionCookie },
          method: "PATCH",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(policyResponse.status).toBe(200);
    expect(organizationMfaPolicyResponseSchema.parse(await policyResponse.json())).toMatchObject({
      mfaRequired: true,
      organizationId: "organization-alpha",
    });

    const beforeVerification = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(beforeVerification.status).toBe(401);
    await expect(beforeVerification.json()).resolves.toMatchObject({
      message: "A recent Organization MFA verification is required.",
    });

    const verificationResponse = await fetchWorker(
      authRequest(
        "/api/organization/mfa/verify",
        {
          body: JSON.stringify({
            code: await generateTotp(enrollment.totpURI),
            method: "totp",
          }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(verificationResponse.status).toBe(200);
    expect(
      organizationMfaVerificationResponseSchema.parse(await verificationResponse.json()),
    ).toMatchObject({ organizationId: "organization-alpha", status: "verified" });

    const authorizedResponse = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(authorizedResponse.status).toBe(200);
    const verifiedStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await verifiedStatusResponse.json())
        .mfaVerifiedUntil,
    ).not.toBeNull();

    await testEnv.CONTROL_DB.prepare(
      "UPDATE organizations SET mfa_required = 1 WHERE id = 'organization-bravo'",
    ).run();
    const otherOrganizationResponse = await fetchWorker(
      new Request("http://bravo.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: "http://bravo.localhost" },
      }),
    );
    expect(otherOrganizationResponse.status).toBe(401);
    const otherOrganizationStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        "http://bravo.localhost",
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await otherOrganizationStatusResponse.json()),
    ).toMatchObject({
      mfaRequired: true,
      mfaVerifiedUntil: null,
      organizationId: "organization-bravo",
    });

    const secondSessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const otherSessionResponse = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: secondSessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(otherSessionResponse.status).toBe(401);
    const otherSessionStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: secondSessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await otherSessionStatusResponse.json()),
    ).toMatchObject({ mfaVerifiedUntil: null, organizationId: "organization-alpha" });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT actor_user_id AS actorUserId, action
         FROM platform_audit_events
         WHERE organization_id = ? AND action = 'organization.auth_policy.updated'`,
      )
        .bind("organization-alpha")
        .first(),
    ).resolves.toEqual({
      action: "organization.auth_policy.updated",
      actorUserId: "user-invited-member",
    });
  });

  it("links a Membership only to a Profile in the host Organization store", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const alphaProfileId = "c9ea355d-8ac2-4dc4-af06-27828846dba8";
    const bravoProfileId = "0cd25a2b-71cc-4437-8524-2445074bbd18";
    const now = new Date().toISOString();

    const alphaObjectId = testEnv.ORGANIZATION_STORE.idFromName("organization-alpha");
    await runInDurableObject(testEnv.ORGANIZATION_STORE.get(alphaObjectId), (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        alphaProfileId,
        "Alpha Profile",
        now,
        now,
      );
    });
    const bravoObjectId = testEnv.ORGANIZATION_STORE.idFromName("organization-bravo");
    await runInDurableObject(testEnv.ORGANIZATION_STORE.get(bravoObjectId), (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        bravoProfileId,
        "Bravo Profile",
        now,
        now,
      );
    });

    const linkResponse = await fetchWorker(
      authRequest(
        "/api/organization/members/member-alpha/profile",
        {
          body: JSON.stringify({ profileId: alphaProfileId }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(linkResponse.status).toBe(200);
    expect(organizationProfileLinkResponseSchema.parse(await linkResponse.json())).toMatchObject({
      membershipId: "member-alpha",
      organizationId: "organization-alpha",
      profileId: alphaProfileId,
    });

    const crossOrganizationResponse = await fetchWorker(
      authRequest(
        "/api/organization/members/member-alpha/profile",
        {
          body: JSON.stringify({ profileId: bravoProfileId }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(crossOrganizationResponse.status).toBe(404);
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT profileId FROM member WHERE id = 'member-alpha'").first(),
    ).resolves.toEqual({ profileId: alphaProfileId });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT actor_user_id AS actorUserId, action
         FROM platform_audit_events
         WHERE target_id = 'member-alpha'
           AND action = 'organization.membership.profile_linked'`,
      ).first(),
    ).resolves.toEqual({
      action: "organization.membership.profile_linked",
      actorUserId: "user-invited-member",
    });
  });

  it("registers Public Website Domains without exposing authenticated routes", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    await testEnv.CONTROL_DB.prepare("UPDATE member SET role = 'owner' WHERE userId = ?")
      .bind("user-invited-member")
      .run();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const registrationResponse = await fetchWorker(
      authRequest(
        "/api/organization/public-domains",
        {
          body: JSON.stringify({ hostname: "Public.Example.Test." }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(registrationResponse.status).toBe(201);
    const domain = publicDomainResponseSchema.parse(await registrationResponse.json());
    expect(domain).toMatchObject({
      hostname: "public.example.test",
      organizationId: "organization-alpha",
      routingVersion: 1,
      status: "pending",
    });

    const productHostnameResponse = await fetchWorker(
      authRequest(
        "/api/organization/public-domains",
        {
          body: JSON.stringify({ hostname: "fake.alpha.localhost" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(productHostnameResponse.status).toBe(400);

    const ipAddressResponse = await fetchWorker(
      authRequest(
        "/api/organization/public-domains",
        {
          body: JSON.stringify({ hostname: "192.0.2.1" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(ipAddressResponse.status).toBe(400);

    const crossOrganizationResponse = await fetchWorker(
      authRequest(
        "/api/organization/public-domains",
        {
          body: JSON.stringify({ hostname: domain.hostname }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        "http://bravo.localhost",
      ),
    );
    expect(crossOrganizationResponse.status).toBe(409);

    await testEnv.CONTROL_DB.prepare(
      "UPDATE organization_domains SET status = 'active' WHERE id = ?",
    )
      .bind(domain.domainId)
      .run();
    await testEnv.ROUTING_CACHE.put(
      `host:${domain.hostname}`,
      JSON.stringify({
        organizationId: "organization-alpha",
        routeKind: "custom_public",
        routingVersion: 1,
      }),
    );
    const authOnPublicDomain = await fetchWorker(
      new Request(`http://${domain.hostname}/api/auth/get-session`, {
        headers: { origin: `http://${domain.hostname}` },
      }),
    );
    expect(authOnPublicDomain.status).toBe(404);
    const organizationRouteOnPublicDomain = await fetchWorker(
      new Request(`http://${domain.hostname}/api/organization/context`, {
        headers: { cookie: sessionCookie, origin: `http://${domain.hostname}` },
      }),
    );
    expect(organizationRouteOnPublicDomain.status).toBe(404);

    const disableResponse = await fetchWorker(
      authRequest(
        `/api/organization/public-domains/${domain.domainId}`,
        { headers: { cookie: sessionCookie }, method: "DELETE" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(disableResponse.status).toBe(200);
    expect(publicDomainResponseSchema.parse(await disableResponse.json())).toMatchObject({
      routingVersion: 2,
      status: "disabled",
    });
    await expect(testEnv.ROUTING_CACHE.get(`host:${domain.hostname}`)).resolves.toBeNull();
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT COUNT(*) AS count FROM platform_audit_events
         WHERE target_id = ? AND action IN (
           'organization.public_domain.registered',
           'organization.public_domain.disabled'
         )`,
      )
        .bind(domain.domainId)
        .first(),
    ).resolves.toEqual({ count: 2 });
  });
});

describe("Platform Administrator MFA", () => {
  it("requires enrollment and a recent session-bound factor, then rejects revocation", async () => {
    await seedInvitedUser();
    let sessionCookie = await signInInvitedUser();

    const ordinaryUserStatus = await fetchWorker(
      authRequest("/api/platform/mfa/status", { headers: { cookie: sessionCookie } }),
    );
    expect(ordinaryUserStatus.status).toBe(200);
    expect(platformMfaStatusResponseSchema.parse(await ordinaryUserStatus.json())).toMatchObject({
      activePlatformAdministrator: false,
      enrollmentComplete: false,
      twoFactorEnabled: false,
    });

    const grantedAt = new Date().toISOString();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO platform_administrators (user_id, granted_by, granted_at)
       VALUES (?, ?, ?)`,
    )
      .bind("user-invited-member", "bootstrap", grantedAt)
      .run();

    const pendingStatus = await fetchWorker(
      authRequest("/api/platform/mfa/status", { headers: { cookie: sessionCookie } }),
    );
    expect(platformMfaStatusResponseSchema.parse(await pendingStatus.json())).toMatchObject({
      activePlatformAdministrator: true,
      enrollmentComplete: false,
      twoFactorEnabled: false,
    });

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

    const enrolledStatus = await fetchWorker(
      authRequest("/api/platform/mfa/status", { headers: { cookie: sessionCookie } }),
    );
    expect(platformMfaStatusResponseSchema.parse(await enrolledStatus.json())).toMatchObject({
      activePlatformAdministrator: true,
      enrollmentComplete: true,
      twoFactorEnabled: true,
    });

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
      scope: { kind: "product_base" },
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
      await testEnv.CONTROL_DB.prepare(
        `INSERT INTO job_dead_letters
          (id, queue_name, message_id, message_valid, observed_attempt,
           organization_id, job_id, job_kind, idempotency_key,
           first_seen_at, last_seen_at, observation_count)
         VALUES (?, ?, ?, 1, 6, NULL, ?, 'organization_export', ?, ?, ?, 1)`,
      )
        .bind(
          "choir-management-jobs-dlq-local:platform-visible-failure",
          "choir-management-jobs-dlq-local",
          "platform-visible-failure",
          "33333333-3333-4333-8333-333333333333",
          "organization-export:unassigned",
          "2026-07-21T17:00:00.000Z",
          "2026-07-21T17:00:00.000Z",
        )
        .run();
      const deadLettersResponse = await fetchWorker(
        authRequest("/api/platform/job-dead-letters", { headers: { cookie: sessionCookie } }),
      );
      expect(deadLettersResponse.status).toBe(200);
      expect(
        platformJobDeadLettersResponseSchema.parse(await deadLettersResponse.json()),
      ).toMatchObject({
        deadLetters: [
          {
            jobKind: "organization_export",
            messageId: "platform-visible-failure",
            messageValid: true,
            observationCount: 1,
            organizationId: null,
          },
        ],
        nextCursor: null,
      });
      const invalidDeadLetterCursorResponse = await fetchWorker(
        authRequest("/api/platform/job-dead-letters?cursor=invalid", {
          headers: { cookie: sessionCookie },
        }),
      );
      expect(invalidDeadLetterCursorResponse.status).toBe(400);
      const scopedDeadLetterResponse = await fetchWorker(
        authRequest(
          "/api/platform/job-dead-letters",
          { headers: { cookie: sessionCookie } },
          ALPHA_AUTH_ORIGIN,
        ),
      );
      expect(scopedDeadLetterResponse.status).toBe(404);

      const initialDirectoryResponse = await fetchWorker(
        authRequest("/api/platform/organizations", { headers: { cookie: sessionCookie } }),
      );
      expect(initialDirectoryResponse.status).toBe(200);
      expect(
        platformOrganizationsResponseSchema.parse(await initialDirectoryResponse.json()),
      ).toMatchObject({ nextCursor: null, organizations: [] });

      const invalidCursorResponse = await fetchWorker(
        authRequest("/api/platform/organizations?cursor=invalid", {
          headers: { cookie: sessionCookie },
        }),
      );
      expect(invalidCursorResponse.status).toBe(400);

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

      const directoryResponse = await fetchWorker(
        authRequest("/api/platform/organizations", { headers: { cookie: sessionCookie } }),
      );
      expect(directoryResponse.status).toBe(200);
      expect(
        platformOrganizationsResponseSchema.parse(await directoryResponse.json()),
      ).toMatchObject({
        nextCursor: null,
        organizations: [
          {
            canonicalHostname: "charlie.localhost",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Organization Charlie",
            organizationId: provisioning.organizationId,
            slug: "charlie",
          },
        ],
      });

      const paginationCreatedAt = "2030-01-01T00:00:00.000Z";
      await testEnv.CONTROL_DB.batch(
        Array.from({ length: 25 }, (_, index) => {
          const suffix = String(index).padStart(2, "0");
          const organizationId = `pagination-organization-${suffix}`;
          return [
            testEnv.CONTROL_DB.prepare(
              `INSERT INTO organizations
                (id, name, slug, lifecycle_state, durable_object_key,
                 operational_schema_version, created_at, updated_at, provisioned_at)
               VALUES (?, ?, ?, 'active', ?, 1, ?, ?, ?)`,
            ).bind(
              organizationId,
              `Pagination Organization ${suffix}`,
              `pagination-${suffix}`,
              organizationId,
              paginationCreatedAt,
              paginationCreatedAt,
              paginationCreatedAt,
            ),
            testEnv.CONTROL_DB.prepare(
              `INSERT INTO organization_domains
                (id, organization_id, hostname, kind, status, routing_version,
                 created_at, updated_at)
               VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
            ).bind(
              `pagination-domain-${suffix}`,
              organizationId,
              `pagination-${suffix}.localhost`,
              paginationCreatedAt,
              paginationCreatedAt,
            ),
          ];
        }).flat(),
      );
      const firstPageResponse = await fetchWorker(
        authRequest("/api/platform/organizations", { headers: { cookie: sessionCookie } }),
      );
      const firstPage = platformOrganizationsResponseSchema.parse(await firstPageResponse.json());
      expect(firstPage.organizations).toHaveLength(25);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPageResponse = await fetchWorker(
        authRequest(
          `/api/platform/organizations?cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
          { headers: { cookie: sessionCookie } },
        ),
      );
      const secondPage = platformOrganizationsResponseSchema.parse(await secondPageResponse.json());
      expect(secondPage.nextCursor).toBeNull();
      expect(secondPage.organizations).toHaveLength(1);
      expect(secondPage.organizations[0]?.organizationId).toBe(provisioning.organizationId);

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
      const wrongHostDirectoryResponse = await fetchWorker(
        authRequest(
          "/api/platform/organizations",
          { headers: { cookie: sessionCookie } },
          "http://charlie.localhost",
        ),
      );
      expect(wrongHostDirectoryResponse.status).toBe(404);
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
    const invitation = organizationInvitationResponseSchema.parse(await invitationResponse.json());
    expect(invitation.status).toBe("pending");
    const invitationEmail = readCapturedPlatformEmailsForTest().find(
      (message) => message.kind === "organization-invitation" && message.recipient === invitedEmail,
    );
    expect(invitationEmail?.text).toContain(
      `http://alpha.localhost/accept-invitation?id=${invitation.id}`,
    );

    const wrongRecipientDetailsResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}`,
        { headers: { cookie: inviterCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(wrongRecipientDetailsResponse.status).toBe(404);

    const pendingUser = await testEnv.CONTROL_DB.prepare(
      "SELECT id, emailVerified FROM user WHERE email = ?",
    )
      .bind(invitedEmail)
      .first<{ emailVerified: number; id: string }>();
    expect(pendingUser).toMatchObject({ emailVerified: 0 });

    const invitedCookie = await signInEmail(invitedEmail, ALPHA_AUTH_ORIGIN);
    const crossOrganizationResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}`,
        { headers: { cookie: invitedCookie } },
        "http://bravo.localhost",
      ),
    );
    expect(crossOrganizationResponse.status).toBe(404);

    const invitationDetailsResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}`,
        { headers: { cookie: invitedCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(invitationDetailsResponse.status).toBe(200);
    expect(
      organizationInvitationDetailsSchema.parse(await invitationDetailsResponse.json()),
    ).toMatchObject({
      email: invitedEmail,
      id: invitation.id,
      organizationId: "organization-alpha",
      organizationName: "Organization Alpha",
      role: "member",
    });
    const acceptResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}/accept`,
        {
          headers: { cookie: invitedCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(acceptResponse.status).toBe(200);
    expect(
      organizationInvitationActionResponseSchema.parse(await acceptResponse.json()),
    ).toMatchObject({ id: invitation.id, status: "accepted" });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT role FROM member WHERE organizationId = ? AND userId = ?")
        .bind("organization-alpha", pendingUser?.id)
        .first(),
    ).resolves.toEqual({ role: "member" });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT action FROM platform_audit_events
         WHERE target_id = ? ORDER BY occurred_at`,
      )
        .bind(invitation.id)
        .all(),
    ).resolves.toMatchObject({
      results: [
        { action: "organization.invitation.created" },
        { action: "organization.invitation.accepted" },
      ],
    });
  });

  it("blocks native Organization HTTP mutations and lists and cancels only host-bound invitations", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const nativeBypassResponse = await fetchWorker(
      authRequest(
        "/api/auth/organization/invite-member",
        {
          body: JSON.stringify({
            email: "native-bypass@example.test",
            organizationId: "organization-bravo",
            role: "admin",
          }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(nativeBypassResponse.status).toBe(404);

    const firstInvitationResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        {
          body: JSON.stringify({ email: "cancel.me@example.test", role: "administrator" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const firstInvitation = organizationInvitationResponseSchema.parse(
      await firstInvitationResponse.json(),
    );
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
      .bind(
        "invitation-bravo-hidden",
        "organization-bravo",
        "hidden@example.test",
        "member",
        Date.now() + 60_000,
        Date.now(),
        "user-invited-member",
      )
      .run();

    const listResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(listResponse.status).toBe(200);
    expect(organizationInvitationsResponseSchema.parse(await listResponse.json())).toMatchObject({
      invitations: [
        {
          email: "cancel.me@example.test",
          id: firstInvitation.id,
          role: "administrator",
          status: "pending",
        },
      ],
      truncated: false,
    });

    const crossOrganizationCancelResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(firstInvitation.id)}`,
        { headers: { cookie: sessionCookie }, method: "DELETE" },
        "http://bravo.localhost",
      ),
    );
    expect(crossOrganizationCancelResponse.status).toBe(403);

    const cancelResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(firstInvitation.id)}`,
        { headers: { cookie: sessionCookie }, method: "DELETE" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(cancelResponse.status).toBe(200);
    expect(
      organizationInvitationActionResponseSchema.parse(await cancelResponse.json()),
    ).toMatchObject({ id: firstInvitation.id, status: "canceled" });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT status FROM invitation WHERE id = ?")
        .bind(firstInvitation.id)
        .first(),
    ).resolves.toEqual({ status: "canceled" });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM invitation WHERE email = ?")
        .bind("native-bypass@example.test")
        .first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("lets the verified recipient decline without creating a membership", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const inviterCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const invitedEmail = "declining.member@example.test";
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
    const invitation = organizationInvitationResponseSchema.parse(await invitationResponse.json());
    const recipientCookie = await signInEmail(invitedEmail, ALPHA_AUTH_ORIGIN);

    const rejectResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}/reject`,
        { headers: { cookie: recipientCookie }, method: "POST" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(rejectResponse.status).toBe(200);
    expect(
      organizationInvitationActionResponseSchema.parse(await rejectResponse.json()),
    ).toMatchObject({ id: invitation.id, status: "rejected" });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT status FROM invitation WHERE id = ?")
        .bind(invitation.id)
        .first(),
    ).resolves.toEqual({ status: "rejected" });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT COUNT(*) AS count FROM member m
         INNER JOIN user u ON u.id = m.userId
         WHERE m.organizationId = ? AND u.email = ?`,
      )
        .bind("organization-alpha", invitedEmail)
        .first(),
    ).resolves.toEqual({ count: 0 });
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
        "/api/organization/invitations/invitation-expired/accept",
        {
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
