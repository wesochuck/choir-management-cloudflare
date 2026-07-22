import {
  organizationEventSchema,
  organizationProfileResponseSchema,
  organizationSeatingChartSchema,
  organizationSeatingChartsResponseSchema,
  organizationVenueSchema,
  seatingConfigurationResponseSchema,
  singerSeatingResponseSchema,
} from "@choir/contracts";
import { defaultSeatingConfiguration } from "@choir/domain";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "seating.manager@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function write(
  host: string,
  path: string,
  cookie: string,
  body: unknown,
  method = "POST",
): Promise<Response> {
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    }),
  );
}

async function provision(id: string, slug: string): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 13, ?, ?, ?)`,
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
         VALUES (?, ?, 'seating-manager', 'admin', ?)`,
      )
      .bind(`member-${slug}`, id, Date.now()),
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
  await exports.default.fetch(
    api("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const otp = readCapturedPlatformEmailsForTest()
    .find((message) => message.kind === "email-one-time-code" && message.recipient === USER_EMAIL)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    api("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, otp }),
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
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('seating-manager', 'Seating Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "alpha");
  await provision("organization-bravo", "bravo");
});

afterEach(async () => {
  await reset();
});

describe("Organization seating", () => {
  it("persists safe charts and exposes only roster-gated Organization seating", async () => {
    const cookie = await signIn();
    const defaults = seatingConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/seating-configuration", cookie),
        )
      ).json(),
    );
    expect(defaults.configuration).toEqual(defaultSeatingConfiguration);

    const attending = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Seated Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    const pending = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Pending Singer",
          voicePart: "A1",
        })
      ).json(),
    );
    const bravoProfile = organizationProfileResponseSchema.parse(
      await (
        await write("bravo.localhost", "/api/organization/profiles", cookie, {
          displayName: "Bravo Singer",
          voicePart: "T1",
        })
      ).json(),
    );
    const performance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          title: "Seating Concert",
          type: "Performance",
        })
      ).json(),
    );
    const venue = organizationVenueSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/venues", cookie, {
          address: "13 Seating Lane",
          name: "Seating Hall",
        })
      ).json(),
    );
    await write(
      "alpha.localhost",
      `/api/organization/events/${performance.id}/rsvp`,
      cookie,
      { profileId: attending.id, rsvp: "Yes" },
      "PUT",
    );
    await write(
      "alpha.localhost",
      `/api/organization/events/${performance.id}/rsvp`,
      cookie,
      { profileId: pending.id, rsvp: "Pending" },
      "PUT",
    );
    await database
      .prepare(
        `UPDATE member SET profileId = ?
         WHERE organizationId = 'organization-alpha' AND userId = 'seating-manager'`,
      )
      .bind(attending.id)
      .run();

    const chartRequest = {
      assignments: { "0-0": attending.id },
      formationId: "columns-standard",
      name: "Main Chart",
      rowCounts: [2, 3],
      sectionSuggestions: { "0-0": "S", "0-1": "A" },
      sortOrder: 0,
      venueId: venue.id,
    };
    const createdResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${performance.id}/seating-charts`,
      cookie,
      chartRequest,
    );
    expect(createdResponse.status).toBe(201);
    const created = organizationSeatingChartSchema.parse(await createdResponse.json());
    expect(created).toMatchObject({ ...chartRequest, eventId: performance.id });

    expect(
      await write(
        "alpha.localhost",
        `/api/organization/events/${performance.id}/seating-charts`,
        cookie,
        { ...chartRequest, assignments: { "0-0": pending.id } },
      ),
    ).toMatchObject({ status: 409 });
    expect(
      await write(
        "alpha.localhost",
        `/api/organization/events/${performance.id}/seating-charts`,
        cookie,
        { ...chartRequest, assignments: { "0-0": bravoProfile.id } },
      ),
    ).toMatchObject({ status: 409 });
    expect(
      await write(
        "alpha.localhost",
        `/api/organization/events/${performance.id}/seating-charts`,
        cookie,
        { ...chartRequest, assignments: { "0-0": attending.id, "0-1": attending.id } },
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await write(
        "alpha.localhost",
        `/api/organization/events/${performance.id}/seating-charts`,
        cookie,
        { ...chartRequest, assignments: { "9-9": attending.id } },
      ),
    ).toMatchObject({ status: 400 });
    const disposableChart = organizationSeatingChartSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/events/${performance.id}/seating-charts`,
          cookie,
          { ...chartRequest, assignments: {}, name: "Disposable Chart", sortOrder: 1 },
        )
      ).json(),
    );
    expect(
      await exports.default.fetch(
        api(
          "alpha.localhost",
          `/api/organization/events/${performance.id}/seating-charts/${disposableChart.id}`,
          cookie,
          { method: "DELETE" },
        ),
      ),
    ).toMatchObject({ status: 200 });

    const list = organizationSeatingChartsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/events/${performance.id}/seating-charts`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(list.charts).toHaveLength(1);

    const updatedResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${performance.id}/seating-charts/${created.id}`,
      cookie,
      { ...chartRequest, name: "Updated Chart" },
      "PUT",
    );
    expect(updatedResponse.status).toBe(200);
    expect(organizationSeatingChartSchema.parse(await updatedResponse.json()).name).toBe(
      "Updated Chart",
    );
    expect(
      await exports.default.fetch(
        api("alpha.localhost", `/api/organization/venues/${venue.id}`, cookie, {
          method: "DELETE",
        }),
      ),
    ).toMatchObject({ status: 409 });

    expect(
      await write(
        "alpha.localhost",
        "/api/organization/seating-configuration",
        cookie,
        {
          defaultFormationId: "columns-standard",
          formations: [
            {
              ...defaultSeatingConfiguration.formations[0],
              sectionOrder: ["S", "S"],
            },
          ],
        },
        "PUT",
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await write(
        "alpha.localhost",
        "/api/organization/seating-configuration",
        cookie,
        {
          defaultFormationId: "rows-standard",
          formations: [defaultSeatingConfiguration.formations[1]],
        },
        "PUT",
      ),
    ).toMatchObject({ status: 409 });
    const expandedConfiguration = {
      defaultFormationId: "columns-standard",
      formations: [
        ...defaultSeatingConfiguration.formations,
        {
          id: "soprano-first",
          isVoicePartLayout: false,
          name: "Soprano first",
          sectionOrder: ["S", "A", "T", "B"],
          strategy: "vertical_column" as const,
        },
      ],
    };
    expect(
      seatingConfigurationResponseSchema.parse(
        await (
          await write(
            "alpha.localhost",
            "/api/organization/seating-configuration",
            cookie,
            expandedConfiguration,
            "PUT",
          )
        ).json(),
      ).configuration,
    ).toEqual(expandedConfiguration);

    await database
      .prepare(
        `UPDATE member SET role = 'member'
         WHERE organizationId = 'organization-alpha' AND userId = 'seating-manager'`,
      )
      .run();
    expect(
      await exports.default.fetch(
        api("alpha.localhost", `/api/organization/events/${performance.id}/seating-charts`, cookie),
      ),
    ).toMatchObject({ status: 403 });

    const singerSeating = singerSeatingResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/singer/events/${performance.id}/seating`, cookie),
        )
      ).json(),
    );
    expect(singerSeating).toMatchObject({
      charts: [{ id: created.id, name: "Updated Chart" }],
      profiles: [{ displayName: "Seated Singer", id: attending.id, voicePart: "S1" }],
      selfProfileId: attending.id,
    });
    const compatibilityResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/singer/seating-profiles?eventId=${performance.id}&chartId=${created.id}`,
        cookie,
      ),
    );
    expect(compatibilityResponse.status).toBe(200);
    await expect(compatibilityResponse.json()).resolves.toMatchObject({
      profiles: [{ id: attending.id, name: "Seated Singer", voicePart: "S1" }],
    });
    expect(
      await exports.default.fetch(
        api("bravo.localhost", `/api/singer/events/${performance.id}/seating`, cookie),
      ),
    ).toMatchObject({ status: 404 });

    const auditActions = await runInDurableObject<OrganizationStore, string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE action LIKE 'seating.%' ORDER BY action",
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(auditActions).toEqual([
      "seating.chart.created",
      "seating.chart.created",
      "seating.chart.deleted",
      "seating.chart.updated",
      "seating.configuration.updated",
    ]);
  });
});
