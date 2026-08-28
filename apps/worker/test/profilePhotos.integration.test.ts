import { organizationDirectoryResponseSchema } from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { MAX_PRIVATE_FILE_BYTES, privateOrganizationFileKey } from "../src/storage/privateFiles";

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

const api = (path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest("alpha.localhost", path, cookie, init);

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

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", email, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

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
  await seedAuthUser(database, "photo-user", email, "Photo User");
  await provisionOrganization(database, stores, {
    id: "organization-alpha",
    name: "Organization Alpha",
    role: "member",
    slug: "alpha",
    userId: "photo-user",
  });
  await database
    .prepare("UPDATE member SET profileId = ? WHERE id = 'member-alpha'")
    .bind(ownProfileId)
    .run();
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

  it("accepts supported image types and rejects malformed or oversized uploads", async () => {
    const cookie = await signIn();

    for (const contentType of ["image/jpeg", "image/png", "image/webp"] as const) {
      const fileId = crypto.randomUUID();
      expect((await upload(cookie, fileId, `photo-${contentType}`, contentType)).status).toBe(201);
      expect(
        (
          await exports.default.fetch(
            api(`/api/organization/profiles/${ownProfileId}/photo/${fileId}`, cookie, {
              method: "PUT",
            }),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await exports.default.fetch(
            api(`/api/organization/profiles/${ownProfileId}/photo`, cookie, { method: "DELETE" }),
          )
        ).status,
      ).toBe(200);
    }

    const malformedType = await upload(
      cookie,
      crypto.randomUUID(),
      "malformed-type",
      "not-a-content-type",
    );
    expect(malformedType.status).toBe(400);

    const oversized = await exports.default.fetch(
      api(`/api/organization/files/${crypto.randomUUID()}`, cookie, {
        body: new Uint8Array([1]),
        headers: {
          "content-length": String(MAX_PRIVATE_FILE_BYTES + 1),
          "content-type": "image/png",
          "x-file-name": encodeURIComponent("oversized.png"),
        },
        method: "PUT",
      }),
    );
    expect(oversized.status).toBe(400);
  });
});
