import { readCommunicationDeliveryJob } from "../src/organization/organizationCommunications";
import { parseRosterCsv } from "@choir/domain";
import {
  organizationProfileSchema,
  organizationProfileResponseSchema,
  organizationProfileDeleteResponseSchema,
  organizationProfileImportResponseSchema,
  organizationProfileDeliveriesResponseSchema,
  organizationProfilesResponseSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "profile.manager@example.test";

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
    userId: "profile-manager",
  });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "profile-manager", USER_EMAIL, "Profile Manager");
  await provision("organization-alpha", "Organization Alpha", "alpha", "admin");
  await provision("organization-bravo", "Organization Bravo", "bravo", "member");
});

afterEach(async () => {
  await reset();
});

describe("Organization Profiles", () => {
  it("rejects suppressed email recipients before Profile creation or CSV import", async () => {
    await controlDatabase
      .prepare(
        `INSERT INTO email_recipient_suppressions
          (email_normalized, reason, source_event_id, provider_message_id, detail, active, created_at, updated_at)
         VALUES (?, 'bounce', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        "suppressed@example.test",
        "event-profile-guard",
        "provider-profile-guard",
        "Mailbox unavailable",
        "2026-08-06T12:00:00.000Z",
        "2026-08-06T12:00:00.000Z",
      )
      .run();
    const cookie = await signIn();
    const createResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({
          displayName: "Suppressed Singer",
          email: "SUPPRESSED@example.test",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createResponse.status).toBe(409);
    expect(await createResponse.json()).toMatchObject({
      code: "email_recipient_suppressed",
      message: expect.stringContaining("Platform Administrator"),
    });

    const importResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/import", cookie, {
        body: "Name,Email\nSuppressed Import,suppressed@example.test",
        headers: { "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(importResponse.status).toBe(409);
    expect(
      await runInDurableObject<OrganizationStore, number>(
        organizationStore.get(organizationStore.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>("SELECT COUNT(*) AS count FROM profiles")
            .one().count,
      ),
    ).toBe(0);
  });

  it("round-trips no-account CSV contact details, rejects collisions, and reaches Members without a part", async () => {
    const cookie = await signIn();
    const csv =
      "Name,Last Name,Email,Phone,Performer,Status\nFirst Person,Person,first@example.test,,,Active\nMiddle Person,Person,middle@example.test,+12025550123,T1,Active\nThird Person,Person,third@example.test,,,Active";
    const upload = () =>
      exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/profiles/import", cookie, {
          method: "POST",
          headers: { "content-type": "text/csv" },
          body: csv,
        }),
      );
    const imported = await upload();
    expect(imported.status).toBe(201);
    expect(await imported.json()).toMatchObject({
      imported: 3,
      emailsPersisted: 3,
      phonesPersisted: 1,
      conflicts: [],
    });
    const list = async () =>
      organizationProfilesResponseSchema.parse(
        await (
          await exports.default.fetch(
            apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
          )
        ).json(),
      ).profiles;
    const profiles = await list();
    expect(profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "First Person",
          email: "first@example.test",
          phone: "",
          voicePart: "",
        }),
        expect.objectContaining({
          displayName: "Middle Person",
          email: "middle@example.test",
          phone: "+12025550123",
          voicePart: "T1",
        }),
        expect.objectContaining({
          displayName: "Third Person",
          email: "third@example.test",
          phone: "",
          voicePart: "",
        }),
      ]),
    );
    const middle = profiles.find((profile) => profile.displayName === "Middle Person");
    if (!middle) throw new Error("Missing imported Profile");
    const update = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${middle.id}`, cookie, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...middle, email: "changed@example.test", notes: "Edited" }),
      }),
    );
    expect(update.status).toBe(200);
    expect((await list()).find((profile) => profile.id === middle.id)).toMatchObject({
      email: "changed@example.test",
      phone: "+12025550123",
      notes: "Edited",
    });
    const exported = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/export.csv", cookie),
    );
    expect(exported.status).toBe(200);
    const exportedCsv = await exported.text();
    expect(exportedCsv).toContain("changed@example.test");
    expect(
      parseRosterCsv(exportedCsv).find((profile) => profile.displayName === "Middle Person"),
    ).toMatchObject({ email: "changed@example.test", phone: "+12025550123" });
    const retry = await upload();
    expect(await retry.json()).toMatchObject({
      imported: 1,
      emailsPersisted: 1,
      conflicts: [expect.objectContaining({ row: 2 }), expect.objectContaining({ row: 4 })],
    });
    // Neither a roster save nor an import creates account access or invitations.
    expect(
      await controlDatabase.prepare("SELECT COUNT(*) AS count FROM user").first<number>("count"),
    ).toBe(1);
    expect(
      await controlDatabase
        .prepare("SELECT COUNT(*) AS count FROM invitation")
        .first<number>("count"),
    ).toBe(0);
    const audience = {
      targetAudiences: ["Members"],
      globalStatuses: ["Active"],
      voiceParts: [],
      profileIds: [],
      eventId: null,
      rsvp: "All",
    };
    const preview = async (voiceParts: string[]) =>
      exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audience: { ...audience, voiceParts }, channel: "Email" }),
        }),
      );
    const reach = await preview([]);
    expect(reach.status).toBe(200);
    expect(await reach.json()).toMatchObject({ email: 4, total: 4 });
    expect(await (await preview(["T1"])).json()).toMatchObject({ email: 2, total: 2 });
    const sent = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/communications/send", cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          audience: { ...audience, targetAudiences: ["Members", "Contacts"] },
          channel: "Email",
          subject: "Choir update",
          contentMarkdown: "Hello {recipientName}",
        }),
      }),
    );
    expect(sent.status).toBe(202);
    const deliveries = await runInDurableObject<
      OrganizationStore,
      { destination: string; unsubscribeUrl: string }[]
    >(
      organizationStore.get(organizationStore.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ destination: string; unsubscribeUrl: string }>(
            "SELECT destination, unsubscribe_url AS unsubscribeUrl FROM communication_deliveries ORDER BY destination",
          )
          .toArray(),
    );
    // Members + Contacts is one delivery per destination, including no-part Profiles.
    expect(deliveries.map((delivery) => delivery.destination)).toEqual([
      "changed@example.test",
      "first@example.test",
      "middle@example.test",
      "third@example.test",
    ]);
    const firstDelivery = deliveries.find(
      (delivery) => delivery.destination === "first@example.test",
    );
    if (!firstDelivery) throw new Error("Missing unlinked Profile delivery");
    const token = new URL(firstDelivery.unsubscribeUrl).searchParams.get("token");
    const unsubscribe = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/public/unsubscribe", undefined, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    expect(unsubscribe.status).toBe(200);
    const jobId = await runInDurableObject<OrganizationStore, string>(
      organizationStore.get(organizationStore.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ jobId: string }>(
            "SELECT job_id AS jobId FROM scheduled_job_outbox WHERE kind = 'communication_delivery' LIMIT 1",
          )
          .one().jobId,
    );
    const job = await readCommunicationDeliveryJob(env, "organization-alpha", jobId);
    expect(job.deliveries.map((delivery) => delivery.destination)).not.toContain(
      "first@example.test",
    );
    expect(job.deliveries).toHaveLength(3);
    const other = await exports.default.fetch(
      apiRequest("bravo.localhost", "/api/organization/profiles", cookie),
    );
    expect(other.status).toBe(403);
  });

  it("imports Profiles atomically without creating login identities", async () => {
    const cookie = await signIn();
    const response = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/import", cookie, {
        body: [
          "Name,Email,Phone,Voice Part,Status,Notes,Section Leader",
          '"Singer, One",one@example.test,555-0101,S1,Active,"First line\nSecond line",yes',
          "Singer Two,,555-0102,A2,On Break,,no",
        ].join("\n"),
        headers: { "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    expect(organizationProfileImportResponseSchema.parse(await response.json())).toMatchObject({
      imported: 2,
      emailsPersisted: 1,
      phonesPersisted: 2,
      conflicts: [],
    });
    const profiles = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
        )
      ).json(),
    ).profiles;
    expect(profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Singer, One",
          email: "one@example.test",
          phone: "555-0101",
          isSectionLeader: true,
          notes: "First line\nSecond line",
          voicePart: "S1",
        }),
        expect.objectContaining({
          displayName: "Singer Two",
          globalStatus: "Idle",
          voicePart: "A2",
        }),
      ]),
    );
    expect(
      await controlDatabase.prepare("SELECT COUNT(*) AS count FROM user").first<number>("count"),
    ).toBe(1);
    expect(
      await runInDurableObject<OrganizationStore, number>(
        organizationStore.get(organizationStore.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'profile.imported'",
            )
            .one().count,
      ),
    ).toBe(2);

    const rejected = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/import", cookie, {
        body: "Name,Voice Part\nValid Singer,S1\nInvalid Singer,NotConfigured",
        headers: { "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      code: "validation_failed",
      message:
        'Unrecognized voice part "NotConfigured" on row 3. Configured voice parts: S1, S2, A1, A2, T1, T2, B1, B2.',
    });
    const afterRejected = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
        )
      ).json(),
    ).profiles;
    expect(afterRejected).toHaveLength(2);

    const fullNamesImport = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/import", cookie, {
        body: "Name,Voice Part\nSoprano Singer,Soprano 1\nAlto Singer, alto 2 \nTenor Singer,t1",
        headers: { "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(fullNamesImport.status).toBe(201);
    const updatedProfiles = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
        )
      ).json(),
    ).profiles;
    expect(updatedProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: "Soprano Singer", voicePart: "S1" }),
        expect.objectContaining({ displayName: "Alto Singer", voicePart: "A2" }),
        expect.objectContaining({ displayName: "Tenor Singer", voicePart: "T1" }),
      ]),
    );
  });

  it("creates and lists Profiles only within the canonical authenticated Organization", async () => {
    expect(
      await exports.default.fetch(apiRequest("alpha.localhost", "/api/organization/profiles")),
    ).toMatchObject({ status: 401 });
    const cookie = await signIn();
    const createdResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "  Alpha Singer  " }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createdResponse.status).toBe(201);
    const created = organizationProfileResponseSchema.parse(await createdResponse.json());
    expect(created.displayName).toBe("Alpha Singer");

    const updatedResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${created.id}`, cookie, {
        body: JSON.stringify({
          displayName: 'Alpha "Ace", Singer',
          doNotEmail: true,
          globalStatus: "Idle",
          isSectionLeader: true,
          notes: "On Break through September",
          phone: "555-0100",
          receiveAdminNotifications: false,
          receiveAttendanceReports: false,
          receiveFinancialAlerts: true,
          receiveRsvpDeclineNotices: true,
          showInDirectory: false,
          voicePart: "S1",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updatedResponse.status).toBe(200);
    const updated = organizationProfileResponseSchema.parse(await updatedResponse.json());
    expect(updated).toMatchObject({
      displayName: 'Alpha "Ace", Singer',
      doNotEmail: true,
      globalStatus: "Idle",
      isSectionLeader: true,
      notes: "On Break through September",
      phone: "555-0100",
      showInDirectory: false,
      voicePart: "S1",
    });
    await controlDatabase
      .prepare(
        `UPDATE member SET profileId = ?
         WHERE organizationId = 'organization-alpha' AND userId = 'profile-manager'`,
      )
      .bind(created.id)
      .run();

    const rosterExport = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles/export.csv", cookie),
    );
    expect(rosterExport.status).toBe(200);
    expect(rosterExport.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(rosterExport.headers.get("cache-control")).toBe("private, no-store");
    expect(rosterExport.headers.get("content-disposition")).toMatch(
      /^attachment; filename="choir_roster_export_[0-9]{4}-[A-Z][a-z]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}-(AM|PM)-UTC\.csv"$/,
    );
    expect(await rosterExport.text()).toBe(
      [
        "Name,Last Name,Email,Phone,Performer,Status",
        '"Alpha ""Ace"", Singer","Singer","profile.manager@example.test","555-0100","S1","Idle"',
        "",
        '"Section Leaders","","","","",""',
        "Name,Last Name,Email,Phone,Performer,Status",
        '"Alpha ""Ace"", Singer","Singer","profile.manager@example.test","555-0100","S1","Idle"',
      ].join("\n"),
    );
    expect(
      await exports.default.fetch(
        apiRequest("bravo.localhost", "/api/organization/profiles/export.csv", cookie),
      ),
    ).toMatchObject({ status: 403 });

    const alphaList = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
        )
      ).json(),
    );
    expect(alphaList.profiles).toEqual([organizationProfileSchema.parse(updated)]);
    expect(
      await exports.default.fetch(
        apiRequest("bravo.localhost", "/api/organization/profiles", cookie),
      ),
    ).toMatchObject({ status: 403 });
    expect(
      await exports.default.fetch(
        apiRequest("bravo.localhost", "/api/organization/profiles", cookie, {
          body: JSON.stringify({ displayName: "Forbidden Singer" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    ).toMatchObject({ status: 403 });

    const auditCount = await runInDurableObject<OrganizationStore, number>(
      organizationStore.get(organizationStore.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM audit_events
             WHERE action IN ('profile.created', 'profile.updated') AND target_id = ?
               AND actor_id = 'profile-manager'`,
            created.id,
          )
          .one().count,
    );
    expect(auditCount).toBe(2);
  });

  it.each(["keep", "delete_unused"] as const)(
    "deletes CSV-imported Profiles with contact policy %s atomically and in one Organization",
    async (contacts) => {
      const cookie = await signIn();
      const imported = await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/profiles/import", cookie, {
          method: "POST",
          headers: { "content-type": "text/csv" },
          body: "Name,Email,Phone\nImported Person,import-delete@example.test,+12025550123",
        }),
      );
      expect(imported.status).toBe(201);
      const list = await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
      );
      const profile = organizationProfilesResponseSchema
        .parse(await list.json())
        .profiles.find((p) => p.email === "import-delete@example.test");
      if (!profile) throw new Error("Imported profile missing");
      const alphaStub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
      const bravoStub = organizationStore.get(organizationStore.idFromName("organization-bravo"));
      const contactId = await runInDurableObject<OrganizationStore, string>(
        alphaStub,
        (_instance, state) => {
          const id = state.storage.sql
            .exec<{ id: string }>("SELECT id FROM contacts WHERE profile_id = ?", profile.id)
            .one().id;
          // Force a failure after contact mutations to prove the entire operation rolls back.
          state.storage.sql.exec(
            `CREATE TRIGGER reject_profile_delete BEFORE DELETE ON profiles BEGIN SELECT RAISE(ABORT, 'test rollback'); END`,
          );
          return id;
        },
      );
      await runInDurableObject<OrganizationStore, undefined>(bravoStub, (_instance, state) => {
        // Identical IDs in another Organization must remain untouched.
        state.storage.sql.exec(
          "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'Bravo Person', 'now', 'now')",
          profile.id,
        );
        state.storage.sql.exec(
          "INSERT INTO contacts (id, profile_id, source, email, normalized_email, created_at, updated_at) VALUES (?, ?, 'roster', 'import-delete@example.test', 'import-delete@example.test', 'now', 'now')",
          contactId,
          profile.id,
        );
      });
      const remove = () =>
        exports.default.fetch(
          apiRequest(
            "alpha.localhost",
            `/api/organization/profiles/${profile.id}?contacts=${contacts}`,
            cookie,
            { method: "DELETE" },
          ),
        );
      expect((await remove()).status).toBe(503);
      await runInDurableObject<OrganizationStore, undefined>(alphaStub, (_instance, state) => {
        expect(
          state.storage.sql.exec("SELECT id FROM profiles WHERE id = ?", profile.id).toArray(),
        ).toHaveLength(1);
        expect(
          state.storage.sql
            .exec<{ profileId: string }>(
              "SELECT profile_id AS profileId FROM contacts WHERE id = ?",
              contactId,
            )
            .one().profileId,
        ).toBe(profile.id);
        expect(
          state.storage.sql
            .exec("SELECT 1 FROM contact_communication_preferences WHERE contact_id = ?", contactId)
            .toArray(),
        ).toHaveLength(2);
        expect(
          state.storage.sql
            .exec(
              "SELECT 1 FROM audit_events WHERE action IN ('contact.deleted', 'contact.profile_unlinked') AND target_id = ?",
              contactId,
            )
            .toArray(),
        ).toHaveLength(0);
        state.storage.sql.exec("DROP TRIGGER reject_profile_delete");
      });
      expect((await remove()).status).toBe(200);
      await runInDurableObject<OrganizationStore, undefined>(alphaStub, (_instance, state) => {
        expect(
          state.storage.sql.exec("SELECT id FROM profiles WHERE id = ?", profile.id).toArray(),
        ).toHaveLength(0);
        const retained = state.storage.sql
          .exec<{ profileId: string | null }>(
            "SELECT profile_id AS profileId FROM contacts WHERE id = ?",
            contactId,
          )
          .toArray();
        expect(retained).toEqual(contacts === "keep" ? [{ profileId: null }] : []);
        expect(
          state.storage.sql
            .exec("SELECT 1 FROM contact_communication_preferences WHERE contact_id = ?", contactId)
            .toArray(),
        ).toHaveLength(contacts === "keep" ? 2 : 0);
        expect(
          state.storage.sql
            .exec(
              "SELECT 1 FROM audit_events WHERE action = ? AND target_id = ?",
              contacts === "keep" ? "contact.profile_unlinked" : "contact.deleted",
              contactId,
            )
            .toArray(),
        ).toHaveLength(1);
      });
      await runInDurableObject<OrganizationStore, undefined>(bravoStub, (_instance, state) => {
        expect(
          state.storage.sql.exec("SELECT id FROM profiles WHERE id = ?", profile.id).toArray(),
        ).toHaveLength(1);
        expect(
          state.storage.sql
            .exec<{ profileId: string }>(
              "SELECT profile_id AS profileId FROM contacts WHERE id = ?",
              contactId,
            )
            .one().profileId,
        ).toBe(profile.id);
      });
      expect((await remove()).status).toBe(404);
    },
  );

  it("keeps protected Contacts by default, rejects unsafe cleanup, and validates the deletion policy", async () => {
    const cookie = await signIn();
    const created = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Keep Contact", email: "keep-contact@example.test" }),
      }),
    );
    const profile = organizationProfileResponseSchema.parse(await created.json());
    const stub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
    const contactId = await runInDurableObject<OrganizationStore, string>(
      stub,
      (_instance, state) => {
        const id = state.storage.sql
          .exec<{ id: string }>("SELECT id FROM contacts WHERE profile_id = ?", profile.id)
          .one().id;
        state.storage.sql.exec(
          "UPDATE contact_communication_preferences SET status = 'unsubscribed' WHERE contact_id = ? AND channel = 'email'",
          id,
        );
        state.storage.sql.exec(
          "INSERT INTO contact_lists (id, name, created_at, updated_at) VALUES ('list', 'List', 'now', 'now')",
        );
        state.storage.sql.exec(
          "INSERT INTO contact_list_memberships (contact_id, list_id, created_at) VALUES (?, 'list', 'now')",
          id,
        );
        return id;
      },
    );
    const remove = (query = "") =>
      exports.default.fetch(
        apiRequest("alpha.localhost", `/api/organization/profiles/${profile.id}${query}`, cookie, {
          method: "DELETE",
        }),
      );
    expect((await remove("?contacts=delete_all")).status).toBe(400);
    const cleanup = await remove("?contacts=delete_unused");
    expect(cleanup.status).toBe(409);
    expect(await cleanup.json()).toMatchObject({
      code: "profile_contact_history_requires_inactive",
      message: expect.stringContaining("consent"),
    });
    expect((await remove()).status).toBe(200);
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ profileId: string | null }>(
            "SELECT profile_id AS profileId FROM contacts WHERE id = ?",
            contactId,
          )
          .one().profileId,
      ).toBeNull();
      expect(
        state.storage.sql
          .exec<{ status: string }>(
            "SELECT status FROM contact_communication_preferences WHERE contact_id = ? AND channel = 'email'",
            contactId,
          )
          .one().status,
      ).toBe("unsubscribed");
      expect(
        state.storage.sql
          .exec("SELECT 1 FROM contact_list_memberships WHERE contact_id = ?", contactId)
          .toArray(),
      ).toHaveLength(1);
    });
  });

  it.each([
    "suppression",
    "inactive suppression",
    "unsubscribe flag",
    "provider flag",
    "RSVP history",
  ] as const)(
    "preserves Profile %s even when Contacts would otherwise be disposable",
    async (history) => {
      const cookie = await signIn();
      const created = await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            displayName: "Protected",
            email: "protected-contact@example.test",
          }),
        }),
      );
      const profile = organizationProfileResponseSchema.parse(await created.json());
      const stub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
      await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
        if (history === "suppression" || history === "inactive suppression") {
          state.storage.sql.exec(
            "INSERT INTO communication_suppressions (id, profile_id, channel, reason, active, created_at, updated_at) VALUES ('suppression', ?, 'email', 'provider', ?, 'now', 'now')",
            profile.id,
            history === "suppression" ? 1 : 0,
          );
        } else if (history === "unsubscribe flag") {
          state.storage.sql.exec("UPDATE profiles SET do_not_email = 1 WHERE id = ?", profile.id);
        } else if (history === "provider flag") {
          state.storage.sql.exec(
            "UPDATE profiles SET provider_email_suppressed = 1 WHERE id = ?",
            profile.id,
          );
        } else {
          state.storage.sql.exec(
            "INSERT INTO event_rsvp_history (id, event_id, profile_id, previous_rsvp, new_rsvp, reason, actor_type, occurred_at) VALUES ('rsvp', 'event', ?, 'Pending', 'Yes', 'response', 'organization_member', 'now')",
            profile.id,
          );
        }
      });
      for (const contacts of ["keep", "delete_unused"]) {
        const response = await exports.default.fetch(
          apiRequest(
            "alpha.localhost",
            `/api/organization/profiles/${profile.id}?contacts=${contacts}`,
            cookie,
            { method: "DELETE" },
          ),
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          code:
            history === "RSVP history"
              ? "profile_event_history_requires_inactive"
              : "profile_suppression_history_requires_inactive",
        });
      }
      await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
        expect(
          state.storage.sql.exec("SELECT id FROM profiles WHERE id = ?", profile.id).toArray(),
        ).toHaveLength(1);
        expect(
          state.storage.sql
            .exec("SELECT id FROM contacts WHERE profile_id = ?", profile.id)
            .toArray(),
        ).toHaveLength(1);
      });
    },
  );

  it("deletes safe unreferenced Profiles and rejects non-admin, IDOR, self-removal, and historical records", async () => {
    const adminCookie = await signIn();

    // 1. Create a safe unreferenced profile in Alpha
    const createRes = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({ displayName: "Safe Profile", email: "safe-profile@example.test" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createRes.status).toBe(201);
    const createdProfile = organizationProfileResponseSchema.parse(await createRes.json());
    const safeProfileId = createdProfile.id;

    // 2. Reject non-admin role (member on alpha trying to delete)
    clearCapturedPlatformEmailsForTest();
    await seedAuthUser(
      controlDatabase,
      "member-only-user",
      "member.only@example.test",
      "Member Only",
    );
    await controlDatabase
      .prepare(
        "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES ('member-alpha-1', 'organization-alpha', 'member-only-user', 'member', ?)",
      )
      .bind(new Date().toISOString())
      .run();
    const memberCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      "member.only@example.test",
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );
    const nonAdminDeleteRes = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${safeProfileId}`, memberCookie, {
        method: "DELETE",
      }),
    );
    expect(nonAdminDeleteRes.status).toBe(403);

    // 3. Reject cross-tenant IDOR: admin on alpha trying to delete on bravo host
    const crossTenantRes = await exports.default.fetch(
      apiRequest("bravo.localhost", `/api/organization/profiles/${safeProfileId}`, adminCookie, {
        method: "DELETE",
      }),
    );
    expect(crossTenantRes.status).toBe(403);

    // 4. Reject self-removal: link caller's admin membership to a profile
    const selfProfileRes = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({ displayName: "Admin Profile" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(selfProfileRes.status).toBe(201);
    const selfProfileId = organizationProfileResponseSchema.parse(await selfProfileRes.json()).id;
    await controlDatabase
      .prepare(
        "UPDATE member SET profileId = ? WHERE organizationId = 'organization-alpha' AND userId = 'profile-manager'",
      )
      .bind(selfProfileId)
      .run();

    const selfDeleteRes = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${selfProfileId}`, adminCookie, {
        method: "DELETE",
      }),
    );
    expect(selfDeleteRes.status).toBe(409);
    expect(await selfDeleteRes.json()).toMatchObject({ code: "cannot_delete_own_profile" });

    // 5. Reject profile attached to active membership
    const memberProfileRes = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({ displayName: "Member Profile" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const memberProfileId = organizationProfileResponseSchema.parse(
      await memberProfileRes.json(),
    ).id;
    await seedAuthUser(controlDatabase, "other-user", "other.user@example.test", "Other User");
    await controlDatabase
      .prepare(
        "INSERT INTO member (id, organizationId, userId, role, profileId, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "member-row-2",
        "organization-alpha",
        "other-user",
        "member",
        memberProfileId,
        new Date().toISOString(),
      )
      .run();

    const memberDeleteRes = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${memberProfileId}`, adminCookie, {
        method: "DELETE",
      }),
    );
    expect(memberDeleteRes.status).toBe(409);
    expect(await memberDeleteRes.json()).toMatchObject({ code: "profile_has_active_membership" });

    // 6. Reject profile with event attendance / roster history
    const eventProfileRes = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({ displayName: "Event Profile" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const eventProfileId = organizationProfileResponseSchema.parse(await eventProfileRes.json()).id;

    const alphaStub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, undefined>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, folder_number, folder_returned, created_at, updated_at)
         VALUES ('event-1', ?, 'Yes', 'Present', '', 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
        eventProfileId,
      );
    });

    const eventDeleteRes = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${eventProfileId}`, adminCookie, {
        method: "DELETE",
      }),
    );
    expect(eventDeleteRes.status).toBe(409);
    expect(await eventDeleteRes.json()).toMatchObject({
      code: "profile_event_history_requires_inactive",
    });

    // 7. Reject profile with dues history
    const duesProfileRes = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({ displayName: "Dues Profile" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const duesProfileId = organizationProfileResponseSchema.parse(await duesProfileRes.json()).id;

    await runInDurableObject<OrganizationStore, undefined>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO seasons (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES ('season-1', '2026 Season', '2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.000Z', 5000, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      );
      state.storage.sql.exec(
        `INSERT INTO dues (id, season_id, profile_id, amount_cents, status, created_at, updated_at)
         VALUES ('dues-1', 'season-1', ?, 5000, 'paid', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        duesProfileId,
      );
    });

    const duesDeleteRes = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${duesProfileId}`, adminCookie, {
        method: "DELETE",
      }),
    );
    expect(duesDeleteRes.status).toBe(409);
    expect(await duesDeleteRes.json()).toMatchObject({
      code: "profile_dues_history_requires_inactive",
    });

    // 8. Safely delete unreferenced safeProfileId
    const deleteRes = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${safeProfileId}`, adminCookie, {
        method: "DELETE",
      }),
    );
    expect(deleteRes.status).toBe(200);
    const deleteBody = organizationProfileDeleteResponseSchema.parse(await deleteRes.json());
    expect(deleteBody.deleted).toBe(true);
    expect(deleteBody.profileId).toBe(safeProfileId);

    // Verify profile is gone
    const listRes = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie),
    );
    const listBody = organizationProfilesResponseSchema.parse(await listRes.json());
    expect(listBody.profiles.some((p) => p.id === safeProfileId)).toBe(false);

    // Verify audit event in DO
    const auditCount = await runInDurableObject<OrganizationStore, number>(
      alphaStub,
      (_instance, state) => {
        return state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'profile.deleted' AND target_id = ?",
            safeProfileId,
          )
          .one().count;
      },
    );
    expect(auditCount).toBe(1);

    // 9. Deleting already deleted profile returns 404
    const repeatedDeleteRes = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/profiles/${safeProfileId}`, adminCookie, {
        method: "DELETE",
      }),
    );
    expect(repeatedDeleteRes.status).toBe(404);
  });
});

describe("provider bounces and delivery history", () => {
  it("records a hard bounce, suppresses the profile, and exposes delivery history", async () => {
    const organizationId = "organization-alpha";
    const profileId = "33333333-3333-4333-8333-333333333333";
    const requestId = "44444444-4444-4444-8444-444444444444";
    const now = "2026-08-05T12:00:00.000Z";
    const stub = organizationStore.get(organizationStore.idFromName(organizationId));

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        profileId,
        "Bounced Singer",
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, 'Bounced Singer', 'email', 'bounced@example.test', 'sent', 1, ?, ?)`,
        "delivery-1",
        "55555555-5555-4555-8555-555555555555",
        profileId,
        now,
        now,
      );
    });

    const bounceResponse = await stub.fetch(
      "https://organization.internal/internal/email/provider-event",
      {
        body: JSON.stringify({
          bounceType: "hard",
          eventId: requestId,
          eventTimestamp: now,
          organizationId,
          providerMessageId: "cloudflare-bounced-id",
          providerReason: "550 5.1.1 User unknown",
          providerSmtpEnhancedStatusCode: "5.1.1",
          providerSmtpResponse: "550 5.1.1 User unknown",
          providerSmtpStatusCode: "550",
          providerStatus: "bounced",
          recipient: "bounced@example.test",
          shouldSuppress: true,
          sourceId: "delivery-1",
          sourceKind: "communication_delivery",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(bounceResponse.status).toBe(200);

    const outOfOrderDeliveredResponse = await stub.fetch(
      "https://organization.internal/internal/email/provider-event",
      {
        body: JSON.stringify({
          bounceType: null,
          eventId: `${requestId}-delivered`,
          eventTimestamp: "2026-08-05T12:01:00.000Z",
          organizationId,
          providerMessageId: "cloudflare-bounced-id",
          providerReason: "",
          providerSmtpEnhancedStatusCode: "2.0.0",
          providerSmtpResponse: "250 2.0.0 OK",
          providerSmtpStatusCode: "250",
          providerStatus: "delivered",
          recipient: "bounced@example.test",
          shouldSuppress: false,
          sourceId: "delivery-1",
          sourceKind: "communication_delivery",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(outOfOrderDeliveredResponse.status).toBe(200);

    const state = await runInDurableObject<
      OrganizationStore,
      {
        readonly auditCount: number;
        readonly doNotEmail: number;
        readonly lastBounceAt: string;
        readonly providerEmailSuppressed: number;
        readonly suppressionReason: string;
        readonly suppressionCount: number;
        readonly providerStatus: string;
      }
    >(stub, (_instance, s) => {
      const profile = s.storage.sql
        .exec<{
          readonly bounceReason: string;
          readonly doNotEmail: number;
          readonly lastBounceAt: string;
          readonly providerEmailSuppressed: number;
        }>(
          "SELECT do_not_email AS doNotEmail, last_bounce_at AS lastBounceAt, bounce_reason AS bounceReason, provider_email_suppressed AS providerEmailSuppressed FROM profiles WHERE id = ?",
          profileId,
        )
        .one();
      const suppression = s.storage.sql
        .exec<{ readonly reason: string }>(
          "SELECT reason FROM communication_suppressions WHERE profile_id = ? AND channel = 'email'",
          profileId,
        )
        .toArray();
      const audit = s.storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM audit_events WHERE target_id = ? AND action = 'organization.email_provider_bounced'",
          "delivery-1",
        )
        .one();
      const delivery = s.storage.sql
        .exec<{ readonly providerStatus: string }>(
          "SELECT provider_status AS providerStatus FROM communication_deliveries WHERE id = ?",
          "delivery-1",
        )
        .one();
      return {
        auditCount: audit.count,
        doNotEmail: profile.doNotEmail,
        lastBounceAt: profile.lastBounceAt,
        providerEmailSuppressed: profile.providerEmailSuppressed,
        providerStatus: delivery.providerStatus,
        suppressionCount: suppression.length,
        suppressionReason: suppression[0]?.reason ?? "",
      };
    });
    expect(state.doNotEmail).toBe(0);
    expect(state.providerEmailSuppressed).toBe(1);
    expect(new Date(state.lastBounceAt).toISOString()).toBe(state.lastBounceAt);
    expect(state.suppressionCount).toBe(1);
    expect(state.suppressionReason).toBe("provider");
    expect(state.auditCount).toBe(1);
    expect(state.providerStatus).toBe("bounced");

    const deliveriesUrl = new URL(
      "https://organization.internal/internal/communications/deliveries",
    );
    deliveriesUrl.searchParams.set("organizationId", organizationId);
    deliveriesUrl.searchParams.set("profileId", profileId);
    const deliveriesResponse = await stub.fetch(deliveriesUrl);
    expect(deliveriesResponse.status).toBe(200);
    const deliveriesBody = organizationProfileDeliveriesResponseSchema
      .omit({ requestId: true })
      .parse(await deliveriesResponse.json());
    expect(deliveriesBody.deliveries).toHaveLength(1);
    expect(deliveriesBody.deliveries[0]).toMatchObject({
      destination: "bounced@example.test",
      providerStatus: "bounced",
      status: "sent",
      subject: "(no subject)",
    });
  });
});
