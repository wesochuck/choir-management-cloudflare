import {
  organizationEventSchema,
  organizationRosterConfigurationResponseSchema,
  organizationEventsResponseSchema,
  organizationVenueSchema,
  privateFileResponseSchema,
  publishedOrganizationProjectionSchema,
  publicWebsitePublishResponseSchema,
  publicWebsiteSettingsResponseSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  futureIsoDate,
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
const footerEmbeds = [
  {
    kind: "image",
    title: "Alpha transparency seal",
    src: "https://widgets.guidestar.org/seal/alpha.svg",
    href: "https://app.candid.org/profile/alpha",
    height: 240,
  },
];
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
  it.each(["/login", "/login/"])(
    "redirects custom-domain %s to its own Organization auth host",
    async (path) => {
      const response = await exports.default.fetch(
        api(
          "alpha.example.test",
          `${path}?returnTo=https://evil.example&token=not-forwarded`,
          undefined,
          {
            redirect: "manual",
          },
        ),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("http://alpha.localhost/login");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("keeps custom-domain redirects bound to their Organization", async () => {
    const now = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO organization_domains
      (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
      VALUES ('domain-bravo-public', 'organization-bravo', 'bravo.example.test', 'custom_public', 'active', 1, ?, ?)`,
      )
      .bind(now, now)
      .run();
    const response = await exports.default.fetch(
      api("bravo.example.test", "/login?organizationId=organization-alpha", undefined, {
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://bravo.localhost/login");
  });

  it.each(["pending", "disabled"])(
    "refuses sign-in handoff for a %s custom domain",
    async (status) => {
      await database
        .prepare("UPDATE organization_domains SET status = ? WHERE id = 'domain-alpha-public'")
        .bind(status)
        .run();
      const response = await exports.default.fetch(api("alpha.example.test", "/login"));
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("does not redirect unknown hosts or borrow another Organization's canonical host", async () => {
    const unknown = await exports.default.fetch(api("unknown.example.test", "/login"));
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("location")).toBeNull();
    await database
      .prepare(
        "UPDATE organization_domains SET status = 'disabled' WHERE organization_id = 'organization-alpha' AND kind = 'canonical'",
      )
      .run();
    const response = await exports.default.fetch(api("alpha.example.test", "/login"));
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });

  it("continues serving the canonical login page without a redirect loop", async () => {
    const response = await exports.default.fetch(api("alpha.localhost", "/login"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("makes ticket-enabled Performances public on create and update and refreshes the live schedule without publishing website drafts", async () => {
    const cookie = await signIn();
    const venue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { name: "Ticket Hall", address: "1 Music Way" },
          cookie,
        )
      ).json(),
    );
    const base = {
      type: "Performance",
      title: "New ticketed concert",
      startsAt: futureIsoDate({ days: 30 }),
      rsvpDeadlineDate: futureIsoDate({ days: 20 }).slice(0, 10),
      venueId: venue.id,
      details: "Private call notes",
      publicDetails: "Public concert description",
      publishOnWebsite: false,
    };
    const create = async (isTicketingEnabled: boolean) => {
      const response = await jsonWrite(
        "alpha.localhost",
        "/api/organization/events",
        "POST",
        { ...base, isTicketingEnabled },
        cookie,
      );
      expect(response.status).toBe(201);
      return organizationEventSchema.parse(await response.json());
    };
    const event = await create(false);
    expect(event.publishOnWebsite).toBe(false);
    const publish = async () => {
      const response = await exports.default.fetch(
        api("alpha.localhost", "/api/organization/website/publish", cookie, { method: "POST" }),
      );
      expect(response.status).toBe(200);
    };
    const readPublic = async () =>
      publishedOrganizationProjectionSchema.parse(
        await (
          await exports.default.fetch(api("alpha.localhost", "/api/public/projection"))
        ).json(),
      );
    await publish();
    expect((await readPublic()).payload.performances).toHaveLength(0);
    const update = async (isTicketingEnabled: boolean, publishOnWebsite: boolean) => {
      const response = await jsonWrite(
        "alpha.localhost",
        `/api/organization/events/${event.id}`,
        "PUT",
        { ...event, isTicketingEnabled, publishOnWebsite },
        cookie,
      );
      expect(response.status).toBe(200);
      return organizationEventSchema.parse(await response.json());
    };
    const settings = publicWebsiteSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/website", cookie))
      ).json(),
    );
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/website",
          "PUT",
          {
            ...settings,
            heroHeadline: "Unpublished headline",
            footerText: "Private draft footer",
          },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect((await update(true, false)).publishOnWebsite).toBe(true);
    const live = await readPublic();
    expect(live.payload.performances).toMatchObject([{ id: event.id, isTicketingEnabled: true }]);
    expect(JSON.stringify(live)).not.toContain("Private call notes");
    expect(JSON.stringify(live)).not.toContain("Unpublished headline");
    expect(JSON.stringify(live)).not.toContain("Private draft footer");
    const draft = publicWebsiteSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/website", cookie))
      ).json(),
    );
    expect(draft.heroHeadline).toBe("Unpublished headline");
    expect((await update(false, true)).publishOnWebsite).toBe(true);
    expect((await readPublic()).payload.performances).toMatchObject([
      { id: event.id, isTicketingEnabled: false },
    ]);
    expect((await update(false, false)).publishOnWebsite).toBe(false);
    expect((await readPublic()).payload.performances).toHaveLength(0);
    const newlyTicketed = await create(true);
    expect(newlyTicketed.publishOnWebsite).toBe(true);
    expect((await readPublic()).payload.performances).toMatchObject([{ id: newlyTicketed.id }]);
    expect(
      (await exports.default.fetch(api("bravo.localhost", "/api/public/projection"))).status,
    ).toBe(404);
    const listed = organizationEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/events", cookie))
      ).json(),
    );
    expect(listed.events.find(({ id }) => id === newlyTicketed.id)?.publishOnWebsite).toBe(true);
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/events/${newlyTicketed.id}/cancel`,
          "POST",
          {},
          cookie,
        )
      ).status,
    ).toBe(200);
    expect((await readPublic()).payload.performances).toHaveLength(0);
    const archived = await create(true);
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${archived.id}`, cookie, {
            method: "DELETE",
          }),
        )
      ).status,
    ).toBe(200);
    expect((await readPublic()).payload.performances).toHaveLength(0);
    const concurrent = await Promise.all([create(true), create(true)]);
    expect(new Set((await readPublic()).payload.performances.map(({ id }) => id))).toEqual(
      new Set(concurrent.map(({ id }) => id)),
    );
    await uploadImage(cookie);
    const graphicEvent = concurrent[0];
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/events/${graphicEvent.id}`,
          "PUT",
          {
            ...graphicEvent,
            publicGraphicFileId: FILE_ID,
          },
          cookie,
        )
      ).status,
    ).toBe(200);
    await files.delete(privateOrganizationFileKey("organization-alpha", FILE_ID));
    const failedRefresh = await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${graphicEvent.id}`,
      "PUT",
      {
        ...graphicEvent,
        publicGraphicFileId: FILE_ID,
        title: "Saved despite image publication failure",
      },
      cookie,
    );
    expect(failedRefresh.status).toBe(503);
    expect(await failedRefresh.json()).toMatchObject({
      code: "event_saved_website_refresh_failed",
      message: expect.stringContaining("event change was saved"),
    });
    const savedEvents = organizationEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/events", cookie))
      ).json(),
    );
    expect(savedEvents.events.find(({ id }) => id === graphicEvent.id)?.title).toBe(
      "Saved despite image publication failure",
    );
  });

  it("rejects unsafe embed URLs without changing the saved draft", async () => {
    const cookie = await signIn();
    for (const src of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "http://example.test/widget",
      "https://user:secret@example.test/widget",
      "invalid",
    ]) {
      const response = await jsonWrite(
        "alpha.localhost",
        "/api/organization/website",
        "PUT",
        { footerEmbeds: [{ ...footerEmbeds[0], src }] },
        cookie,
      );
      expect(response.status).toBe(400);
    }
    const saved = publicWebsiteSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/website", cookie))
      ).json(),
    );
    expect(saved.footerEmbeds).toEqual([]);
  });

  it.each([{ heroPosition: { x: 101, y: -1 } }, { pageLabels: { history: { heading: " " } } }])(
    "rejects invalid website settings",
    async (invalid) => {
      const cookie = await signIn();
      const response = await jsonWrite(
        "alpha.localhost",
        "/api/organization/website",
        "PUT",
        invalid,
        cookie,
      );
      expect(response.status).toBe(400);
    },
  );

  it("publishes isolated immutable projections and public media from a private manager draft", async () => {
    const cookie = await signIn();
    expect(
      (await exports.default.fetch(api("alpha.localhost", "/api/organization/website"))).status,
    ).toBe(401);
    expect(
      (await jsonWrite("bravo.localhost", "/api/organization/website", "PUT", {}, cookie)).status,
    ).toBe(403);

    const roster = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/roster-configuration",
          "PUT",
          {
            ...roster,
            performerLabel: "Singer",
          },
          cookie,
        )
      ).status,
    ).toBe(200);
    const commerceResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/commerce-projection"),
    );
    expect(commerceResponse.status).toBe(200);
    expect(
      publishedOrganizationProjectionSchema.parse(await commerceResponse.json()).payload
        .performerLabel,
    ).toBe("Singer");
    const bravoRoster = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("bravo.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    expect(bravoRoster.performerLabel).toBe("Performer");

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
            footerText: "**Alpha supporters**",
            footerEmbeds,
            aboutUsText: "## About Alpha\nWe sing together.",
            bodyFont: "friendly-sans",
            contactEmail: "hello@alpha.example.test",
            enabledNavigation: ["tickets"],
            headerFont: "modern-serif",
            heroFileId: FILE_ID,
            heroHeadline: "Alpha sings",
            heroPosition: { x: 25.5, y: 80 },
            pageLabels: {
              history: { navigationLabel: "Our story", heading: "Our beginnings" },
              auditions: { navigationLabel: "Join", heading: "Join our chorus" },
            },
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
    expect(initialSettings.footerText).toBe("");
    expect(initialSettings.heroPosition).toEqual({ x: 50, y: 50 });
    expect(initialSettings.footerEmbeds).toEqual([]);
    expect(savedSettings.footerEmbeds).toEqual(footerEmbeds);
    const reloaded = publicWebsiteSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/website", cookie))
      ).json(),
    );
    expect(reloaded.footerText).toBe("**Alpha supporters**");
    expect(reloaded.heroPosition).toEqual({ x: 25.5, y: 80 });
    expect(reloaded.pageLabels?.auditions?.navigationLabel).toBe("Join");
    expect(reloaded.footerEmbeds).toEqual(footerEmbeds);

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
          performerLabel: "Singer",
          performances: [
            { id: performance.id, title: "Winter Concert", ticketSlug: "winter-concert" },
          ],
          settings: {
            heroHeadline: "Alpha sings",
            heroPosition: { x: 25.5, y: 80 },
            pageLabels: {
              history: { navigationLabel: "Our story", heading: "Our beginnings" },
              auditions: { navigationLabel: "Join", heading: "Join our chorus" },
            },
            footerText: "**Alpha supporters**",
            footerEmbeds,
          },
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
      {
        ...savedSettings,
        heroHeadline: "",
        heroPosition: { x: 75, y: 10 },
        pageLabels: { history: { heading: "Our new story" } },
        footerText: "New footer",
        footerEmbeds: [],
      },
      cookie,
    );
    const unchanged = publishedOrganizationProjectionSchema.parse(
      await (await exports.default.fetch(api("alpha.localhost", "/api/public/projection"))).json(),
    );
    expect(unchanged.payload.settings.heroHeadline).toBe("Alpha sings");
    expect(unchanged.payload.settings.pageLabels?.history?.heading).toBe("Our beginnings");
    expect(unchanged.payload.settings.heroPosition).toEqual({ x: 25.5, y: 80 });
    expect(unchanged.payload.settings.footerEmbeds).toEqual(footerEmbeds);
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
    expect(revised.payload.settings.heroHeadline).toBe("");
    expect(revised.payload.settings.pageLabels?.history?.heading).toBe("Our new story");
    expect(revised.payload.settings.heroPosition).toEqual({ x: 75, y: 10 });
    expect(revised.version).toBe(2);
    expect(revised.payload.settings.footerText).toBe("New footer");
    expect(revised.payload.settings.footerEmbeds).toEqual([]);
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

  it("serves performance graphic media directly from commerce projection before website republication", async () => {
    const COMMERCE_FILE_ID = "22222222-2222-4222-8222-222222222222";
    const cookie = await signIn();

    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const uploadRes = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${COMMERCE_FILE_ID}`, cookie, {
        body: bytes,
        headers: {
          "content-length": String(bytes.byteLength),
          "content-type": "image/png",
          "x-file-name": "concert-poster.png",
        },
        method: "PUT",
      }),
    );
    expect(uploadRes.status).toBe(201);

    const commerceVenue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "2 Commerce Way", name: "Commerce Hall" },
          cookie,
        )
      ).json(),
    );
    const eventRes = await jsonWrite(
      "alpha.localhost",
      "/api/organization/events",
      "POST",
      {
        advancePriceCents: 2000,
        callTime: "18:00",
        dayOfPriceCents: 2500,
        details: "Call details",
        durationMinutes: 120,
        isTicketingEnabled: true,
        location: "Hall A",
        parentPerformanceId: null,
        publicDetails: "Fall concert info",
        publicGraphicFileId: COMMERCE_FILE_ID,
        publishOnWebsite: false,
        rsvpDeadlineDate: "2030-01-01",
        setList: [],
        setListApproved: false,
        startsAt: "2026-11-01T19:00:00.000Z",
        ticketCapacity: 100,
        title: "Fall Showcase",
        type: "Performance",
        venueId: commerceVenue.id,
      },
      cookie,
    );
    expect(eventRes.status).toBe(201);

    const mediaResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/media/1/${COMMERCE_FILE_ID}`),
    );
    expect(mediaResponse.status).toBe(200);
    expect(mediaResponse.headers.get("content-type")).toBe("image/png");

    const bravoResponse = await exports.default.fetch(
      api("bravo.localhost", `/api/public/media/1/${COMMERCE_FILE_ID}`),
    );
    expect(bravoResponse.status).toBe(404);

    const unknownResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/media/1/33333333-3333-4333-8333-333333333333`),
    );
    expect(unknownResponse.status).toBe(404);
  });
});
