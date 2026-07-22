import {
  organizationEventSchema,
  organizationVenueSchema,
  privateFileResponseSchema,
  publishedOrganizationProjectionSchema,
  publicWebsitePublishResponseSchema,
  publicWebsiteSettingsResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { publishedMediaKey } from "../src/publication/publishOrganization";
import { privateOrganizationFileKey } from "../src/storage/privateFiles";

const USER_EMAIL = "website.manager@example.test";
const FILE_ID = "77777777-7777-4777-8777-777777777777";

function binding<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return value;
}

const database = binding(env.CONTROL_DB, "CONTROL_DB");
const files = binding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const stores = binding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function jsonWrite(
  host: string,
  path: string,
  method: "POST" | "PUT",
  body: unknown,
  cookie: string,
): Promise<Response> {
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    }),
  );
}

async function provision(id: string, slug: string, role: "admin" | "member"): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 19, ?, ?, ?)`,
      )
      .bind(id, `Organization ${slug}`, slug, id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, id, `${slug}.localhost`, now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, 'website-manager', ?, ?)`,
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

async function signIn(): Promise<string> {
  const sendResponse = await exports.default.fetch(
    api("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(sendResponse.status).toBe(200);
  const code = readCapturedPlatformEmailsForTest()
    .find(({ recipient }) => recipient === USER_EMAIL)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  expect(code).toMatch(/^\d{6}$/);
  const response = await exports.default.fetch(
    api("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, otp: code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function uploadImage(cookie: string): Promise<void> {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const response = await exports.default.fetch(
    api("alpha.localhost", `/api/organization/files/${FILE_ID}`, cookie, {
      body: bytes,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "image/png",
        "x-file-name": "hero.png",
      },
      method: "PUT",
    }),
  );
  expect(response.status).toBe(201);
  expect(privateFileResponseSchema.parse(await response.json()).id).toBe(FILE_ID);
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('website-manager', 'Website Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "alpha", "admin");
  await provision("organization-bravo", "bravo", "member");
  const nowIso = new Date(now).toISOString();
  await database
    .prepare(
      `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES ('domain-alpha-public', 'organization-alpha', 'alpha.example.test',
        'custom_public', 'active', 1, ?, ?)`,
    )
    .bind(nowIso, nowIso)
    .run();
});

afterEach(async () => reset());

describe("Organization public website", () => {
  it("publishes isolated immutable projections and public media from a private manager draft", async () => {
    const cookie = await signIn();
    expect(
      (await exports.default.fetch(api("alpha.localhost", "/api/organization/website"))).status,
    ).toBe(401);
    expect(
      (await jsonWrite("bravo.localhost", "/api/organization/website", "PUT", {}, cookie)).status,
    ).toBe(403);

    await uploadImage(cookie);
    const venue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "1 Music Way", name: "Concert Hall" },
          cookie,
        )
      ).json(),
    );
    const performance = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            callTime: "18:30",
            details: "Private call notes",
            durationMinutes: 90,
            location: "Downtown",
            parentPerformanceId: null,
            publicDetails: "An evening of choral music.",
            publicGraphicFileId: FILE_ID,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2026-12-20T00:00:00.000Z",
            title: "Winter Concert",
            type: "Performance",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );
    const initialSettings = publicWebsiteSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/website", cookie))
      ).json(),
    );
    const savedSettings = publicWebsiteSettingsResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/website",
          "PUT",
          {
            aboutUsText: "## About Alpha\nWe sing together.",
            bodyFont: "friendly-sans",
            contactEmail: "hello@alpha.example.test",
            enabledNavigation: ["tickets"],
            headerFont: "modern-serif",
            heroFileId: FILE_ID,
            heroHeadline: "Alpha sings",
            heroSubtitle: "Music for everyone",
            historyText: "Founded with a song.",
            logoFileId: FILE_ID,
            showBrandingHeaderFooter: true,
          },
          cookie,
        )
      ).json(),
    );
    expect(initialSettings.publicationVersion).toBe(0);
    expect(savedSettings.heroHeadline).toBe("Alpha sings");

    const publication = publicWebsitePublishResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/website/publish", cookie, { method: "POST" }),
        )
      ).json(),
    );
    expect(publication.version).toBe(1);

    for (const hostname of ["alpha.localhost", "alpha.example.test"]) {
      const response = await exports.default.fetch(api(hostname, "/api/public/projection"));
      expect(response.status).toBe(200);
      const projection = publishedOrganizationProjectionSchema.parse(await response.json());
      expect(projection).toMatchObject({
        organizationId: "organization-alpha",
        payload: {
          performances: [{ id: performance.id, title: "Winter Concert" }],
          settings: { heroHeadline: "Alpha sings" },
        },
        version: 1,
      });
      expect(JSON.stringify(projection)).not.toContain("Private call notes");
    }

    const mediaResponse = await exports.default.fetch(
      api("alpha.example.test", `/api/public/media/1/${FILE_ID}`),
    );
    expect(mediaResponse.status).toBe(200);
    expect(mediaResponse.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(mediaResponse.headers.get("content-type")).toBe("image/png");
    const etag = mediaResponse.headers.get("etag");
    expect(etag).toBeTruthy();
    if (!etag) throw new Error("Published media ETag was not returned.");
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", `/api/public/media/1/${FILE_ID}`, undefined, {
            headers: { "if-none-match": etag },
          }),
        )
      ).status,
    ).toBe(304);
    expect(
      (await exports.default.fetch(api("bravo.localhost", `/api/public/media/1/${FILE_ID}`)))
        .status,
    ).toBe(404);

    await jsonWrite(
      "alpha.localhost",
      "/api/organization/website",
      "PUT",
      { ...savedSettings, heroHeadline: "Unpublished revision" },
      cookie,
    );
    const unchanged = publishedOrganizationProjectionSchema.parse(
      await (await exports.default.fetch(api("alpha.localhost", "/api/public/projection"))).json(),
    );
    expect(unchanged.payload.settings.heroHeadline).toBe("Alpha sings");
    const secondPublication = publicWebsitePublishResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/website/publish", cookie, { method: "POST" }),
        )
      ).json(),
    );
    expect(secondPublication.version).toBe(2);
    const revised = publishedOrganizationProjectionSchema.parse(
      await (
        await exports.default.fetch(api("alpha.example.test", "/api/public/projection"))
      ).json(),
    );
    expect(revised.payload.settings.heroHeadline).toBe("Unpublished revision");
    expect(revised.version).toBe(2);
    expect(
      (await exports.default.fetch(api("alpha.localhost", `/api/public/media/1/${FILE_ID}`)))
        .status,
    ).toBe(200);

    const actions = await runInDurableObject<OrganizationStore, string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { action: string }>(
            `SELECT action FROM audit_events
             WHERE action IN ('organization.website.updated', 'organization.website.published')
             ORDER BY occurred_at, id`,
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(actions).toEqual([
      "organization.website.updated",
      "organization.website.published",
      "organization.website.updated",
      "organization.website.published",
    ]);
    await expect(
      files.head(privateOrganizationFileKey("organization-alpha", FILE_ID)),
    ).resolves.not.toBeNull();
    await expect(
      files.head(publishedMediaKey("organization-alpha", 1, FILE_ID)),
    ).resolves.not.toBeNull();
  });
});
