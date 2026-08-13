import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { expect, inject } from "vitest";
import { z } from "zod";

import worker from "../src";
import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { Env } from "../src/env";

export { readCapturedPlatformEmailsForTest };

export const BASE_AUTH_ORIGIN = "http://localhost";
export const ALPHA_AUTH_ORIGIN = "http://alpha.localhost";
export const INVITED_EMAIL = "invited.member@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

export const testEnv: Env = {
  APP_ENV: env.APP_ENV,
  ASSETS: env.ASSETS,
  BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
  BUILD_VERSION: env.BUILD_VERSION,
  CONTROL_DB: requireBinding(env.CONTROL_DB, "CONTROL_DB"),
  EMAIL_EVENTS_DLQ_NAME: env.EMAIL_EVENTS_DLQ_NAME,
  EMAIL_EVENTS_QUEUE_NAME: env.EMAIL_EVENTS_QUEUE_NAME,
  EXTERNAL_EFFECTS_MODE: env.EXTERNAL_EFFECTS_MODE,
  FLEET_SCHEMA_WORKFLOW: requireBinding(env.FLEET_SCHEMA_WORKFLOW, "FLEET_SCHEMA_WORKFLOW"),
  JOBS_DLQ_NAME: env.JOBS_DLQ_NAME,
  JOBS_QUEUE: requireBinding(env.JOBS_QUEUE, "JOBS_QUEUE"),
  ORGANIZATION_FILES: requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES"),
  ORGANIZATION_STORE: requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE"),
  PLATFORM_EMAIL_FROM: env.PLATFORM_EMAIL_FROM,
  PLATFORM_EMAIL_MODE: env.PLATFORM_EMAIL_MODE,
  PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
  PROVISIONING_WORKFLOW: requireBinding(env.PROVISIONING_WORKFLOW, "PROVISIONING_WORKFLOW"),
  ROUTING_CACHE: requireBinding(env.ROUTING_CACHE, "ROUTING_CACHE"),
  SIGNED_LINK_SECRET: requireBinding(env.SIGNED_LINK_SECRET, "SIGNED_LINK_SECRET"),
};

export const enrollmentResponseSchema = z.object({
  backupCodes: z.array(z.string()),
  totpURI: z.url(),
});

export function authRequest(path: string, init?: RequestInit, origin = BASE_AUTH_ORIGIN): Request {
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

export async function generateTotp(totpUri: string, now = Date.now()): Promise<string> {
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

export async function fetchWorker(request: Request): Promise<Response> {
  const executionContext = createExecutionContext();
  const response = await worker.fetch(request, testEnv, executionContext);
  await waitOnExecutionContext(executionContext);
  return response;
}

export function responseCookie(response: Response, name: string): string {
  const cookie = response.headers
    .getSetCookie()
    .find((candidate) => candidate.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  return cookie?.split(";", 1)[0] ?? "";
}

export async function seedInvitedUser(): Promise<void> {
  const now = Date.now();
  await testEnv.CONTROL_DB.prepare(
    `INSERT INTO user
      (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind("user-invited-member", "Invited Member", INVITED_EMAIL, 0, now, now, 0)
    .run();
}

export async function seedOrganizations(includeBravoMembership = false): Promise<void> {
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

export async function signInEmail(email: string, origin = BASE_AUTH_ORIGIN): Promise<string> {
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

export async function signInInvitedUser(origin = BASE_AUTH_ORIGIN): Promise<string> {
  return signInEmail(INVITED_EMAIL, origin);
}

export async function grantPlatformAdministratorForCurrentSession(): Promise<string> {
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
    ).bind(session.id, "user-invited-member", now, now + 60 * 60 * 1000),
  ]);
  return session.id;
}

export async function setupAuthIntegration(): Promise<void> {
  await applyD1Migrations(testEnv.CONTROL_DB, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
}

export async function teardownAuthIntegration(): Promise<void> {
  await reset();
}
