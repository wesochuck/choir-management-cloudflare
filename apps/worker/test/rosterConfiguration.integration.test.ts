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

  it("keeps track-only sections and parts out of roster profile assignments and blocks making in-use parts track-only", async () => {
    const cookie = await signIn();
    const configWithTrackOnly = {
      ...defaultRosterConfiguration,
      sections: [
        { code: "T", color: "#2563eb", name: "Tenor", trackOnly: false },
        { code: "B", color: "#16a34a", name: "Bass", trackOnly: false },
        { code: "O", color: "#9333ea", name: "Other", trackOnly: true },
      ],
      voiceParts: [
        { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
        { fullName: "Bass 1", label: "B1", sectionCode: "B" },
        { fullName: "SATB Recordings", label: "SATB", sectionCode: "O" },
        { fullName: "Two Part", label: "TP", sectionCode: "O" },
      ],
    };

    const updateResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie, {
        body: JSON.stringify(configWithTrackOnly),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updateResponse.status).toBe(200);

    // Creating profile with track-only part label is rejected
    const createTrackOnly = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "Track Only Singer", voicePart: "SATB" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createTrackOnly.status).toBe(400);
    const createTrackOnlyJson = await createTrackOnly.json();
    expect(createTrackOnlyJson).toMatchObject({
      code: "voice_part_not_configured",
    });
    if (
      typeof createTrackOnlyJson === "object" &&
      createTrackOnlyJson !== null &&
      "message" in createTrackOnlyJson &&
      typeof createTrackOnlyJson.message === "string"
    ) {
      expect(createTrackOnlyJson.message).toContain("Configured voice parts: T1, B1.");
      expect(createTrackOnlyJson.message).not.toContain("SATB");
    }

    // Creating profile with track-only full name is also rejected
    const createTrackOnlyFullName = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "Track Only Singer", voicePart: "Two Part" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createTrackOnlyFullName.status).toBe(400);
    expect(await createTrackOnlyFullName.json()).toMatchObject({
      code: "voice_part_not_configured",
    });

    // Creating profile with valid part succeeds
    const createValid = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "Valid Singer", voicePart: "T1" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createValid.status).toBe(201);
    const validProfile = organizationProfileResponseSchema.parse(await createValid.json());
    expect(validProfile.voicePart).toBe("T1");

    // Updating profile to track-only part is rejected
    const updateToTrackOnly = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${validProfile.id}`, cookie, {
        body: JSON.stringify({
          displayName: "Valid Singer Updated",
          voicePart: "SATB",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updateToTrackOnly.status).toBe(400);
    expect(await updateToTrackOnly.json()).toMatchObject({
      code: "voice_part_not_configured",
    });

    // Updating valid profile to another valid part or empty succeeds
    const updateToEmpty = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${validProfile.id}`, cookie, {
        body: JSON.stringify({
          displayName: "Valid Singer Cleared",
          voicePart: "",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updateToEmpty.status).toBe(200);
    expect(organizationProfileResponseSchema.parse(await updateToEmpty.json()).voicePart).toBe("");

    // Reassign back to T1
    await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${validProfile.id}`, cookie, {
        body: JSON.stringify({
          displayName: "Valid Singer",
          voicePart: "T1",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );

    // Pre-seed a legacy profile with track-only part in the DO storage
    const legacyProfileId = "00000000-0000-4000-8000-000000000099";
    const stub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
    await runInDurableObject(stub, (_instance: OrganizationStore, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, phone, voice_part, global_status, notes, show_in_directory, do_not_email, receive_attendance_reports, receive_rsvp_decline_notices, receive_admin_notifications, receive_financial_alerts, is_section_leader, receive_rehearsal_reminders, receive_performance_reminders, receive_other_event_reminders, status_is_manual, status_changed_at, status_change_reason, created_at, updated_at, hidden)
         VALUES (?, 'Legacy Singer', '555-1234', 'SATB', 'Active', '', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '2026-01-01T00:00:00Z', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)`,
        legacyProfileId,
      );
    });

    // Updating unrelated fields on legacy profile without changing voicePart succeeds
    const updateLegacyOtherFields = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${legacyProfileId}`, cookie, {
        body: JSON.stringify({
          displayName: "Legacy Singer Renamed",
          phone: "555-9999",
          voicePart: "SATB",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updateLegacyOtherFields.status).toBe(200);
    const updatedLegacy = organizationProfileResponseSchema.parse(
      await updateLegacyOtherFields.json(),
    );
    expect(updatedLegacy.displayName).toBe("Legacy Singer Renamed");
    expect(updatedLegacy.phone).toBe("555-9999");
    expect(updatedLegacy.voicePart).toBe("SATB");

    // Updating legacy profile to a valid part succeeds
    const fixLegacyPart = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${legacyProfileId}`, cookie, {
        body: JSON.stringify({
          displayName: "Legacy Singer Renamed",
          voicePart: "B1",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(fixLegacyPart.status).toBe(200);
    expect(organizationProfileResponseSchema.parse(await fixLegacyPart.json()).voicePart).toBe(
      "B1",
    );

    // Once fixed, attempting to re-assign SATB is rejected
    const reassignTrackOnly = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${legacyProfileId}`, cookie, {
        body: JSON.stringify({
          displayName: "Legacy Singer Renamed",
          voicePart: "SATB",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(reassignTrackOnly.status).toBe(400);

    // Attempting to toggle in-use section 'T' to trackOnly=true is blocked with 409
    const toggleInUseToTrackOnly = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie, {
        body: JSON.stringify({
          ...configWithTrackOnly,
          sections: [
            { code: "T", color: "#2563eb", name: "Tenor", trackOnly: true },
            { code: "B", color: "#16a34a", name: "Bass", trackOnly: false },
            { code: "O", color: "#9333ea", name: "Other", trackOnly: true },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(toggleInUseToTrackOnly.status).toBe(409);
    expect(await toggleInUseToTrackOnly.json()).toMatchObject({ code: "voice_part_in_use" });

    // Attempting to move in-use part 'T1' into track-only section 'O' is blocked with 409
    const moveInUseToTrackOnly = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie, {
        body: JSON.stringify({
          ...configWithTrackOnly,
          voiceParts: [
            { fullName: "Tenor 1", label: "T1", sectionCode: "O" },
            { fullName: "Bass 1", label: "B1", sectionCode: "B" },
            { fullName: "SATB Recordings", label: "SATB", sectionCode: "O" },
            { fullName: "Two Part", label: "TP", sectionCode: "O" },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(moveInUseToTrackOnly.status).toBe(409);
    expect(await moveInUseToTrackOnly.json()).toMatchObject({ code: "voice_part_in_use" });
  });
});
