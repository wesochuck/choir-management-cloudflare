import { privateFileResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { privateOrganizationFileKey } from "../src/storage/privateFiles";

const USER_EMAIL = "file.member@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

interface FileAuditRow {
  readonly [column: string]: SqlStorageValue;
  readonly action: string;
  readonly actorId: string;
  readonly targetId: string;
}

function apiRequest(hostname: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${hostname}`);
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return new Request(`http://${hostname}${path}`, { ...init, headers });
}

async function seedIdentityAndOrganizations(): Promise<void> {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  await controlDatabase.batch([
    controlDatabase
      .prepare(
        `INSERT INTO user
          (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
         VALUES (?, ?, ?, 0, ?, ?, 0)`,
      )
      .bind("user-file-member", "File Member", USER_EMAIL, nowMs, nowMs),
    controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, 4, ?, ?)`,
      )
      .bind("organization-alpha", "Organization Alpha", "alpha", "organization-alpha", now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, 4, ?, ?)`,
      )
      .bind("organization-bravo", "Organization Bravo", "bravo", "organization-bravo", now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind("domain-alpha", "organization-alpha", "alpha.localhost", now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind("domain-bravo", "organization-bravo", "bravo.localhost", now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'custom_public', 'active', 1, ?, ?)`,
      )
      .bind("domain-alpha-public", "organization-alpha", "files.example.test", now, now),
    controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, ?, 'member', ?)`,
      )
      .bind("member-alpha", "organization-alpha", "user-file-member", nowMs),
    controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, ?, 'member', ?)`,
      )
      .bind("member-bravo", "organization-bravo", "user-file-member", nowMs),
  ]);

  for (const organization of [
    { id: "organization-alpha", name: "Organization Alpha", slug: "alpha" },
    { id: "organization-bravo", name: "Organization Bravo", slug: "bravo" },
  ]) {
    const objectId = organizationStore.idFromName(organization.id);
    const response = await organizationStore
      .get(objectId)
      .fetch("https://organization.internal/internal/provision", {
        body: JSON.stringify({
          actorUserId: "bootstrap",
          canonicalHostname: `${organization.slug}.localhost`,
          canonicalStatus: "active",
          name: organization.name,
          organizationId: organization.id,
          requestId: crypto.randomUUID(),
          slug: organization.slug,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    expect(response.status).toBe(200);
  }
}

async function signIn(): Promise<string> {
  const sendResponse = await exports.default.fetch(
    apiRequest("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(sendResponse.status).toBe(200);
  const code = readCapturedPlatformEmailsForTest()
    .find((message) => message.kind === "email-one-time-code" && message.recipient === USER_EMAIL)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  expect(code).toMatch(/^\d{6}$/);
  const response = await exports.default.fetch(
    apiRequest("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, otp: code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toContain("choir-management.session_token=");
  return cookie ?? "";
}

async function uploadFile(
  hostname: string,
  cookie: string,
  fileId: string,
  contents: string,
): Promise<Response> {
  const bytes = new TextEncoder().encode(contents);
  return exports.default.fetch(
    apiRequest(hostname, `/api/organization/files/${fileId}`, cookie, {
      body: bytes,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "text/plain",
        "x-file-name": encodeURIComponent(`${hostname}-notes.txt`),
      },
      method: "PUT",
    }),
  );
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedIdentityAndOrganizations();
});

afterEach(async () => {
  await reset();
});

describe("Private Organization files", () => {
  it("uploads and downloads only through an authorized canonical Organization host", async () => {
    const cookie = await signIn();
    const fileId = "33333333-3333-4333-8333-333333333333";
    const uploadResponse = await uploadFile(
      "alpha.localhost",
      cookie,
      fileId,
      "alpha private contents",
    );
    expect(uploadResponse.status).toBe(201);
    expect(privateFileResponseSchema.parse(await uploadResponse.json())).toMatchObject({
      contentType: "text/plain",
      fileName: "alpha.localhost-notes.txt",
      id: fileId,
      sizeBytes: 22,
    });

    const downloadResponse = await exports.default.fetch(
      apiRequest(
        "alpha.localhost",
        `/api/organization/files/${fileId}?organizationId=organization-bravo`,
        cookie,
      ),
    );
    expect(downloadResponse.status).toBe(200);
    await expect(downloadResponse.text()).resolves.toBe("alpha private contents");
    expect(downloadResponse.headers.get("content-disposition")).toContain(
      "alpha.localhost-notes.txt",
    );
    expect(downloadResponse.headers.get("cache-control")).toBe("no-store");

    const anonymousResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${fileId}`),
    );
    expect(anonymousResponse.status).toBe(401);
    const customPublicResponse = await exports.default.fetch(
      apiRequest("files.example.test", `/api/organization/files/${fileId}`, cookie),
    );
    expect(customPublicResponse.status).toBe(404);
    await expect(
      organizationFiles.head(privateOrganizationFileKey("organization-alpha", fileId)),
    ).resolves.not.toBeNull();
    const alphaObjectId = organizationStore.idFromName("organization-alpha");
    await expect(
      runInDurableObject<OrganizationStore, FileAuditRow | null>(
        organizationStore.get(alphaObjectId),
        (_instance, state) =>
          state.storage.sql
            .exec<FileAuditRow>(
              `SELECT action, actor_id AS actorId, target_id AS targetId
               FROM audit_events WHERE target_id = ? LIMIT 1`,
              fileId,
            )
            .toArray()
            .at(0) ?? null,
      ),
    ).resolves.toEqual({
      action: "organization.file.uploaded",
      actorId: "user-file-member",
      targetId: fileId,
    });
  });

  it("rejects cross-Organization file IDs and poisoned metadata keys", async () => {
    const cookie = await signIn();
    const alphaFileId = "44444444-4444-4444-8444-444444444444";
    const bravoFileId = "55555555-5555-4555-8555-555555555555";
    expect((await uploadFile("alpha.localhost", cookie, alphaFileId, "alpha-only")).status).toBe(
      201,
    );
    expect((await uploadFile("bravo.localhost", cookie, bravoFileId, "bravo-only")).status).toBe(
      201,
    );

    const substitutionResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${bravoFileId}`, cookie),
    );
    expect(substitutionResponse.status).toBe(404);
    expect(await substitutionResponse.text()).not.toContain("bravo-only");

    const alphaObjectId = organizationStore.idFromName("organization-alpha");
    await runInDurableObject<OrganizationStore, undefined>(
      organizationStore.get(alphaObjectId),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE private_files SET storage_key = ? WHERE id = ?",
          privateOrganizationFileKey("organization-bravo", bravoFileId),
          alphaFileId,
        );
        return undefined;
      },
    );
    const poisonedMetadataResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${alphaFileId}`, cookie),
    );
    expect(poisonedMetadataResponse.status).toBe(503);
    expect(await poisonedMetadataResponse.text()).not.toContain("bravo-only");
  });
});
