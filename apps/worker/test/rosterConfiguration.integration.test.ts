import {
  organizationProfileResponseSchema,
  organizationRosterConfigurationResponseSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { defaultRosterConfiguration } from "@choir/domain";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "roster.manager@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const apiRequest = (hostname: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(hostname, path, cookie, init);

const provision = (organizationId: string, name: string, slug: string, role: "admin" | "member") =>
  provisionOrganization(controlDatabase, organizationStore, {
    id: organizationId,
    name,
    role,
    slug,
    userId: "roster-manager",
  });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "roster-manager", USER_EMAIL, "Roster Manager");
  await provision("organization-alpha", "Organization Alpha", "alpha", "admin");
  await provision("organization-bravo", "Organization Bravo", "bravo", "member");
});

afterEach(async () => {
  await reset();
});

describe("Organization roster configuration", () => {
  it("converts section-only assignments atomically, keeps performers eligible, and preserves tenant isolation", async () => {
    const cookie = await signIn();
    const sections = [
      { code: "F", name: "Flute", color: "#123456", trackOnly: false },
      { code: "TR", name: "Trumpet", color: "#654321", trackOnly: false },
    ];
    const write = (configuration: unknown, hostname = "alpha.localhost") =>
      exports.default.fetch(
        apiRequest(hostname, "/api/organization/roster-configuration", cookie, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(configuration),
        }),
      );
    expect(
      (
        await write({
          sections,
          voiceParts: [
            { label: "F1", fullName: "Flute 1", sectionCode: "F" },
            { label: "F", fullName: "Trumpet 1", sectionCode: "TR" },
          ],
        })
      ).status,
    ).toBe(200);
    const profileIds: string[] = [];
    for (const voicePart of ["F1", "F"]) {
      const response = await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: `Member ${voicePart}`, voicePart }),
        }),
      );
      expect(response.status).toBe(201);
      profileIds.push(organizationProfileResponseSchema.parse(await response.json()).id);
    }
    const sectionOnly = { rosterStructure: "sections_only", sections };
    const stub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
    await runInDurableObject(stub, (_instance: OrganizationStore, state) => {
      const now = new Date().toISOString();
      const audience = JSON.stringify({
        type: "targeted",
        profileIds: [],
        voiceParts: ["F1", "F"],
      });
      state.storage.sql.exec(
        "INSERT INTO events (id, title, type, starts_at, created_at, updated_at, other_event_audience_json) VALUES ('structure-event', 'Targeted event', 'Other', ?, ?, ?, ?)",
        now,
        now,
        now,
        audience,
      );
      for (const status of ["Draft", "Sent"]) {
        state.storage.sql.exec(
          "INSERT INTO communication_messages (id, channel, status, subject, content_markdown, audience_json, reach_json, created_by, created_at, updated_at) VALUES (?, 'Email', ?, 'Test', '', ?, '{}', 'roster-manager', ?, ?)",
          `structure-${status}`,
          status,
          audience,
          now,
          now,
        );
      }
      state.storage.sql.exec(
        "UPDATE organization_metadata SET seating_configuration_json = ?",
        JSON.stringify({
          defaultFormationId: "parts",
          formations: [
            {
              id: "parts",
              name: "By part",
              isVoicePartLayout: true,
              sectionOrder: ["F1", "F"],
              strategy: "vertical_column",
            },
          ],
        }),
      );
      state.storage.sql.exec(
        "INSERT INTO seating_charts (id, event_id, name, formation_id, row_counts_json, section_suggestions_json, created_at, updated_at) VALUES ('structure-chart', 'structure-event', 'Chairs', 'parts', '[2]', '{\"0-0\":\"F1\",\"0-1\":\"F\"}', ?, ?)",
        now,
        now,
      );
    });
    // A removed parent cannot silently clear or move an existing assignment.
    expect((await write({ ...sectionOnly, sections: [sections[0]] })).status).toBe(409);
    expect((await write(sectionOnly, "bravo.localhost")).status).toBe(403);
    const response = await write(sectionOnly);
    expect(response.status).toBe(200);
    const configuration = organizationRosterConfigurationResponseSchema.parse(
      await response.json(),
    );
    expect(configuration.voiceParts.map(({ label }) => label)).toEqual(["F", "TR"]);
    const references = await runInDurableObject(stub, (_instance: OrganizationStore, state) => ({
      event: JSON.parse(
        state.storage.sql
          .exec<{ readonly audience: string }>(
            "SELECT other_event_audience_json AS audience FROM events WHERE id = 'structure-event'",
          )
          .one().audience,
      ) as unknown,
      draft: JSON.parse(
        state.storage.sql
          .exec<{ readonly audience: string }>(
            "SELECT audience_json AS audience FROM communication_messages WHERE id = 'structure-Draft'",
          )
          .one().audience,
      ) as unknown,
      sent: JSON.parse(
        state.storage.sql
          .exec<{ readonly audience: string }>(
            "SELECT audience_json AS audience FROM communication_messages WHERE id = 'structure-Sent'",
          )
          .one().audience,
      ) as unknown,
      seating: JSON.parse(
        state.storage.sql
          .exec<{ readonly configuration: string }>(
            "SELECT seating_configuration_json AS configuration FROM organization_metadata LIMIT 1",
          )
          .one().configuration,
      ) as unknown,
      suggestions: JSON.parse(
        state.storage.sql
          .exec<{ readonly suggestions: string }>(
            "SELECT section_suggestions_json AS suggestions FROM seating_charts WHERE id = 'structure-chart'",
          )
          .one().suggestions,
      ) as unknown,
    }));
    expect(references.event).toMatchObject({ voiceParts: ["F", "TR"] });
    expect(references.draft).toMatchObject({ voiceParts: ["F", "TR"] });
    expect(references.sent).toMatchObject({ voiceParts: ["F1", "F"] });
    expect(references.seating).toMatchObject({
      formations: [{ isVoicePartLayout: false, sectionOrder: ["F", "TR"] }],
    });
    expect(references.suggestions).toEqual({ "0-0": "F", "0-1": "TR" });
    const assignments = () =>
      runInDurableObject(stub, (_instance: OrganizationStore, state) =>
        state.storage.sql
          .exec<{ readonly voicePart: string }>(
            "SELECT voice_part AS voicePart FROM profiles WHERE display_name LIKE 'Member %' ORDER BY display_name",
          )
          .toArray()
          .map(({ voicePart }) => voicePart),
      );
    expect(await assignments()).toEqual(["TR", "F"]);
    // Repeated saves never cascade overlapping labels, and switching back retains assignments.
    expect((await write(sectionOnly)).status).toBe(200);
    expect(await assignments()).toEqual(["TR", "F"]);
    expect((await write({ ...configuration, rosterStructure: "sections_with_parts" })).status).toBe(
      200,
    );
    expect(await assignments()).toEqual(["TR", "F"]);
    expect(profileIds).toHaveLength(2);
    const bravo = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("bravo.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    expect(bravo.voiceParts).toEqual(defaultRosterConfiguration.voiceParts);
  });

  it("enforces defaults, Profile references, authorization, audit, and isolation", async () => {
    expect(
      await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/roster-configuration"),
      ),
    ).toMatchObject({ status: 401 });
    const cookie = await signIn();
    const defaults = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    expect(defaults).toMatchObject(defaultRosterConfiguration);

    const custom = {
      performerLabel: "Musician",
      sections: [{ code: "H", color: "#123456", name: "High voices", trackOnly: false }],
      voiceParts: [{ fullName: "High voice", label: "High", sectionCode: "H" }],
    };
    const updatedResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie, {
        body: JSON.stringify(custom),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updatedResponse.status).toBe(200);
    expect(
      organizationRosterConfigurationResponseSchema.parse(await updatedResponse.json()),
    ).toMatchObject(custom);

    const invalidProfileResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "Invalid Voice", voicePart: "Missing" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(invalidProfileResponse.status).toBe(400);
    await expect(invalidProfileResponse.json()).resolves.toMatchObject({
      code: "voice_part_not_configured",
    });

    const profileResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "Assigned Singer", voicePart: "High" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(organizationProfileResponseSchema.parse(await profileResponse.json()).voicePart).toBe(
      "High",
    );
    const removalResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie, {
        body: JSON.stringify(defaultRosterConfiguration),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(removalResponse.status).toBe(409);
    await expect(removalResponse.json()).resolves.toMatchObject({ code: "voice_part_in_use" });

    expect(
      await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie, {
          body: JSON.stringify({
            sections: custom.sections,
            voiceParts: [{ ...custom.voiceParts[0], sectionCode: "missing" }],
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await exports.default.fetch(
        apiRequest("bravo.localhost", "/api/organization/roster-configuration", cookie, {
          body: JSON.stringify(custom),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }),
      ),
    ).toMatchObject({ status: 403 });
    const bravo = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("bravo.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    expect(bravo).toMatchObject(defaultRosterConfiguration);

    const stub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
    const auditCount = await runInDurableObject(
      stub,
      (_instance: OrganizationStore, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'organization.roster_configuration.updated'",
          )
          .one().count,
    );
    expect(auditCount).toBe(1);
  });
});
