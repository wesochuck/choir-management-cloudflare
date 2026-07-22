import { organizationDirectoryResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { privateOrganizationFileKey } from "../src/storage/privateFiles";

function binding<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return value;
}
const database = binding(env.CONTROL_DB, "CONTROL_DB");
const stores = binding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const files = binding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const email = "photo.member@example.test";
const ownProfileId = "11111111-1111-4111-8111-111111111111";
const otherProfileId = "22222222-2222-4222-8222-222222222222";

function api(path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", "http://alpha.localhost");
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://alpha.localhost${path}`, { ...init, headers });
}

async function createProfile(profileId: string, displayName: string): Promise<void> {
  const response = await stores
    .get(stores.idFromName("organization-alpha"))
    .fetch("https://organization.internal/internal/profiles", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        organizationId: "organization-alpha",
        profile: { displayName },
        profileId,
        requestId: crypto.randomUUID(),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  expect(response.status).toBe(200);
}

async function signIn(): Promise<string> {
  await exports.default.fetch(
    api("/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const otp = readCapturedPlatformEmailsForTest()
    .find((item) => item.recipient === email)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    api("/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email, otp }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function upload(cookie: string, fileId: string, body: string, contentType = "image/jpeg") {
  const bytes = new TextEncoder().encode(body);
  return exports.default.fetch(
    api(`/api/organization/files/${fileId}`, cookie, {
      body: bytes,
      headers: {
        "content-length": String(bytes.length),
        "content-type": contentType,
        "x-file-name": encodeURIComponent("profile.jpg"),
      },
      method: "PUT",
    }),
  );
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled) VALUES ('photo-user', 'Photo User', ?, 0, ?, ?, 0)`,
      )
      .bind(email, nowMs, nowMs),
    database
      .prepare(
        `INSERT INTO organizations (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version, created_at, updated_at, provisioned_at) VALUES ('organization-alpha', 'Organization Alpha', 'alpha', 'active', 'organization-alpha', 16, ?, ?, ?)`,
      )
      .bind(now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at) VALUES ('domain-alpha', 'organization-alpha', 'alpha.localhost', 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt) VALUES ('member-alpha', 'organization-alpha', 'photo-user', 'member', ?, ?)`,
      )
      .bind(ownProfileId, nowMs),
  ]);
  const provisioned = await stores
    .get(stores.idFromName("organization-alpha"))
    .fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: "alpha.localhost",
        canonicalStatus: "active",
        name: "Organization Alpha",
        organizationId: "organization-alpha",
        requestId: crypto.randomUUID(),
        slug: "alpha",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  expect(provisioned.status).toBe(200);
  await createProfile(ownProfileId, "Own Profile");
  await createProfile(otherProfileId, "Other Profile");
});
afterEach(async () => reset());

describe("private Profile photos", () => {
  it("supports self-service and manager replacement while reclaiming old objects", async () => {
    const cookie = await signIn();
    const first = crypto.randomUUID();
    expect((await upload(cookie, first, "first-photo")).status).toBe(201);
    expect(
      (
        await exports.default.fetch(
          api(`/api/organization/profiles/${ownProfileId}/photo/${first}`, cookie, {
            method: "PUT",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await exports.default.fetch(
          api(`/api/organization/profiles/${otherProfileId}/photo/${first}`, cookie, {
            method: "PUT",
          }),
        )
      ).status,
    ).toBe(403);
    const directory = organizationDirectoryResponseSchema.parse(
      await (await exports.default.fetch(api("/api/singer/directory", cookie))).json(),
    );
    expect(directory.profiles.find(({ id }) => id === ownProfileId)?.photoFileId).toBe(first);
    const downloaded = await exports.default.fetch(api(`/api/organization/files/${first}`, cookie));
    expect(new TextDecoder().decode(await downloaded.arrayBuffer())).toBe("first-photo");

    await database.prepare("UPDATE member SET role = 'admin' WHERE id = 'member-alpha'").run();
    const managerPhoto = crypto.randomUUID();
    expect((await upload(cookie, managerPhoto, "manager-photo")).status).toBe(201);
    expect(
      (
        await exports.default.fetch(
          api(`/api/organization/profiles/${otherProfileId}/photo/${managerPhoto}`, cookie, {
            method: "PUT",
          }),
        )
      ).status,
    ).toBe(200);

    const replacement = crypto.randomUUID();
    expect((await upload(cookie, replacement, "replacement")).status).toBe(201);
    expect(
      (
        await exports.default.fetch(
          api(`/api/organization/profiles/${ownProfileId}/photo/${replacement}`, cookie, {
            method: "PUT",
          }),
        )
      ).status,
    ).toBe(200);
    expect(await files.head(privateOrganizationFileKey("organization-alpha", first))).toBeNull();
    expect(
      (
        await exports.default.fetch(
          api(`/api/organization/profiles/${ownProfileId}/photo`, cookie, { method: "DELETE" }),
        )
      ).status,
    ).toBe(200);
    expect(
      await files.head(privateOrganizationFileKey("organization-alpha", replacement)),
    ).toBeNull();
    const actions = await runInDurableObject<OrganizationStore, string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE action LIKE 'profile.photo_%' ORDER BY occurred_at",
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(actions).toEqual(
      expect.arrayContaining(["profile.photo_attached", "profile.photo_removed"]),
    );
  });
});
