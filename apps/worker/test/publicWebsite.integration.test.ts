import {
  organizationEventSchema,
  organizationVenueSchema,
  privateFileResponseSchema,
  publishedOrganizationProjectionSchema,
  publicWebsitePublishResponseSchema,
  publicWebsiteSettingsResponseSchema,
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

const api = (host: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(host, path, cookie, init);

const jsonWrite = (
  host: string,
  path: string,
  method: "POST" | "PUT",
  body: unknown,
  cookie: string,
) => writeJson(exports.default, host, path, cookie, body, method);

const provision = (id: string, slug: string, role: "admin" | "member") =>
  provisionOrganization(database, stores, {
    id,
    name: `Organization ${slug}`,
    role,
    slug,
    userId: "website-manager",
  });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

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
  await seedAuthUser(database, "website-manager", USER_EMAIL, "Website Manager");
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
            rsvpDeadlineDate: "2030-01-01",
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
