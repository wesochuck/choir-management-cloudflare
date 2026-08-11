import {
  organizationResourceResponseSchema,
  organizationResourcesResponseSchema,
} from "@choir/contracts";
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

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function json(host: string, path: string, cookie: string, body: unknown, method = "POST") {
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    }),
  );
}

async function provision(id: string, slug: string, role: "admin" | "member") {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version, created_at, updated_at, provisioned_at) VALUES (?, ?, ?, 'active', ?, 15, ?, ?, ?)`,
      )
      .bind(id, `Organization ${slug}`, slug, id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at) VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, id, `${slug}.localhost`, now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, 'resource-user', ?, ?)`,
      )
      .bind(`member-${slug}`, id, role, Date.now()),
  ]);
  const response = await stores
    .get(stores.idFromName(id))
    .fetch("https://organization.internal/internal/provision", {
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

async function signIn() {
  await exports.default.fetch(
    api("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const otp = readCapturedPlatformEmailsForTest()
    .find((item) => item.recipient === email)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    api("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email, otp }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled) VALUES ('resource-user', 'Resource User', ?, 0, ?, ?, 0)`,
    )
    .bind(email, now, now)
    .run();
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
