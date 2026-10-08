import {
  platformHomeTicketListingsResponseSchema,
  platformInquiryResponseSchema,
  type PublicWebsiteProjectionPayload,
} from "@choir/contracts";
import { futureIsoDate, pastIsoDate } from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
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

const publicationEnv = {
  ORGANIZATION_FILES: organizationFiles,
  ROUTING_CACHE: routingCache,
};

async function seedOrganizationWithDomain(
  orgId: string,
  name: string,
  slug: string,
  hostname: string,
  kind: "canonical" | "custom_public" = "canonical",
): Promise<void> {
  const now = "2026-07-21T12:00:00.000Z";
  await controlDatabase.batch([
    controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, 1, ?, ?)`,
      )
      .bind(orgId, name, slug, orgId, now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, orgId, hostname, kind, now, now),
  ]);
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
});

afterEach(async () => {
  await reset();
});

describe("Platform home routes", () => {
  it("aggregates upcoming ticketed performances across published organizations", async () => {
    await seedOrganizationWithDomain(
      "org-lancaster",
      "Lancaster Community Chorus",
      "lancaster",
      "tickets.lancasterchorus.org",
      "custom_public",
    );

    const eventIdUpcomingTicketed = "11111111-1111-4111-8111-111111111111";
    const eventIdPast = "22222222-2222-4222-8222-222222222222";
    const eventIdFree = "33333333-3333-4333-8333-333333333333";

    await publishOrganization(publicationEnv, {
      generatedAt: "2026-07-21T12:00:00.000Z",
      organizationId: "org-lancaster",
      payload: samplePayload("Lancaster Community Chorus", [
        {
          advancePriceCents: 1500,
          dayOfPriceCents: 2000,
          doorsOpenTime: "19:00",
          graphicFileId: null,
          id: eventIdUpcomingTicketed,
          isTicketingEnabled: true,
          location: "Fairfield County Heritage Hall",
          publicDetails: "Our winter concert.",
          startsAt: futureIsoDate({ days: 14 }),
          ticketCapacity: 250,
          title: "Winter Masterworks",
          venueAddress: "123 Main St, Lancaster, OH",
          venueName: "Fairfield County Heritage Hall",
        },
        {
          advancePriceCents: 1500,
          dayOfPriceCents: 2000,
          doorsOpenTime: "19:00",
          graphicFileId: null,
          id: eventIdPast,
          isTicketingEnabled: true,
          location: "Hall",
          publicDetails: "Past show.",
          startsAt: pastIsoDate({ days: 10 }),
          ticketCapacity: 250,
          title: "Fall Showcase",
          venueAddress: "",
          venueName: "Hall",
        },
        {
          advancePriceCents: 0,
          dayOfPriceCents: 0,
          doorsOpenTime: "14:00",
          graphicFileId: null,
          id: eventIdFree,
          isTicketingEnabled: false,
          location: "Park",
          publicDetails: "Free community singing.",
          startsAt: futureIsoDate({ days: 7 }),
          ticketCapacity: null,
          title: "Sing in the Park",
          venueAddress: "",
          venueName: "Park Gazebo",
        },
      ]),
      version: 1,
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

    // No email should be sent!
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
