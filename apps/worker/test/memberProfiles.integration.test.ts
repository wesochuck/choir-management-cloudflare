import {
  memberEmailChangeConfirmationResponseSchema,
  memberEmailChangeResponseSchema,
  memberProfileResponseSchema,
  organizationDirectoryResponseSchema,
  organizationProfileResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "member.profile@example.test";
const NEW_USER_EMAIL = "member.profile.changed@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const write = (host: string, path: string, cookie: string, body: unknown, method = "POST") =>
  writeJson(exports.default, host, path, cookie, body, method);
const api = organizationRequest;

const provision = (id: string, slug: string) =>
  provisionOrganization(database, stores, { id, slug, userId: "member-profile-user" });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "member-profile-user", USER_EMAIL, "Member Profile");
  await provision("organization-alpha", "alpha");
  await provision("organization-bravo", "bravo");
});

afterEach(async () => {
  await reset();
});

describe("linked-member Profile and directory", () => {
  it("limits self-service fields and exposes only opted-in non-Inactive directory entries", async () => {
    const cookie = await signIn();
    const own = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Member Singer",
          globalStatus: "Idle",
          notes: "Manager-only note",
          phone: "555-0100",
          voicePart: "S1",
        })
      ).json(),
    );
    const publicProfile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Public Singer",
          phone: "555-0200",
          voicePart: "A1",
        })
      ).json(),
    );
    await write("alpha.localhost", "/api/organization/profiles", cookie, {
      displayName: "Hidden Singer",
      showInDirectory: false,
      voicePart: "T1",
    });
    await write("alpha.localhost", "/api/organization/profiles", cookie, {
      displayName: "Inactive Singer",
      globalStatus: "Inactive",
      voicePart: "B1",
    });
    await database.batch([
      database
        .prepare(
          `UPDATE member SET profileId = ?, role = 'member'
           WHERE organizationId = 'organization-alpha' AND userId = 'member-profile-user'`,
        )
        .bind(own.id),
      database.prepare(
        `UPDATE member SET role = 'member'
           WHERE organizationId = 'organization-bravo' AND userId = 'member-profile-user'`,
      ),
    ]);

    expect(
      await exports.default.fetch(api("alpha.localhost", "/api/singer/profile")),
    ).toMatchObject({ status: 401 });
    const initial = memberProfileResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/profile", cookie))
      ).json(),
    );
    expect(initial).toMatchObject({
      displayName: "Member Singer",
      email: USER_EMAIL,
      globalStatus: "Idle",
      id: own.id,
      voicePart: "S1",
    });

    const updated = memberProfileResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          "/api/singer/profile",
          cookie,
          {
            displayName: "Member Updated",
            globalStatus: "Active",
            notes: "Client attempted overwrite",
            phone: "555-0199",
            showInDirectory: false,
            voicePart: "B1",
          },
          "PUT",
        )
      ).json(),
    );
    expect(updated).toMatchObject({
      displayName: "Member Updated",
      globalStatus: "Idle",
      phone: "555-0199",
      showInDirectory: false,
      voicePart: "S1",
    });

    const hiddenDirectory = organizationDirectoryResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/directory", cookie))
      ).json(),
    );
    expect(hiddenDirectory.profiles).toEqual([
      {
        displayName: "Public Singer",
        email: "",
        id: publicProfile.id,
        phone: "555-0200",
        photoFileId: null,
        voicePart: "A1",
      },
    ]);

    await write(
      "alpha.localhost",
      "/api/singer/profile",
      cookie,
      { displayName: "Member Updated", phone: "555-0199", showInDirectory: true },
      "PUT",
    );
    const visibleDirectory = organizationDirectoryResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/directory", cookie))
      ).json(),
    );
    expect(visibleDirectory.profiles.map(({ displayName }) => displayName)).toEqual([
      "Member Updated",
      "Public Singer",
    ]);
    expect(visibleDirectory.profiles[0]?.email).toBe(USER_EMAIL);

    expect(
      await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie)),
    ).toMatchObject({ status: 403 });
    expect(
      await exports.default.fetch(api("bravo.localhost", "/api/singer/profile", cookie)),
    ).toMatchObject({ status: 404 });
    expect(
      await exports.default.fetch(api("localhost", "/api/singer/directory", cookie)),
    ).toMatchObject({ status: 404 });

    const persisted = await runInDurableObject<
      OrganizationStore,
      { readonly auditCount: number; readonly globalStatus: string; readonly notes: string }
    >(stores.get(stores.idFromName("organization-alpha")), (_instance, state) => {
      const profile = state.storage.sql
        .exec<{ readonly globalStatus: string; readonly notes: string }>(
          "SELECT global_status AS globalStatus, notes FROM profiles WHERE id = ?",
          own.id,
        )
        .one();
      const auditCount = state.storage.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE action = 'profile.self_updated' AND actor_id = 'member-profile-user'`,
        )
        .one().count;
      return { auditCount, ...profile };
    });
    expect(persisted).toEqual({ auditCount: 2, globalStatus: "Idle", notes: "Manager-only note" });
  });

  it("requires new-email confirmation, notifies both addresses, and binds the link to its host", async () => {
    const cookie = await signIn();
    const profile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Member Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    await database.batch([
      database
        .prepare(
          `UPDATE member SET profileId = ?, role = 'member'
           WHERE organizationId = 'organization-alpha' AND userId = 'member-profile-user'`,
        )
        .bind(profile.id),
      database.prepare(
        `UPDATE member SET role = 'member'
         WHERE organizationId = 'organization-bravo' AND userId = 'member-profile-user'`,
      ),
    ]);
    clearCapturedPlatformEmailsForTest();

    const request = memberEmailChangeResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/singer/profile/email-change", cookie, {
          email: NEW_USER_EMAIL,
        })
      ).json(),
    );
    expect(request.status).toBe("pending");
    expect(request.email).toBe(NEW_USER_EMAIL);

    const requestMessages = readCapturedPlatformEmailsForTest().filter((message) =>
      message.kind.startsWith("email-change-"),
    );
    expect(requestMessages.map(({ recipient }) => recipient).toSorted()).toEqual(
      [NEW_USER_EMAIL, USER_EMAIL].toSorted(),
    );
    const confirmationMessage = requestMessages.find(
      (message) =>
        message.kind === "email-change-confirmation" && message.recipient === NEW_USER_EMAIL,
    );
    if (!confirmationMessage) throw new Error("The new-address confirmation message is missing.");
    const confirmationUrl = /https?:\/\/\S+/.exec(confirmationMessage.text)?.[0];
    if (!confirmationUrl) throw new Error("The confirmation link is missing from the message.");
    const token = new URL(confirmationUrl).searchParams.get("token");
    if (!token) throw new Error("The confirmation token is missing from the link.");

    const wrongHost = await write("bravo.localhost", "/api/account/email-change/confirm", "", {
      token,
    });
    expect(wrongHost.status).toBe(400);

    const confirmed = memberEmailChangeConfirmationResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/account/email-change/confirm", "", { token })
      ).json(),
    );
    expect(confirmed).toMatchObject({ email: NEW_USER_EMAIL, status: "confirmed" });

    const replay = await write("alpha.localhost", "/api/account/email-change/confirm", "", {
      token,
    });
    expect(replay.status).toBe(400);

    const user = await database
      .prepare("SELECT email, emailVerified FROM user WHERE id = 'member-profile-user'")
      .first<{ readonly email: string; readonly emailVerified: number }>();
    expect(user).toEqual({ email: NEW_USER_EMAIL, emailVerified: 1 });

    const confirmedMessages = readCapturedPlatformEmailsForTest().filter((message) =>
      message.kind.startsWith("email-change-"),
    );
    expect(confirmedMessages).toHaveLength(4);
    expect(
      confirmedMessages.filter(
        ({ kind, recipient }) =>
          kind === "email-change-notice" && [USER_EMAIL, NEW_USER_EMAIL].includes(recipient),
      ),
    ).toHaveLength(3);

    const audit = await database
      .prepare(
        `SELECT action FROM platform_audit_events
         WHERE organization_id = 'organization-alpha' AND target_id = 'member-profile-user'
           AND action IN ('member.email_change_requested', 'member.email_changed')
         ORDER BY occurred_at ASC`,
      )
      .all<{ readonly action: string }>();
    expect(audit.results.map(({ action }) => action)).toEqual([
      "member.email_change_requested",
      "member.email_changed",
    ]);
  });
});
