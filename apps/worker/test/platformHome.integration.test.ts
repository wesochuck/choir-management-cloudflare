import {
  MAX_PLATFORM_HOME_TICKET_LISTINGS,
  platformHomeTicketListingsResponseSchema,
  platformInquiryResponseSchema,
  type PublicWebsiteProjectionPayload,
} from "@choir/contracts";
import { futureIsoDate, pastIsoDate, provisionOrganization, seedAuthUser } from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import { publishOrganization } from "../src/publication/publishOrganization";

function requireBinding<T>(bindingValue: T | undefined, name: string): T {
  if (bindingValue === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return bindingValue;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const routingCache = requireBinding(env.ROUTING_CACHE, "ROUTING_CACHE");
const organizationStores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const publicationEnv = {
  ORGANIZATION_FILES: organizationFiles,
  ROUTING_CACHE: routingCache,
};

async function provisionAndSeedOrg(
  orgId: string,
  name: string,
  slug: string,
  domainHostname?: string,
  domainKind: "canonical" | "custom_public" = "canonical",
): Promise<void> {
  await provisionOrganization(controlDatabase, organizationStores, {
    id: orgId,
    name,
    role: "admin",
    slug,
    userId: "test-admin",
  });
  if (domainHostname && domainHostname !== `${slug}.localhost`) {
    const now = new Date().toISOString();
    await controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}-custom`, orgId, domainHostname, domainKind, now, now)
      .run();
  }
}

async function seedOrgEvent(
  orgId: string,
  event: {
    readonly id: string;
    readonly title: string;
    readonly startsAt: string;
    readonly isTicketingEnabled?: boolean;
    readonly isArchived?: boolean;
    readonly isCanceled?: boolean;
    readonly type?: "Performance" | "Rehearsal";
    readonly venueName?: string;
    readonly venueAddress?: string;
    readonly publishOnWebsite?: boolean;
  },
): Promise<void> {
  const stub = organizationStores.get(organizationStores.idFromName(orgId));
  await runInDurableObject(stub, (_instance, state) => {
    const now = new Date().toISOString();
    let venueId: string | null = null;
    if (event.venueName) {
      venueId = `venue-${event.id}`;
      state.storage.sql.exec(
        `INSERT OR REPLACE INTO venues (id, name, address, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        venueId,
        event.venueName,
        event.venueAddress ?? "123 Main St",
        now,
        now,
      );
    }
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO events (
        id, title, type, starts_at, duration_minutes, call_time, location,
        venue_id, parent_performance_id, details, set_list_json, set_list_approved,
        is_archived, is_canceled, publish_on_website, is_ticketing_enabled,
        advance_price_cents, day_of_price_cents, ticket_capacity, doors_open_time,
        public_details, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, 90, '18:00', 'Hall',
        ?, NULL, '', '[]', 0,
        ?, ?, ?, ?,
        1500, 2000, 250, '19:00',
        'Public details', ?, ?
      )`,
      event.id,
      event.title,
      event.type ?? "Performance",
      event.startsAt,
      venueId,
      event.isArchived ? 1 : 0,
      event.isCanceled ? 1 : 0,
      event.publishOnWebsite === false ? 0 : 1,
      event.isTicketingEnabled === false ? 0 : 1,
      now,
      now,
    );
  });
}

async function seedPlatformAdmin(userId: string, email: string): Promise<void> {
  const now = "2026-07-21T12:00:00.000Z";
  await controlDatabase.batch([
    controlDatabase
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, 'Admin User', ?, 1, ?, ?)`,
      )
      .bind(userId, email, now, now),
    controlDatabase
      .prepare(
        `INSERT INTO platform_administrators (user_id, granted_by, granted_at)
         VALUES (?, 'system', ?)`,
      )
      .bind(userId, now),
  ]);
}

function samplePayload(
  orgName: string,
  performances: PublicWebsiteProjectionPayload["performances"],
): PublicWebsiteProjectionPayload {
  return {
    mediaFileIds: [],
    organizationName: orgName,
    performances,
    settings: {
      aboutUsText: "",
      bodyFont: "system",
      contactEmail: "",
      enabledNavigation: ["tickets"],
      headerFont: "system",
      heroFileId: null,
      heroHeadline: `Welcome to ${orgName}`,
      heroSubtitle: "Voices united in harmony.",
      historyText: "",
      logoFileId: null,
      showBrandingHeaderFooter: false,
    },
    ticketBundles: [],
    timezone: "America/New_York",
  };
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "test-admin", "admin@example.test", "Test Admin");
});

afterEach(async () => {
  await reset();
});

describe("Platform home routes", () => {
  it("case 1: aggregates upcoming ticketed performances for an org that never published a website", async () => {
    await provisionAndSeedOrg(
      "org-lancaster",
      "Lancaster Community Chorus",
      "lancaster",
      "tickets.lancasterchorus.org",
      "custom_public",
    );

    const eventIdUpcomingTicketed = "11111111-1111-4111-8111-111111111111";

    await seedOrgEvent("org-lancaster", {
      id: eventIdUpcomingTicketed,
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 14 }),
      title: "Winter Masterworks",
      venueName: "Fairfield County Heritage Hall",
    });

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(response.status).toBe(200);

    const body = platformHomeTicketListingsResponseSchema.parse(await response.json());
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]).toMatchObject({
      eventId: eventIdUpcomingTicketed,
      organizationName: "Lancaster Community Chorus",
      ticketsUrl: `https://tickets.lancasterchorus.org/tickets/${eventIdUpcomingTicketed}`,
      title: "Winter Masterworks",
      venueName: "Fairfield County Heritage Hall",
    });

    const firstListing = body.listings[0];
    expect(firstListing).toBeDefined();
    if (!firstListing) throw new Error("Missing expected listing");

    const ticketDetailResponse = await exports.default.fetch(new Request(firstListing.ticketsUrl));
    expect(ticketDetailResponse.status).toBe(200);

    const commerceResponse = await exports.default.fetch(
      new Request("https://tickets.lancasterchorus.org/api/public/commerce-projection"),
    );
    expect(commerceResponse.status).toBe(200);
  });

  it("case 2: includes future ticketed Performance with publishOnWebsite=false", async () => {
    await provisionAndSeedOrg("org-alpha", "Alpha Chorus", "alpha");
    const eventId = "22222222-2222-4222-8222-222222222222";

    await seedOrgEvent("org-alpha", {
      id: eventId,
      isTicketingEnabled: true,
      publishOnWebsite: false,
      startsAt: futureIsoDate({ days: 7 }),
      title: "Unpublished Website Concert",
    });

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(response.status).toBe(200);
    const body = platformHomeTicketListingsResponseSchema.parse(await response.json());
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]?.title).toBe("Unpublished Website Concert");
  });

  it("case 3: reflects live store state rather than stale published website snapshot", async () => {
    await provisionAndSeedOrg("org-stale", "Stale Chorus", "stale");
    const eventId = "33333333-3333-4333-8333-333333333333";

    await seedOrgEvent("org-stale", {
      id: eventId,
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 10 }),
      title: "Initial Live Title",
    });

    await publishOrganization(publicationEnv, {
      generatedAt: new Date().toISOString(),
      organizationId: "org-stale",
      payload: samplePayload("Stale Chorus", [
        {
          advancePriceCents: 1500,
          dayOfPriceCents: 2000,
          doorsOpenTime: "19:00",
          graphicFileId: null,
          id: eventId,
          isTicketingEnabled: true,
          location: "Old Hall",
          publicDetails: "Old details",
          startsAt: futureIsoDate({ days: 10 }),
          ticketCapacity: 250,
          title: "Stale Snapshot Title",
          venueAddress: "",
          venueName: "Old Hall",
        },
      ]),
      version: 1,
    });

    const stub = organizationStores.get(organizationStores.idFromName("org-stale"));
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE events SET title = 'Updated Fresh Title' WHERE id = ?",
        eventId,
      );
    });

    await routingCache.delete("platform:tickets:feed");

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(response.status).toBe(200);
    const body = platformHomeTicketListingsResponseSchema.parse(await response.json());
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]?.title).toBe("Updated Fresh Title");

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE events SET is_canceled = 1 WHERE id = ?", eventId);
    });
    await routingCache.delete("platform:tickets:feed");

    const canceledResponse = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(canceledResponse.status).toBe(200);
    const canceledBody = platformHomeTicketListingsResponseSchema.parse(
      await canceledResponse.json(),
    );
    expect(canceledBody.listings).toHaveLength(0);
  });

  it("case 4: excludes past, canceled, archived, non-Performance and ticketing-disabled events", async () => {
    await provisionAndSeedOrg("org-multi", "Multi Event Chorus", "multi");

    await seedOrgEvent("org-multi", {
      id: "44444444-4444-4444-8444-111111111111",
      isTicketingEnabled: true,
      startsAt: pastIsoDate({ days: 2 }),
      title: "Past Concert",
    });

    await seedOrgEvent("org-multi", {
      id: "44444444-4444-4444-8444-222222222222",
      isCanceled: true,
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 5 }),
      title: "Canceled Concert",
    });

    await seedOrgEvent("org-multi", {
      id: "44444444-4444-4444-8444-333333333333",
      isArchived: true,
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 6 }),
      title: "Archived Concert",
    });

    await seedOrgEvent("org-multi", {
      id: "44444444-4444-4444-8444-444444444444",
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 7 }),
      title: "Rehearsal Event",
      type: "Rehearsal",
    });

    await seedOrgEvent("org-multi", {
      id: "44444444-4444-4444-8444-555555555555",
      isTicketingEnabled: false,
      startsAt: futureIsoDate({ days: 8 }),
      title: "Free Community Sing",
    });

    const validId = "44444444-4444-4444-8444-666666666666";
    await seedOrgEvent("org-multi", {
      id: validId,
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 9 }),
      title: "Upcoming Gala Performance",
    });

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(response.status).toBe(200);
    const body = platformHomeTicketListingsResponseSchema.parse(await response.json());
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]?.eventId).toBe(validId);
    expect(body.listings[0]?.title).toBe("Upcoming Gala Performance");
  });

  it("case 5: excludes inactive organizations, inactive domains, and invalid domains", async () => {
    await provisionAndSeedOrg("org-suspended", "Suspended Org", "suspended");
    await controlDatabase
      .prepare("UPDATE organizations SET lifecycle_state = 'suspended' WHERE id = 'org-suspended'")
      .run();
    await seedOrgEvent("org-suspended", {
      id: "55555555-5555-4555-8555-111111111111",
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 10 }),
      title: "Suspended Concert",
    });

    await provisionAndSeedOrg("org-inactive-dom", "Inactive Domain Org", "inactivedom");
    await controlDatabase
      .prepare(
        "UPDATE organization_domains SET status = 'pending' WHERE organization_id = 'org-inactive-dom'",
      )
      .run();
    await seedOrgEvent("org-inactive-dom", {
      id: "55555555-5555-4555-8555-222222222222",
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 10 }),
      title: "Inactive Domain Concert",
    });

    await provisionAndSeedOrg("org-invalid-host", "Invalid Host Org", "invalidhost");
    await controlDatabase
      .prepare(
        "UPDATE organization_domains SET hostname = 'invalid host with spaces' WHERE organization_id = 'org-invalid-host'",
      )
      .run();
    await seedOrgEvent("org-invalid-host", {
      id: "55555555-5555-4555-8555-333333333333",
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 10 }),
      title: "Invalid Host Concert",
    });

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(response.status).toBe(200);
    const body = platformHomeTicketListingsResponseSchema.parse(await response.json());
    expect(body.listings).toHaveLength(0);
  });

  it("case 6: prefers valid custom public domain and does not starve other organizations when one has many domains", async () => {
    await provisionAndSeedOrg(
      "org-alpha-domains",
      "Alpha Society",
      "alphadom",
      "tickets.alphachoir.org",
      "custom_public",
    );

    const nowIso = new Date().toISOString();
    for (let i = 1; i <= 25; i++) {
      const indexStr = String(i);
      await controlDatabase
        .prepare(
          `INSERT INTO organization_domains
            (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
           VALUES (?, 'org-alpha-domains', ?, 'custom_public', 'active', 1, ?, ?)`,
        )
        .bind(`domain-extra-${indexStr}`, `extra${indexStr}.alphachoir.org`, nowIso, nowIso)
        .run();
    }

    await provisionAndSeedOrg("org-bravo-domains", "Bravo Society", "bravodom");

    const eventAlpha = "66666666-6666-4666-8666-111111111111";
    const eventBravo = "66666666-6666-4666-8666-222222222222";

    await seedOrgEvent("org-alpha-domains", {
      id: eventAlpha,
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 10 }),
      title: "Alpha Symphony",
    });

    await seedOrgEvent("org-bravo-domains", {
      id: eventBravo,
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 12 }),
      title: "Bravo Symphony",
    });

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(response.status).toBe(200);
    const body = platformHomeTicketListingsResponseSchema.parse(await response.json());

    expect(body.listings).toHaveLength(2);
    const alphaListing = body.listings.find((l) => l.eventId === eventAlpha);
    const bravoListing = body.listings.find((l) => l.eventId === eventBravo);

    expect(alphaListing).toBeDefined();
    expect(bravoListing).toBeDefined();

    expect(alphaListing?.ticketsUrl).toBe(`https://tickets.alphachoir.org/tickets/${eventAlpha}`);
    expect(bravoListing?.ticketsUrl).toBe(`https://bravodom.localhost/tickets/${eventBravo}`);
  });

  it("case 7: handles one organization RPC failure without failing healthy organizations and caches partial results only briefly", async () => {
    await provisionAndSeedOrg("org-healthy", "Healthy Chorus", "healthy");
    const healthyEventId = "77777777-7777-4777-8777-111111111111";
    await seedOrgEvent("org-healthy", {
      id: healthyEventId,
      isTicketingEnabled: true,
      startsAt: futureIsoDate({ days: 15 }),
      title: "Healthy Performance",
    });

    const now = new Date().toISOString();
    await controlDatabase.batch([
      controlDatabase
        .prepare(
          `INSERT INTO organizations
            (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
             created_at, updated_at)
           VALUES ('org-unhealthy', 'Unhealthy Chorus', 'unhealthy', 'active', 'org-unhealthy', 1, ?, ?)`,
        )
        .bind(now, now),
      controlDatabase
        .prepare(
          `INSERT INTO organization_domains
            (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
           VALUES ('domain-unhealthy', 'org-unhealthy', 'unhealthy.localhost', 'canonical', 'active', 1, ?, ?)`,
        )
        .bind(now, now),
    ]);

    await routingCache.delete("platform:tickets:feed");

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(response.status).toBe(200);
    const body = platformHomeTicketListingsResponseSchema.parse(await response.json());
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]?.eventId).toBe(healthyEventId);

    const cachedFeed = await routingCache.get("platform:tickets:feed");
    // Partial feeds cache only briefly (short TTL) to bound per-request RPC
    // fan-out during an outage — never for the normal five-minute TTL.
    expect(cachedFeed).not.toBeNull();
    const cachedListings: unknown = JSON.parse(cachedFeed ?? "[]");
    expect(Array.isArray(cachedListings)).toBe(true);
    expect(cachedListings).toHaveLength(1);

    // A follow-up request still serves the healthy listing (from the briefly
    // cached partial feed, re-filtered by current time).
    const retryResponse = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(retryResponse.status).toBe(200);
    const retryBody = platformHomeTicketListingsResponseSchema.parse(await retryResponse.json());
    expect(retryBody.listings).toHaveLength(1);
    expect(retryBody.listings[0]?.eventId).toBe(healthyEventId);
  });

  it("case 8: sorts deterministically by startsAt, caps at 24 items, and re-filters cached feed on read", async () => {
    await provisionAndSeedOrg("org-cap", "Cap Chorus", "cap");

    for (let i = 1; i <= 26; i++) {
      const pad = String(i).padStart(2, "0");
      const indexStr = String(i);
      await seedOrgEvent("org-cap", {
        id: `88888888-8888-4888-8888-${pad}0000000000`,
        isTicketingEnabled: true,
        startsAt: futureIsoDate({ days: 30 - i }),
        title: `Performance #${indexStr}`,
      });
    }

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(response.status).toBe(200);
    const body = platformHomeTicketListingsResponseSchema.parse(await response.json());

    expect(body.listings).toHaveLength(MAX_PLATFORM_HOME_TICKET_LISTINGS);
    expect(MAX_PLATFORM_HOME_TICKET_LISTINGS).toBe(24);

    for (let i = 0; i < body.listings.length - 1; i++) {
      const current = body.listings[i];
      const next = body.listings[i + 1];
      if (current && next) {
        expect(new Date(current.startsAt).getTime()).toBeLessThanOrEqual(
          new Date(next.startsAt).getTime(),
        );
      }
    }

    const testEventPast = "99999999-9999-4999-8999-111111111111";
    const testEventFuture = "99999999-9999-4999-8999-222222222222";
    const manualCachedListings = [
      {
        eventId: testEventPast,
        organizationName: "Cap Chorus",
        startsAt: pastIsoDate({ days: 1 }),
        ticketsUrl: `https://cap.localhost/tickets/${testEventPast}`,
        timezone: "America/New_York",
        title: "Just Passed Concert",
        venueName: "Music Hall",
      },
      {
        eventId: testEventFuture,
        organizationName: "Cap Chorus",
        startsAt: futureIsoDate({ days: 3 }),
        ticketsUrl: `https://cap.localhost/tickets/${testEventFuture}`,
        timezone: "America/New_York",
        title: "Future Concert",
        venueName: "Music Hall",
      },
    ];

    await routingCache.put("platform:tickets:feed", JSON.stringify(manualCachedListings), {
      expirationTtl: 300,
    });

    const cachedResponse = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/tickets"),
    );
    expect(cachedResponse.status).toBe(200);
    const cachedBody = platformHomeTicketListingsResponseSchema.parse(await cachedResponse.json());
    expect(cachedBody.listings).toHaveLength(1);
    expect(cachedBody.listings[0]?.eventId).toBe(testEventFuture);
  });

  it("handles nonprofit inquiry submission and emails active platform admins", async () => {
    await seedPlatformAdmin("admin-1", "admin@musicsite.org");

    const validInquiry = {
      contactName: "Sarah Miller",
      email: "sarah@fairfieldarts.org",
      location: "Lancaster, OH",
      message: "We're a 501(c)(3) vocal ensemble interested in managing our singers here.",
      organizationName: "Fairfield Vocal Arts",
    };

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/inquire", {
        body: JSON.stringify(validInquiry),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    const body = platformInquiryResponseSchema.parse(await response.json());
    expect(body.accepted).toBe(true);

    const emails = readCapturedPlatformEmailsForTest();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      kind: "platform-inquiry",
      recipient: "admin@musicsite.org",
      replyTo: "sarah@fairfieldarts.org",
      subject: "[Choir Management] Nonprofit Inquiry: Fairfield Vocal Arts",
    });
    expect(emails[0]?.text).toContain("Sarah Miller");
    expect(emails[0]?.text).toContain("Fairfield Vocal Arts");
  });

  it("silently swallows automated submissions when the honeypot field is filled", async () => {
    await seedPlatformAdmin("admin-1", "admin@musicsite.org");

    const botInquiry = {
      contactName: "Spam Bot",
      email: "bot@spam.com",
      message: "Buy cheap backlinks",
      organizationName: "Spam Corp",
      website: "https://spam.com",
    };

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/inquire", {
        body: JSON.stringify(botInquiry),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    const body = platformInquiryResponseSchema.parse(await response.json());
    expect(body.accepted).toBe(true);

    const emails = readCapturedPlatformEmailsForTest();
    expect(emails).toHaveLength(0);
  });

  it("rejects invalid inquiries with 400 validation_failed", async () => {
    const invalidInquiry = {
      contactName: "",
      email: "not-an-email",
      organizationName: "",
    };

    const response = await exports.default.fetch(
      new Request("http://localhost/api/public/platform/inquire", {
        body: JSON.stringify(invalidInquiry),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ code: "validation_failed" });
  });
});
