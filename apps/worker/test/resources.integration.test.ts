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

  it("reliably serves admin-created resources to a separate member session with correct authorization", async () => {
    const adminCookie = await signIn();

    const memberEmail = "resource.member@example.test";
    await seedAuthUser(database, "resource-member-user", memberEmail, "Resource Member");
    await database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, ?, 'member', ?)`,
      )
      .bind("member-alpha-user", "organization-alpha", "resource-member-user", Date.now())
      .run();

    const memberCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      memberEmail,
      (recipient) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), recipient),
    );

    // Unauthenticated request receives 401
    const unauthResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/resources"),
    );
    expect(unauthResponse.status).toBe(401);

    // Initial read by member is empty
    const initialList = organizationResourcesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/resources", memberCookie),
        )
      ).json(),
    );
    expect(initialList.resources).toEqual([]);

    // Admin creates three resources with similar/duplicate titles
    const titles = ["Warmup Exercise", "Warmup Exercise", "Warmup Exercise"];
    const createdResources = [];
    for (let i = 0; i < titles.length; i++) {
      const title = titles[i];
      if (!title) {
        throw new Error("Expected title");
      }
      const res = organizationResourceResponseSchema.parse(
        await (
          await json("alpha.localhost", "/api/organization/resources", adminCookie, {
            fileId: null,
            sortOrder: i,
            title,
            url: `https://example.test/warmup-${String(i + 1)}`,
          })
        ).json(),
      );
      createdResources.push(res);
    }

    // Separate member immediately GETs and sees all three resources with distinct IDs and proper ordering
    const memberList = organizationResourcesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/resources", memberCookie),
        )
      ).json(),
    );
    expect(memberList.resources).toHaveLength(3);
    expect(memberList.resources.map((r) => r.id)).toEqual(createdResources.map((r) => r.id));
    expect(memberList.resources.map((r) => r.url)).toEqual([
      "https://example.test/warmup-1",
      "https://example.test/warmup-2",
      "https://example.test/warmup-3",
    ]);

    const firstCreated = createdResources[0];
    const secondCreated = createdResources[1];
    const thirdCreated = createdResources[2];
    if (!firstCreated || !secondCreated || !thirdCreated) {
      throw new Error("Expected 3 created resources");
    }

    // Member is forbidden from mutating resources
    const memberPost = await json("alpha.localhost", "/api/organization/resources", memberCookie, {
      fileId: null,
      title: "Member Created",
      url: "https://example.test/member",
    });
    expect(memberPost.status).toBe(403);

    const memberPut = await json(
      "alpha.localhost",
      `/api/organization/resources/${firstCreated.id}`,
      memberCookie,
      {
        fileId: null,
        sortOrder: 0,
        title: "Member Updated",
        url: "https://example.test/updated",
      },
      "PUT",
    );
    expect(memberPut.status).toBe(403);

    const memberReorder = await json(
      "alpha.localhost",
      "/api/organization/resources/order",
      memberCookie,
      { resourceIds: [thirdCreated.id, secondCreated.id, firstCreated.id] },
      "PUT",
    );
    expect(memberReorder.status).toBe(403);

    const memberDelete = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/resources/${firstCreated.id}`, memberCookie, {
        method: "DELETE",
      }),
    );
    expect(memberDelete.status).toBe(403);
  });
});
