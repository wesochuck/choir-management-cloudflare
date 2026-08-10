import {
  organizationInvitationActionResponseSchema,
  organizationInvitationDetailsSchema,
  organizationInvitationsResponseSchema,
  organizationInvitationResponseSchema,
} from "@choir/contracts";
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
beforeEach(async () => setupAuthIntegration());
afterEach(async () => teardownAuthIntegration());

describe("Organization invitations", () => {
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
    ).toMatchObject({ id: invitation.id, status: "accepted" });
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

  it("rejects an expired invitation without creating a membership", async () => {
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
        Date.now() - 60_000,
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
  });
});
