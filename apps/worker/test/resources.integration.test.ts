import {
  organizationResourceResponseSchema,
  organizationResourcesResponseSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
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
const email = "resource.manager@example.test";

const api = (host: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(host, path, cookie, init);

const json = (host: string, path: string, cookie: string, body: unknown, method = "POST") =>
  writeJson(exports.default, host, path, cookie, body, method);

const provision = (id: string, slug: string, role: "admin" | "member") =>
  provisionOrganization(database, stores, {
    id,
    name: `Organization ${slug}`,
    role,
    slug,
    userId: "resource-user",
  });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", email, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "resource-user", email, "Resource User");
  await provision("organization-alpha", "alpha", "admin");
  await provision("organization-bravo", "bravo", "member");
});
afterEach(async () => reset());

describe("Organization resources", () => {
  it("isolates, authorizes, orders, audits, and reclaims private resources", async () => {
    const cookie = await signIn();
    const fileId = crypto.randomUUID();
    const bytes = new TextEncoder().encode("private handbook");
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
            body: bytes,
            headers: {
              "content-length": String(bytes.length),
              "content-type": "application/pdf",
              "x-file-name": encodeURIComponent("handbook.pdf"),
            },
            method: "PUT",
          }),
        )
      ).status,
    ).toBe(201);

    const fileResource = organizationResourceResponseSchema.parse(
      await (
        await json("alpha.localhost", "/api/organization/resources", cookie, {
          fileId,
          sortOrder: 1,
          title: "Handbook",
          url: null,
        })
      ).json(),
    );
    const linkResource = organizationResourceResponseSchema.parse(
      await (
        await json("alpha.localhost", "/api/organization/resources", cookie, {
          fileId: null,
          sortOrder: 0,
          title: "Member portal",
          url: "https://example.test/members",
        })
      ).json(),
    );
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, { method: "DELETE" }),
        )
      ).status,
    ).toBe(409);

    const listed = organizationResourcesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/resources", cookie))
      ).json(),
    );
    expect(listed.resources.map(({ title }) => title)).toEqual(["Member portal", "Handbook"]);
    expect(
      (
        await json(
          "alpha.localhost",
          "/api/organization/resources/order",
          cookie,
          { resourceIds: [fileResource.id, linkResource.id] },
          "PUT",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await json("bravo.localhost", "/api/organization/resources", cookie, {
          fileId: null,
          title: "Forbidden",
          url: "https://example.test",
        })
      ).status,
    ).toBe(403);
    const bravo = organizationResourcesResponseSchema.parse(
      await (
        await exports.default.fetch(api("bravo.localhost", "/api/organization/resources", cookie))
      ).json(),
    );
    expect(bravo.resources).toEqual([]);

    const replacementFileId = crypto.randomUUID();
    const replacementBytes = new TextEncoder().encode("replacement handbook");
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/files/${replacementFileId}`, cookie, {
            body: replacementBytes,
            headers: {
              "content-length": String(replacementBytes.length),
              "content-type": "application/pdf",
              "x-file-name": encodeURIComponent("replacement-handbook.pdf"),
            },
            method: "PUT",
          }),
        )
      ).status,
    ).toBe(201);
    const replacedResource = organizationResourceResponseSchema.parse(
      await (
        await json(
          "alpha.localhost",
          `/api/organization/resources/${fileResource.id}`,
          cookie,
          {
            fileId: replacementFileId,
            sortOrder: fileResource.sortOrder,
            title: "Replacement handbook",
            url: null,
          },
          "PUT",
        )
      ).json(),
    );
    expect(replacedResource.fileId).toBe(replacementFileId);
    expect(replacedResource.title).toBe("Replacement handbook");
    expect(await files.head(privateOrganizationFileKey("organization-alpha", fileId))).toBeNull();
    expect(
      await files.head(privateOrganizationFileKey("organization-alpha", replacementFileId)),
    ).not.toBeNull();

    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/resources/${fileResource.id}`, cookie, {
            method: "DELETE",
          }),
        )
      ).status,
    ).toBe(200);
    expect(await files.head(privateOrganizationFileKey("organization-alpha", fileId))).toBeNull();
    expect(
      await files.head(privateOrganizationFileKey("organization-alpha", replacementFileId)),
    ).toBeNull();
    const actions = await runInDurableObject<OrganizationStore, string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE target_type = 'organization_resource' ORDER BY occurred_at",
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "organization.resource.created",
        "organization.resource.reordered",
        "organization.resource.deleted",
      ]),
    );
  });
});
