import {
  createRosterInviteLinkResponseSchema,
  organizationProfileResponseSchema,
  organizationProfilesResponseSchema,
  problemDetailsSchema,
  rosterInviteLinksResponseSchema,
  rosterInviteLinkShareResponseSchema,
  rosterInviteOptionsResponseSchema,
  rosterInvitePreviewResponseSchema,
  rosterInviteRedeemResponseSchema,
  revokeRosterInviteLinkResponseSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const ADMIN_EMAIL = "admin@example.test";
const SINGER_EMAIL = "new.singer@example.test";

const fetchWorker = async (request: Request): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await exports.default.fetch(request);
  await waitOnExecutionContext(ctx);
  return response;
};

const apiRequest = (hostname: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(hostname, path, cookie, init);

const signInAdmin = () =>
  signInWithOtp(exports.default, "alpha.localhost", ADMIN_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "user-admin", ADMIN_EMAIL, "Alpha Admin");
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-alpha",
    name: "Organization Alpha",
    role: "admin",
    slug: "alpha",
    userId: "user-admin",
  });
  await seedAuthUser(
    controlDatabase,
    "user-bravo-member",
    "bravo.member@example.test",
    "Bravo Member",
  );
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-bravo",
    name: "Organization Bravo",
    role: "member",
    slug: "bravo",
    userId: "user-bravo-member",
  });
});

afterEach(async () => {
  await reset();
});

describe("Organization roster invite links", () => {
  it("manages roster invite link lifecycle by administrator", async () => {
    const adminCookie = await signInAdmin();

    // Create link
    const createResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/roster-invite-links", adminCookie, {
        body: JSON.stringify({
          expiresInDays: 7,
          label: "Fall 2026 Tenors",
          maxUses: 5,
        }),
        method: "POST",
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = createRosterInviteLinkResponseSchema.parse(await createResponse.json());
    expect(created.shareUrl).toContain("http://alpha.localhost/join-roster#token=");

    // List links
    const listResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/roster-invite-links", adminCookie, {
        method: "GET",
      }),
    );
    expect(listResponse.status).toBe(200);
    const list = rosterInviteLinksResponseSchema.parse(await listResponse.json());
    expect(list.links).toHaveLength(1);
    expect(list.links[0]?.id).toBe(created.id);
    expect(list.links[0]?.label).toBe("Fall 2026 Tenors");
    expect(list.links[0]?.status).toBe("active");
    expect(list.links[0]?.committedUses).toBe(0);
    expect(list.links[0]?.maxUses).toBe(5);

    // Share URL reconstruction
    const shareResponse = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        `/api/organization/roster-invite-links/${created.id}/share`,
        adminCookie,
        {
          method: "POST",
        },
      ),
    );
    expect(shareResponse.status).toBe(200);
    const shared = rosterInviteLinkShareResponseSchema.parse(await shareResponse.json());
    expect(shared.shareUrl).toBe(created.shareUrl);

    // Revoke link
    const revokeResponse = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        `/api/organization/roster-invite-links/${created.id}/revoke`,
        adminCookie,
        {
          method: "POST",
        },
      ),
    );
    expect(revokeResponse.status).toBe(200);
    const revoked = revokeRosterInviteLinkResponseSchema.parse(await revokeResponse.json());
    expect(revoked.id).toBe(created.id);
    expect(revoked.revokedAt).toBeDefined();

    // Listing shows revoked
    const listAfterRevoke = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/roster-invite-links", adminCookie, {
        method: "GET",
      }),
    );
    const listRevoked = rosterInviteLinksResponseSchema.parse(await listAfterRevoke.json());
    expect(listRevoked.links[0]?.status).toBe("revoked");
  });

  it("forbids non-administrators from managing invite links", async () => {
    const memberCookie = await signInWithOtp(
      exports.default,
      "bravo.localhost",
      "bravo.member@example.test",
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );

    const createResponse = await fetchWorker(
      apiRequest("bravo.localhost", "/api/organization/roster-invite-links", memberCookie, {
        body: JSON.stringify({
          expiresInDays: 7,
          label: "Attempt",
        }),
        method: "POST",
      }),
    );
    expect(createResponse.status).toBe(403);
  });

  it.each(["sections_with_parts", "sections_only"] as const)(
    "completes full self-service recipient join flow with safe defaults (%s)",
    async (rosterStructure) => {
      const adminCookie = await signInAdmin();
      if (rosterStructure === "sections_only") {
        const configurationResponse = await fetchWorker(
          apiRequest("alpha.localhost", "/api/organization/roster-configuration", adminCookie, {
            method: "PUT",
            body: JSON.stringify({
              rosterStructure,
              sections: [{ code: "F", name: "Flute", color: "#123456" }],
            }),
          }),
        );
        expect(configurationResponse.status).toBe(200);
      }

      // 1. Admin creates invite link
      const createResponse = await fetchWorker(
        apiRequest("alpha.localhost", "/api/organization/roster-invite-links", adminCookie, {
          body: JSON.stringify({
            expiresInDays: 7,
            label: "New Sopranos",
            maxUses: 10,
          }),
          method: "POST",
        }),
      );
      expect(createResponse.status).toBe(201);
      const { shareUrl } = createRosterInviteLinkResponseSchema.parse(await createResponse.json());
      const token = shareUrl.split("#token=")[1];
      expect(token).toBeDefined();

      // 2. Anonymous preview
      const previewResponse = await fetchWorker(
        apiRequest("alpha.localhost", "/api/roster-invites/preview", undefined, {
          body: JSON.stringify({ token }),
          method: "POST",
        }),
      );
      expect(previewResponse.status).toBe(200);
      const preview = rosterInvitePreviewResponseSchema.parse(await previewResponse.json());
      expect(preview.organizationName).toBe("Organization Alpha");

      // 3. Start flow with new email address -> triggers OTP
      const startResponse = await fetchWorker(
        apiRequest("alpha.localhost", "/api/roster-invites/start", undefined, {
          body: JSON.stringify({ email: SINGER_EMAIL, token }),
          method: "POST",
        }),
      );
      expect(startResponse.status).toBe(200);

      // Verify identity was bootstrapped in D1 user table
      const bootstrappedUser = await controlDatabase
        .prepare("SELECT id, email, emailVerified FROM user WHERE email = ? LIMIT 1")
        .bind(SINGER_EMAIL)
        .first<{ email: string; emailVerified: number; id: string }>();
      expect(bootstrappedUser).toBeDefined();
      expect(bootstrappedUser?.emailVerified).toBe(0);

      // 4. Verify OTP and sign in
      const otp = readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), SINGER_EMAIL);
      expect(otp).toBeDefined();
      const signInResponse = await fetchWorker(
        apiRequest("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
          body: JSON.stringify({ email: SINGER_EMAIL, otp }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      expect(signInResponse.status).toBe(200);
      const singerCookie = signInResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      expect(singerCookie).toContain("choir-management.session_token=");

      // 5. Query onboarding options
      const optionsResponse = await fetchWorker(
        apiRequest("alpha.localhost", "/api/roster-invites/options", singerCookie, {
          body: JSON.stringify({ token }),
          method: "POST",
        }),
      );
      expect(optionsResponse.status).toBe(200);
      const options = rosterInviteOptionsResponseSchema.parse(await optionsResponse.json());
      expect(options.alreadyEnrolled).toBe(false);
      expect(options.voiceParts.length).toBeGreaterThan(0);
      expect(options.rosterStructure).toBe(rosterStructure);
      if (rosterStructure === "sections_only") {
        expect(options.voiceParts).toEqual([{ label: "F", fullName: "Flute", sectionCode: "F" }]);
      }
      const selectedPart = options.voiceParts[0]?.label ?? "Soprano";

      // 6. Redeem invite to join roster
      const redeemResponse = await fetchWorker(
        apiRequest("alpha.localhost", "/api/roster-invites/redeem", singerCookie, {
          body: JSON.stringify({
            displayName: "Alice New Singer",
            idempotencyKey: "idem-alice-1",
            phone: "(555) 019-2834",
            showInDirectory: true,
            token,
            voicePart: selectedPart,
          }),
          method: "POST",
        }),
      );
      expect(redeemResponse.status).toBe(201);
      const redeemResult = rosterInviteRedeemResponseSchema.parse(await redeemResponse.json());
      expect(redeemResult.status).toBe("completed");
      expect(redeemResult.membershipId).toBeDefined();
      expect(redeemResult.profileId).toBeDefined();

      // 7. Verify D1 member table: role is member, profileId is set
      const memberRow = await controlDatabase
        .prepare("SELECT id, role, profileId FROM member WHERE id = ? LIMIT 1")
        .bind(redeemResult.membershipId)
        .first<{ id: string; profileId: string; role: string }>();
      expect(memberRow?.role).toBe("member");
      expect(memberRow?.profileId).toBe(redeemResult.profileId);

      // 8. Verify DO profile: Active status, safe defaults, no admin notification privileges
      const profileResponse = await fetchWorker(
        apiRequest("alpha.localhost", `/api/organization/profiles`, adminCookie, {
          method: "GET",
        }),
      );
      expect(profileResponse.status).toBe(200);
      const profileBody = organizationProfilesResponseSchema.parse(await profileResponse.json());
      const singerProfile = profileBody.profiles.find((p) => p.id === redeemResult.profileId);
      expect(singerProfile).toBeDefined();
      expect(singerProfile?.displayName).toBe("Alice New Singer");
      expect(singerProfile?.globalStatus).toBe("Active");
      expect(singerProfile?.voicePart).toBe(selectedPart);
      expect(singerProfile?.receiveAdminNotifications).toBe(false);

      // 9. Idempotent retry returns 200 completed and does not consume another use
      const retryResponse = await fetchWorker(
        apiRequest("alpha.localhost", "/api/roster-invites/redeem", singerCookie, {
          body: JSON.stringify({
            displayName: "Alice New Singer",
            idempotencyKey: "idem-alice-1",
            phone: "(555) 019-2834",
            showInDirectory: true,
            token,
            voicePart: selectedPart,
          }),
          method: "POST",
        }),
      );
      expect(retryResponse.status).toBe(200);
      const retryResult = rosterInviteRedeemResponseSchema.parse(await retryResponse.json());
      expect(retryResult.membershipId).toBe(redeemResult.membershipId);

      // Verify committed uses count is still 1
      const listResponse = await fetchWorker(
        apiRequest("alpha.localhost", "/api/organization/roster-invite-links", adminCookie, {
          method: "GET",
        }),
      );
      const list = rosterInviteLinksResponseSchema.parse(await listResponse.json());
      expect(list.links[0]?.committedUses).toBe(1);

      // 10. Already-enrolled member calling with another key returns already_enrolled
      const alreadyEnrolledResponse = await fetchWorker(
        apiRequest("alpha.localhost", "/api/roster-invites/redeem", singerCookie, {
          body: JSON.stringify({
            displayName: "Alice Changed Name",
            idempotencyKey: "new-attempt-different-key",
            showInDirectory: true,
            token,
            voicePart: selectedPart,
          }),
          method: "POST",
        }),
      );
      expect(alreadyEnrolledResponse.status).toBe(200);
      const alreadyEnrolledResult = rosterInviteRedeemResponseSchema.parse(
        await alreadyEnrolledResponse.json(),
      );
      expect(alreadyEnrolledResult.status).toBe("already_enrolled");
    },
  );

  it("reuses a matching Profile without changing saved fields or history", async () => {
    const adminCookie = await signInAdmin();
    const invitedEmail = "existing.singer@example.test";
    const now = Date.now();
    await seedAuthUser(controlDatabase, "user-existing-singer", invitedEmail, "Existing Singer");
    await controlDatabase.batch([
      controlDatabase
        .prepare("UPDATE user SET emailVerified = 1 WHERE id = ?")
        .bind("user-existing-singer"),
      controlDatabase
        .prepare(
          `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, ?, 'member', ?)`,
        )
        .bind("member-bravo-existing-singer", "organization-bravo", "user-existing-singer", now),
    ]);

    const profileResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Saved Singer Name",
          email: invitedEmail.toUpperCase(),
          phone: "555-0182",
          voicePart: "Alto 1",
        }),
        method: "POST",
      }),
    );
    expect(profileResponse.status).toBe(201);
    const profile = organizationProfileResponseSchema.parse(await profileResponse.json());
    const organizationStub = organizationStore.get(
      organizationStore.idFromName("organization-alpha"),
    );
    await runInDurableObject<OrganizationStore, undefined>(organizationStub, (_instance, state) => {
      const at = "2026-01-02T12:00:00.000Z";
      state.storage.sql.exec(
        `UPDATE profiles
         SET hidden = 1, show_in_directory = 0, notes = 'Saved note', do_not_email = 1
         WHERE id = ?`,
        profile.id,
      );
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES ('existing-profile-history', 'History Event', 'Performance', ?, ?, ?)`,
        at,
        at,
        at,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters
          (event_id, profile_id, rsvp, attendance, created_at, updated_at)
         VALUES ('existing-profile-history', ?, 'Yes', 'Present', ?, ?)`,
        profile.id,
        at,
        at,
      );
    });
    const readProfile = () =>
      runInDurableObject<
        OrganizationStore,
        {
          display_name: string;
          do_not_email: number;
          global_status: string;
          hidden: number;
          history_rows: number;
          normalized_email: string;
          notes: string;
          phone: string;
          show_in_directory: number;
          voice_part: string;
        }
      >(organizationStub, (_instance, state) =>
        state.storage.sql
          .exec<{
            readonly display_name: string;
            readonly do_not_email: number;
            readonly global_status: string;
            readonly hidden: number;
            readonly history_rows: number;
            readonly normalized_email: string;
            readonly notes: string;
            readonly phone: string;
            readonly show_in_directory: number;
            readonly voice_part: string;
          }>(
            `SELECT display_name, phone, voice_part, global_status, hidden, show_in_directory,
                    notes, do_not_email,
                    (SELECT normalized_email FROM contacts c WHERE c.profile_id = profiles.id
                     ORDER BY c.created_at, c.id LIMIT 1) AS normalized_email,
                    (SELECT COUNT(*) FROM event_rosters r WHERE r.profile_id = profiles.id) AS history_rows
             FROM profiles WHERE id = ?`,
            profile.id,
          )
          .one(),
      );
    const beforeProfile = await readProfile();

    const createLinkResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/roster-invite-links", adminCookie, {
        body: JSON.stringify({ expiresInDays: 7, label: "Existing Singer", maxUses: 1 }),
        method: "POST",
      }),
    );
    const createdLink = createRosterInviteLinkResponseSchema.parse(await createLinkResponse.json());
    const token = createdLink.shareUrl.split("#token=")[1] ?? "";
    const singerCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      invitedEmail,
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );
    const optionsResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/roster-invites/options", singerCookie, {
        body: JSON.stringify({ token }),
        method: "POST",
      }),
    );
    expect(rosterInviteOptionsResponseSchema.parse(await optionsResponse.json())).toMatchObject({
      matchingProfile: { displayName: "Saved Singer Name", voicePart: "A1" },
      profileMatchStatus: "matched",
    });

    const redeemResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/roster-invites/redeem", singerCookie, {
        body: JSON.stringify({
          displayName: "Changed Name Must Be Ignored",
          idempotencyKey: "existing-singer-reuse",
          phone: "555-9999",
          showInDirectory: false,
          token,
          voicePart: "Soprano 1",
        }),
        method: "POST",
      }),
    );
    expect(redeemResponse.status).toBe(201);
    const result = rosterInviteRedeemResponseSchema.parse(await redeemResponse.json());
    expect(result).toMatchObject({ profileId: profile.id, status: "completed" });
    await expect(readProfile()).resolves.toEqual(beforeProfile);
    await expect(
      controlDatabase
        .prepare("SELECT profileId FROM member WHERE id = ? LIMIT 1")
        .bind(result.membershipId)
        .first(),
    ).resolves.toEqual({ profileId: profile.id });
    await expect(
      controlDatabase
        .prepare("SELECT profile_mode FROM organization_roster_invite_enrollments WHERE id = ?")
        .bind(result.enrollmentId)
        .first(),
    ).resolves.toEqual({ profile_mode: "existing" });
    await expect(
      controlDatabase
        .prepare(
          `SELECT committed_uses, active_reservations FROM organization_roster_invite_links WHERE id = ?`,
        )
        .bind(createdLink.id)
        .first(),
    ).resolves.toEqual({ active_reservations: 0, committed_uses: 1 });
    await expect(
      controlDatabase
        .prepare(
          `SELECT action FROM platform_audit_events
         WHERE organization_id = 'organization-alpha' AND actor_user_id = ?
           AND action = 'organization.membership.profile_auto_linked' LIMIT 1`,
        )
        .bind("user-existing-singer")
        .first(),
    ).resolves.toEqual({ action: "organization.membership.profile_auto_linked" });
    await expect(
      runInDurableObject<OrganizationStore, number>(
        organizationStub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>("SELECT COUNT(*) AS count FROM profiles")
            .one().count,
      ),
    ).resolves.toBe(1);
    await expect(
      controlDatabase
        .prepare("SELECT role FROM member WHERE id = ?")
        .bind("member-bravo-existing-singer")
        .first(),
    ).resolves.toEqual({ role: "member" });
  });

  it("blocks archived roster matches before creating a Profile or reserving capacity", async () => {
    const adminCookie = await signInAdmin();
    const archivedEmail = "archived.singer@example.test";
    const profileResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({ displayName: "Archived Singer", email: archivedEmail }),
        method: "POST",
      }),
    );
    const profile = organizationProfileResponseSchema.parse(await profileResponse.json());
    await runInDurableObject<OrganizationStore, undefined>(
      organizationStore.get(organizationStore.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE profiles SET global_status = 'Inactive', hidden = 1 WHERE id = ?",
          profile.id,
        );
      },
    );
    const createLinkResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/roster-invite-links", adminCookie, {
        body: JSON.stringify({ expiresInDays: 7, label: "Archived Profile", maxUses: 1 }),
        method: "POST",
      }),
    );
    const createdLink = createRosterInviteLinkResponseSchema.parse(await createLinkResponse.json());
    const token = createdLink.shareUrl.split("#token=")[1] ?? "";
    await seedAuthUser(controlDatabase, "user-archived-singer", archivedEmail, "Archived Singer");
    await controlDatabase
      .prepare("UPDATE user SET emailVerified = 1 WHERE id = ?")
      .bind("user-archived-singer")
      .run();
    const singerCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      archivedEmail,
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );
    const optionsResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/roster-invites/options", singerCookie, {
        body: JSON.stringify({ token }),
        method: "POST",
      }),
    );
    expect(rosterInviteOptionsResponseSchema.parse(await optionsResponse.json())).toMatchObject({
      matchingProfile: null,
      profileMatchStatus: "review_required",
    });
    const redeemResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/roster-invites/redeem", singerCookie, {
        body: JSON.stringify({
          displayName: "Should Not Be Created",
          idempotencyKey: "archived-singer-review",
          showInDirectory: true,
          token,
          voicePart: "Soprano 1",
        }),
        method: "POST",
      }),
    );
    expect(redeemResponse.status).toBe(409);
    expect(problemDetailsSchema.parse(await redeemResponse.json()).code).toBe(
      "profile_match_requires_review",
    );
    await expect(
      controlDatabase
        .prepare(
          `SELECT committed_uses, active_reservations FROM organization_roster_invite_links WHERE id = ?`,
        )
        .bind(createdLink.id)
        .first(),
    ).resolves.toEqual({ active_reservations: 0, committed_uses: 0 });
    await expect(
      controlDatabase
        .prepare("SELECT COUNT(*) AS count FROM organization_roster_invite_enrollments")
        .first(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      runInDurableObject<OrganizationStore, number>(
        organizationStore.get(organizationStore.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>("SELECT COUNT(*) AS count FROM profiles")
            .one().count,
      ),
    ).resolves.toBe(1);
  });

  it("enforces link capacity and rejects when exhausted", async () => {
    const adminCookie = await signInAdmin();

    // Create link with maxUses = 1
    const createResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/roster-invite-links", adminCookie, {
        body: JSON.stringify({
          expiresInDays: 7,
          label: "Sole Seat",
          maxUses: 1,
        }),
        method: "POST",
      }),
    );
    const { shareUrl } = createRosterInviteLinkResponseSchema.parse(await createResponse.json());
    const token = shareUrl.split("#token=")[1] ?? "";
    expect(token).toBeTruthy();

    // First user starts and joins
    await fetchWorker(
      apiRequest("alpha.localhost", "/api/roster-invites/start", undefined, {
        body: JSON.stringify({ email: "user1@example.test", token }),
        method: "POST",
      }),
    );
    const otp1 = readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), "user1@example.test");
    expect(otp1).toBeDefined();
    const firstLogin = await fetchWorker(
      apiRequest("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
        body: JSON.stringify({ email: "user1@example.test", otp: otp1 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const firstSingerCookie = firstLogin.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const firstRedeem = await fetchWorker(
      apiRequest("alpha.localhost", "/api/roster-invites/redeem", firstSingerCookie, {
        body: JSON.stringify({
          displayName: "First Singer",
          idempotencyKey: "user-1-key",
          showInDirectory: false,
          token,
          voicePart: "Soprano 1",
        }),
        method: "POST",
      }),
    );
    expect(firstRedeem.status).toBe(201);

    // Second user starts and attempts to join -> 409 invite_exhausted
    await fetchWorker(
      apiRequest("alpha.localhost", "/api/roster-invites/start", undefined, {
        body: JSON.stringify({ email: "user2@example.test", token }),
        method: "POST",
      }),
    );
    const otp2 = readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), "user2@example.test");
    expect(otp2).toBeDefined();
    const secondLogin = await fetchWorker(
      apiRequest("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
        body: JSON.stringify({ email: "user2@example.test", otp: otp2 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const secondSingerCookie = secondLogin.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const secondRedeem = await fetchWorker(
      apiRequest("alpha.localhost", "/api/roster-invites/redeem", secondSingerCookie, {
        body: JSON.stringify({
          displayName: "Second Singer",
          idempotencyKey: "user-2-key",
          showInDirectory: false,
          token,
          voicePart: "Alto 1",
        }),
        method: "POST",
      }),
    );
    expect(secondRedeem.status).toBe(409);
    const error = problemDetailsSchema.parse(await secondRedeem.json());
    expect(error.code).toBe("invite_exhausted");
  });

  it("rejects token tampered or cross-organization replay", async () => {
    const adminCookie = await signInAdmin();
    const createResponse = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/roster-invite-links", adminCookie, {
        body: JSON.stringify({
          expiresInDays: 7,
          label: "Alpha Link",
        }),
        method: "POST",
      }),
    );
    const { shareUrl } = createRosterInviteLinkResponseSchema.parse(await createResponse.json());
    const token = shareUrl.split("#token=")[1] ?? "";
    expect(token).toBeTruthy();

    // Presenting Alpha token on Bravo host must fail
    const previewOnBravo = await fetchWorker(
      apiRequest("bravo.localhost", "/api/roster-invites/preview", undefined, {
        body: JSON.stringify({ token }),
        method: "POST",
      }),
    );
    expect(previewOnBravo.status).toBe(404);
  });
});
