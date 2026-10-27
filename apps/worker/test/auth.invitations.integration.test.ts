import {
  organizationInvitationActionResponseSchema,
  organizationInvitationDetailsSchema,
  organizationInvitationsResponseSchema,
  organizationInvitationResponseSchema,
  organizationProfileResponseSchema,
} from "@choir/contracts";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setupAuthIntegration,
  teardownAuthIntegration,
  ALPHA_AUTH_ORIGIN,
  INVITED_EMAIL,
  testEnv,
  authRequest,
  fetchWorker,
  seedInvitedUser,
  seedOrganizations,
  signInEmail,
  signInInvitedUser,
  readCapturedPlatformEmailsForTest,
} from "./auth.integration.fixture";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
beforeEach(async () => setupAuthIntegration());
afterEach(async () => teardownAuthIntegration());

describe("Organization invitations", () => {
  it("excludes expired invitations before pagination for ISO and numeric dates", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const now = Date.now();
    const expiredAt = now - 60_000;
    const activeAt = now + 60_000;
    const rows = [
      ...Array.from({ length: 51 }, (_, index) => ({
        id: `expired-iso-${String(index)}`,
        expiresAt: new Date(expiredAt).toISOString(),
      })),
      { id: "expired-numeric", expiresAt: expiredAt },
      { id: "cutoff-iso", expiresAt: new Date(now).toISOString() },
      { id: "cutoff-numeric", expiresAt: now },
      { id: "active-iso", expiresAt: new Date(activeAt).toISOString() },
      { id: "active-numeric", expiresAt: activeAt },
    ];
    await testEnv.CONTROL_DB.batch(
      rows.map(({ id, expiresAt }) =>
        testEnv.CONTROL_DB.prepare(
          `INSERT INTO invitation
            (id, organizationId, email, role, status, expiresAt, createdAt, inviterId)
           VALUES (?, ?, ?, 'member', 'pending', ?, ?, ?)`,
        ).bind(id, "organization-alpha", INVITED_EMAIL, expiresAt, now, "user-invited-member"),
      ),
    );
    const response = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(response.status).toBe(200);
    const result = organizationInvitationsResponseSchema.parse(await response.json());
    expect(result.invitations.map(({ id }) => id).sort()).toEqual(["active-iso", "active-numeric"]);
    expect(result.invitations.map(({ expiresAt }) => expiresAt)).toEqual([
      new Date(activeAt).toISOString(),
      new Date(activeAt).toISOString(),
    ]);
    expect(result.truncated).toBe(false);
  });

  it("explains application-wide suppression before creating an invitation", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const inviterCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO email_recipient_suppressions
          (email_normalized, reason, source_event_id, provider_message_id, detail, active, created_at, updated_at)
         VALUES (?, 'bounce', ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        "suppressed@example.test",
        "event-invitation-guard",
        "provider-invitation-guard",
        "Mailbox unavailable",
        "2026-08-06T12:00:00.000Z",
        "2026-08-06T12:00:00.000Z",
      )
      .run();

    const response = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        {
          body: JSON.stringify({ email: "SUPPRESSED@example.test", role: "member" }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "email_recipient_suppressed",
      message: expect.stringContaining("Platform Administrator"),
    });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM invitation WHERE email = ?")
        .bind("suppressed@example.test")
        .first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("creates a pending identity that can sign in and accept its invitation", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const inviterCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const invitedEmail = "new.member@example.test";

    const invitationResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        {
          body: JSON.stringify({ email: invitedEmail, role: "member" }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = organizationInvitationResponseSchema.parse(await invitationResponse.json());
    expect(invitation.status).toBe("pending");
    const invitationEmail = readCapturedPlatformEmailsForTest().find(
      (message) => message.kind === "organization-invitation" && message.recipient === invitedEmail,
    );
    expect(invitationEmail?.text).toContain(
      `http://alpha.localhost/accept-invitation?id=${invitation.id}`,
    );
    expect(invitationEmail?.fromName).toBe("Organization Alpha");

    const wrongRecipientDetailsResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}`,
        { headers: { cookie: inviterCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(wrongRecipientDetailsResponse.status).toBe(404);

    const pendingUser = await testEnv.CONTROL_DB.prepare(
      "SELECT id, emailVerified FROM user WHERE email = ?",
    )
      .bind(invitedEmail)
      .first<{ emailVerified: number; id: string }>();
    expect(pendingUser).toMatchObject({ emailVerified: 0 });

    const invitedCookie = await signInEmail(invitedEmail, ALPHA_AUTH_ORIGIN);
    const crossOrganizationResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}`,
        { headers: { cookie: invitedCookie } },
        "http://bravo.localhost",
      ),
    );
    expect(crossOrganizationResponse.status).toBe(404);

    const invitationDetailsResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}`,
        { headers: { cookie: invitedCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(invitationDetailsResponse.status).toBe(200);
    expect(
      organizationInvitationDetailsSchema.parse(await invitationDetailsResponse.json()),
    ).toMatchObject({
      email: invitedEmail,
      id: invitation.id,
      organizationId: "organization-alpha",
      organizationName: "Organization Alpha",
      profileMatchStatus: "no_match",
      role: "member",
    });
    const acceptResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}/accept`,
        {
          headers: { cookie: invitedCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(acceptResponse.status).toBe(200);
    expect(
      organizationInvitationActionResponseSchema.parse(await acceptResponse.json()),
    ).toMatchObject({
      id: invitation.id,
      profileLinkStatus: "no_match",
      status: "accepted",
    });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT role FROM member WHERE organizationId = ? AND userId = ?")
        .bind("organization-alpha", pendingUser?.id)
        .first(),
    ).resolves.toEqual({ role: "member" });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT action FROM platform_audit_events
         WHERE target_id = ? ORDER BY occurred_at`,
      )
        .bind(invitation.id)
        .all(),
    ).resolves.toMatchObject({
      results: [
        { action: "organization.invitation.created" },
        { action: "organization.invitation.accepted" },
      ],
    });
  });

  it("links a first-time account to one existing Profile after invite verification", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const inviterCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const invitedEmail = "first.time.singer@example.test";
    const profileResponse = await fetchWorker(
      authRequest(
        "/api/organization/profiles",
        {
          body: JSON.stringify({
            displayName: "First Time Singer",
            email: invitedEmail,
            voicePart: "Soprano 1",
          }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(profileResponse.status).toBe(201);
    const profile = organizationProfileResponseSchema.parse(await profileResponse.json());
    const invitationResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        {
          body: JSON.stringify({ email: invitedEmail, role: "member" }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = organizationInvitationResponseSchema.parse(await invitationResponse.json());
    const invitedCookie = await signInEmail(invitedEmail, ALPHA_AUTH_ORIGIN);

    const acceptResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}/accept`,
        { headers: { cookie: invitedCookie }, method: "POST" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationInvitationActionResponseSchema.parse(await acceptResponse.json()),
    ).toMatchObject({
      profileLinkStatus: "linked",
      status: "accepted",
    });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT member.profileId FROM member
         JOIN user ON user.id = member.userId
         WHERE member.organizationId = 'organization-alpha' AND user.email = ? LIMIT 1`,
      )
        .bind(invitedEmail)
        .first(),
    ).resolves.toEqual({ profileId: profile.id });
  });

  it("accepts an invitation without linking an archived Profile", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const inviterCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const invitedEmail = "archived.singer@example.test";
    const profileResponse = await fetchWorker(
      authRequest(
        "/api/organization/profiles",
        {
          body: JSON.stringify({ displayName: "Archived Singer", email: invitedEmail }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(profileResponse.status).toBe(201);
    const profile = organizationProfileResponseSchema.parse(await profileResponse.json());
    await runInDurableObject<OrganizationStore, undefined>(
      testEnv.ORGANIZATION_STORE.get(testEnv.ORGANIZATION_STORE.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE profiles SET global_status = 'Inactive', hidden = 1 WHERE id = ?",
          profile.id,
        );
      },
    );
    const invitationResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        {
          body: JSON.stringify({ email: invitedEmail, role: "member" }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const invitation = organizationInvitationResponseSchema.parse(await invitationResponse.json());
    const invitedCookie = await signInEmail(invitedEmail, ALPHA_AUTH_ORIGIN);
    const detailsResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}`,
        { headers: { cookie: invitedCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationInvitationDetailsSchema.parse(await detailsResponse.json()).profileMatchStatus,
    ).toBe("review_required");

    const acceptResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}/accept`,
        { headers: { cookie: invitedCookie }, method: "POST" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationInvitationActionResponseSchema.parse(await acceptResponse.json()),
    ).toMatchObject({
      profileLinkStatus: "review_required",
      status: "accepted",
    });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT member.profileId FROM member
         JOIN user ON user.id = member.userId
         WHERE member.organizationId = 'organization-alpha' AND user.email = ? LIMIT 1`,
      )
        .bind(invitedEmail)
        .first(),
    ).resolves.toEqual({ profileId: null });
    await expect(
      runInDurableObject<OrganizationStore, number>(
        testEnv.ORGANIZATION_STORE.get(testEnv.ORGANIZATION_STORE.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>("SELECT COUNT(*) AS count FROM profiles")
            .one().count,
      ),
    ).resolves.toBe(1);
  });

  it("links a verified multi-Organization account to the exact existing Alpha Profile", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const invitedEmail = "existing.singer@example.test";
    const now = Date.now();
    await testEnv.CONTROL_DB.batch([
      testEnv.CONTROL_DB.prepare(
        `INSERT INTO user
          (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
         VALUES (?, ?, ?, 1, ?, ?, 0)`,
      ).bind("user-existing-singer", "Existing Singer", invitedEmail, now, now),
      testEnv.CONTROL_DB.prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, ?, 'member', ?)`,
      ).bind("member-bravo-existing-singer", "organization-bravo", "user-existing-singer", now),
    ]);

    const inviterCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const profileResponse = await fetchWorker(
      authRequest(
        "/api/organization/profiles",
        {
          body: JSON.stringify({
            displayName: "Saved Singer Name",
            email: invitedEmail.toUpperCase(),
            phone: "555-0182",
            voicePart: "Alto 1",
          }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(profileResponse.status).toBe(201);
    const profile = organizationProfileResponseSchema.parse(await profileResponse.json());
    const organizationStub = testEnv.ORGANIZATION_STORE.get(
      testEnv.ORGANIZATION_STORE.idFromName("organization-alpha"),
    );
    await runInDurableObject<OrganizationStore, undefined>(organizationStub, (_instance, state) => {
      const at = "2026-01-02T12:00:00.000Z";
      state.storage.sql.exec(
        `UPDATE profiles
         SET global_status = 'Inactive', hidden = 0, show_in_directory = 0,
             notes = 'Saved note', do_not_email = 1
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

    const beforeProfile = await runInDurableObject<OrganizationStore, unknown>(
      organizationStub,
      (_instance, state) =>
        state.storage.sql
          .exec(
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

    const invitationResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        {
          body: JSON.stringify({ email: invitedEmail, role: "member" }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = organizationInvitationResponseSchema.parse(await invitationResponse.json());
    const invitedCookie = await signInEmail(invitedEmail, ALPHA_AUTH_ORIGIN);

    const detailsResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}`,
        { headers: { cookie: invitedCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(organizationInvitationDetailsSchema.parse(await detailsResponse.json())).toMatchObject({
      profileMatchStatus: "will_link",
      status: "pending",
    });

    const acceptResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}/accept`,
        { headers: { cookie: invitedCookie }, method: "POST" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationInvitationActionResponseSchema.parse(await acceptResponse.json()),
    ).toMatchObject({
      id: invitation.id,
      profileLinkStatus: "linked",
      status: "accepted",
    });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT profileId FROM member
         WHERE organizationId = 'organization-alpha' AND userId = ?`,
      )
        .bind("user-existing-singer")
        .first(),
    ).resolves.toEqual({ profileId: profile.id });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT role FROM member WHERE id = ?")
        .bind("member-bravo-existing-singer")
        .first(),
    ).resolves.toEqual({ role: "member" });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT action FROM platform_audit_events
         WHERE organization_id = ? AND actor_user_id = ?
           AND action = 'organization.membership.profile_auto_linked' LIMIT 1`,
      )
        .bind("organization-alpha", "user-existing-singer")
        .first<{ action: string }>(),
    ).resolves.toEqual({ action: "organization.membership.profile_auto_linked" });

    const afterProfile = await runInDurableObject<OrganizationStore, unknown>(
      organizationStub,
      (_instance, state) =>
        state.storage.sql
          .exec(
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
    expect(afterProfile).toEqual(beforeProfile);
  });

  it("blocks native Organization HTTP mutations and lists and cancels only host-bound invitations", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const nativeBypassResponse = await fetchWorker(
      authRequest(
        "/api/auth/organization/invite-member",
        {
          body: JSON.stringify({
            email: "native-bypass@example.test",
            organizationId: "organization-bravo",
            role: "admin",
          }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(nativeBypassResponse.status).toBe(404);

    const firstInvitationResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        {
          body: JSON.stringify({ email: "cancel.me@example.test", role: "administrator" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const firstInvitation = organizationInvitationResponseSchema.parse(
      await firstInvitationResponse.json(),
    );
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
      .bind(
        "invitation-bravo-hidden",
        "organization-bravo",
        "hidden@example.test",
        "member",
        Date.now() + 60_000,
        Date.now(),
        "user-invited-member",
      )
      .run();

    const listResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(listResponse.status).toBe(200);
    expect(organizationInvitationsResponseSchema.parse(await listResponse.json())).toMatchObject({
      invitations: [
        {
          email: "cancel.me@example.test",
          id: firstInvitation.id,
          role: "administrator",
          status: "pending",
        },
      ],
      truncated: false,
    });

    const crossOrganizationCancelResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(firstInvitation.id)}`,
        { headers: { cookie: sessionCookie }, method: "DELETE" },
        "http://bravo.localhost",
      ),
    );
    expect(crossOrganizationCancelResponse.status).toBe(403);

    const cancelResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(firstInvitation.id)}`,
        { headers: { cookie: sessionCookie }, method: "DELETE" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(cancelResponse.status).toBe(200);
    expect(
      organizationInvitationActionResponseSchema.parse(await cancelResponse.json()),
    ).toMatchObject({ id: firstInvitation.id, status: "canceled" });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT status FROM invitation WHERE id = ?")
        .bind(firstInvitation.id)
        .first(),
    ).resolves.toEqual({ status: "canceled" });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM invitation WHERE email = ?")
        .bind("native-bypass@example.test")
        .first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("lets the verified recipient decline without creating a membership", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const inviterCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const invitedEmail = "declining.member@example.test";
    const invitationResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations",
        {
          body: JSON.stringify({ email: invitedEmail, role: "member" }),
          headers: { cookie: inviterCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const invitation = organizationInvitationResponseSchema.parse(await invitationResponse.json());
    const recipientCookie = await signInEmail(invitedEmail, ALPHA_AUTH_ORIGIN);

    const rejectResponse = await fetchWorker(
      authRequest(
        `/api/organization/invitations/${encodeURIComponent(invitation.id)}/reject`,
        { headers: { cookie: recipientCookie }, method: "POST" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(rejectResponse.status).toBe(200);
    expect(
      organizationInvitationActionResponseSchema.parse(await rejectResponse.json()),
    ).toMatchObject({ id: invitation.id, status: "rejected" });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT status FROM invitation WHERE id = ?")
        .bind(invitation.id)
        .first(),
    ).resolves.toEqual({ status: "rejected" });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT COUNT(*) AS count FROM member m
         INNER JOIN user u ON u.id = m.userId
         WHERE m.organizationId = ? AND u.email = ?`,
      )
        .bind("organization-alpha", invitedEmail)
        .first(),
    ).resolves.toEqual({ count: 0 });
  });

  it.each(["ISO", "numeric"] as const)(
    "rejects an expired %s invitation without creating a membership",
    async (dateFormat) => {
      await seedInvitedUser();
      await seedOrganizations();
      await testEnv.CONTROL_DB.prepare("DELETE FROM member WHERE userId = ?")
        .bind("user-invited-member")
        .run();
      const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
      await testEnv.CONTROL_DB.prepare(
        `INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "invitation-expired",
          "organization-alpha",
          INVITED_EMAIL,
          "member",
          "pending",
          dateFormat === "ISO" ? new Date(Date.now() - 60_000).toISOString() : Date.now() - 60_000,
          Date.now() - 120_000,
          "user-invited-member",
        )
        .run();

      const response = await fetchWorker(
        authRequest(
          "/api/organization/invitations/invitation-expired/accept",
          {
            headers: { cookie: sessionCookie },
            method: "POST",
          },
          ALPHA_AUTH_ORIGIN,
        ),
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      await expect(
        testEnv.CONTROL_DB.prepare(
          "SELECT COUNT(*) AS count FROM member WHERE organizationId = ? AND userId = ?",
        )
          .bind("organization-alpha", "user-invited-member")
          .first(),
      ).resolves.toEqual({ count: 0 });
    },
  );

  it("keeps accept and reject host-bound against cross-organization replay", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const recipientCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId)
       VALUES (?, ?, ?, 'member', 'pending', ?, ?, ?)`,
    )
      .bind(
        "invitation-alpha-replay",
        "organization-alpha",
        INVITED_EMAIL,
        Date.now() + 60_000,
        Date.now(),
        "user-invited-member",
      )
      .run();

    for (const action of ["accept", "reject"] as const) {
      const replayResponse = await fetchWorker(
        authRequest(
          `/api/organization/invitations/invitation-alpha-replay/${action}`,
          {
            headers: { cookie: recipientCookie },
            method: "POST",
          },
          "http://unknown.localhost",
        ),
      );
      expect(replayResponse.status).toBe(404);
      await expect(replayResponse.json()).resolves.toMatchObject({
        code: "not_found",
        message: "The pending Organization invitation was not found.",
      });
    }

    const crossHostRejectResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations/invitation-alpha-replay/reject",
        { headers: { cookie: recipientCookie }, method: "POST" },
        "http://bravo.localhost",
      ),
    );
    expect(crossHostRejectResponse.status).toBe(404);

    await expect(
      testEnv.CONTROL_DB.prepare("SELECT status FROM invitation WHERE id = ?")
        .bind("invitation-alpha-replay")
        .first(),
    ).resolves.toEqual({ status: "pending" });

    const rejectResponse = await fetchWorker(
      authRequest(
        "/api/organization/invitations/invitation-alpha-replay/reject",
        { headers: { cookie: recipientCookie }, method: "POST" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(rejectResponse.status).toBe(200);
    expect(
      organizationInvitationActionResponseSchema.parse(await rejectResponse.json()),
    ).toMatchObject({ id: "invitation-alpha-replay", status: "rejected" });
  });
});
