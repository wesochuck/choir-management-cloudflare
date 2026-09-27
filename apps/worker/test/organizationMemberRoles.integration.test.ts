import { organizationMemberRoleUpdateResponseSchema } from "@choir/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALPHA_AUTH_ORIGIN,
  authRequest,
  fetchWorker,
  seedInvitedUser,
  seedOrganizations,
  setupAuthIntegration,
  signInInvitedUser,
  teardownAuthIntegration,
  testEnv,
} from "./auth.integration.fixture";

beforeEach(async () => setupAuthIntegration());
afterEach(async () => teardownAuthIntegration());

describe("PUT /api/organization/members/:membershipId/role", () => {
  it("rejects unauthenticated requests with 401", async () => {
    await seedInvitedUser();
    await seedOrganizations();

    const response = await fetchWorker(
      authRequest(
        "/api/organization/members/member-alpha/role",
        {
          body: JSON.stringify({ expectedRole: "member", role: "administrator" }),
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(response.status).toBe(401);
  });

  it("rejects requests by regular member with 403", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    // Demote user-invited-member to "member"
    await testEnv.CONTROL_DB.prepare("UPDATE member SET role = 'member' WHERE userId = ?")
      .bind("user-invited-member")
      .run();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const response = await fetchWorker(
      authRequest(
        "/api/organization/members/member-alpha/role",
        {
          body: JSON.stringify({ expectedRole: "member", role: "administrator" }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(response.status).toBe(403);
  });

  it("allows administrator to promote member to administrator, but blocks promoting to owner", async () => {
    await seedInvitedUser();
    await seedOrganizations();

    // Set user-invited-member to "admin"
    await testEnv.CONTROL_DB.prepare("UPDATE member SET role = 'admin' WHERE userId = ?")
      .bind("user-invited-member")
      .run();

    // Seed another target member in organization-alpha
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-target', 'Target User', 'target@example.test', 1, 0, 0)`,
    ).run();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt)
       VALUES ('member-target', 'organization-alpha', 'user-target', 'member', 0)`,
    ).run();

    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    // 1. Promote member to administrator -> succeeds
    const promoteResponse = await fetchWorker(
      authRequest(
        "/api/organization/members/member-target/role",
        {
          body: JSON.stringify({ expectedRole: "member", role: "administrator" }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(promoteResponse.status).toBe(200);
    const promoteData = organizationMemberRoleUpdateResponseSchema.parse(
      await promoteResponse.json(),
    );
    expect(promoteData).toMatchObject({
      membershipId: "member-target",
      organizationId: "organization-alpha",
      previousRole: "member",
      role: "administrator",
    });

    const targetRow = await testEnv.CONTROL_DB.prepare(
      "SELECT role FROM member WHERE id = 'member-target'",
    ).first<{ role: string }>();
    expect(targetRow?.role).toBe("admin");

    // Verify audit event
    const auditRow = await testEnv.CONTROL_DB.prepare(
      `SELECT action, actor_user_id, target_id, change_summary
       FROM platform_audit_events
       WHERE target_id = 'member-target' AND action = 'organization.membership.role_updated'`,
    ).first<{ action: string; actor_user_id: string; change_summary: string; target_id: string }>();
    expect(auditRow).toMatchObject({
      action: "organization.membership.role_updated",
      actor_user_id: "user-invited-member",
      target_id: "member-target",
    });

    // 2. Administrator attempts to promote to owner -> rejected with 403
    const ownerAttemptResponse = await fetchWorker(
      authRequest(
        "/api/organization/members/member-target/role",
        {
          body: JSON.stringify({ expectedRole: "administrator", role: "owner" }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(ownerAttemptResponse.status).toBe(403);

    // 3. Administrator attempts to modify self -> rejected with 403
    const myMembership = await testEnv.CONTROL_DB.prepare("SELECT id FROM member WHERE userId = ?")
      .bind("user-invited-member")
      .first<{ id: string }>();
    if (!myMembership) {
      throw new Error("Missing myMembership");
    }
    const selfAttemptResponse = await fetchWorker(
      authRequest(
        `/api/organization/members/${myMembership.id}/role`,
        {
          body: JSON.stringify({ expectedRole: "administrator", role: "member" }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(selfAttemptResponse.status).toBe(403);
  });

  it("allows owner to promote, demote, and self-demote if another owner exists, but blocks last owner demotion", async () => {
    await seedInvitedUser();
    await seedOrganizations();

    // Make user-invited-member an owner
    await testEnv.CONTROL_DB.prepare("UPDATE member SET role = 'owner' WHERE userId = ?")
      .bind("user-invited-member")
      .run();

    // Create another user and membership as owner
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-second-owner', 'Second Owner', 'second.owner@example.test', 1, 0, 0)`,
    ).run();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt)
       VALUES ('member-second-owner', 'organization-alpha', 'user-second-owner', 'owner', 0)`,
    ).run();

    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    // 1. Demote second owner to administrator (2 owners exist, so this succeeds)
    const demoteSecondResponse = await fetchWorker(
      authRequest(
        "/api/organization/members/member-second-owner/role",
        {
          body: JSON.stringify({ expectedRole: "owner", role: "administrator" }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(demoteSecondResponse.status).toBe(200);

    const secondRow = await testEnv.CONTROL_DB.prepare(
      "SELECT role FROM member WHERE id = 'member-second-owner'",
    ).first<{ role: string }>();
    expect(secondRow?.role).toBe("admin");

    // 2. Now user-invited-member is the ONLY owner remaining in organization-alpha.
    // Attempting to self-demote to administrator must fail with 409 conflict (last owner protection)
    const myMembership = await testEnv.CONTROL_DB.prepare("SELECT id FROM member WHERE userId = ?")
      .bind("user-invited-member")
      .first<{ id: string }>();
    if (!myMembership) {
      throw new Error("Missing myMembership");
    }

    const demoteLastOwnerResponse = await fetchWorker(
      authRequest(
        `/api/organization/members/${myMembership.id}/role`,
        {
          body: JSON.stringify({ expectedRole: "owner", role: "administrator" }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(demoteLastOwnerResponse.status).toBe(409);
    const errorBody = await demoteLastOwnerResponse.json();
    expect(JSON.stringify(errorBody)).toContain("at least one Owner");

    // Confirm role is still owner
    const myRow = await testEnv.CONTROL_DB.prepare("SELECT role FROM member WHERE id = ?")
      .bind(myMembership.id)
      .first<{ role: string }>();
    expect(myRow?.role).toBe("owner");
  });

  it("rejects stale edit when expectedRole does not match current target role", async () => {
    await seedInvitedUser();
    await seedOrganizations();

    await testEnv.CONTROL_DB.prepare("UPDATE member SET role = 'owner' WHERE userId = ?")
      .bind("user-invited-member")
      .run();

    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    // Target is member-alpha, but client claims expectedRole is "administrator"
    const response = await fetchWorker(
      authRequest(
        "/api/organization/members/member-alpha/role",
        {
          body: JSON.stringify({ expectedRole: "administrator", role: "owner" }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain("role has changed");
  });

  it("no-op mutation succeeds without inserting audit event", async () => {
    await seedInvitedUser();
    await seedOrganizations();

    await testEnv.CONTROL_DB.prepare("UPDATE member SET role = 'owner' WHERE userId = ?")
      .bind("user-invited-member")
      .run();

    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    // Count audit events before
    const beforeCount = await testEnv.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM platform_audit_events WHERE action = 'organization.membership.role_updated'",
    ).first<{ count: number }>();

    const response = await fetchWorker(
      authRequest(
        "/api/organization/members/member-alpha/role",
        {
          body: JSON.stringify({ expectedRole: "owner", role: "owner" }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(response.status).toBe(200);

    const afterCount = await testEnv.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM platform_audit_events WHERE action = 'organization.membership.role_updated'",
    ).first<{ count: number }>();
    expect(afterCount?.count).toBe(beforeCount?.count);
  });

  it("rejects foreign membership ID in another organization with 404", async () => {
    await seedInvitedUser();
    await seedOrganizations();

    await testEnv.CONTROL_DB.prepare("UPDATE member SET role = 'owner' WHERE userId = ?")
      .bind("user-invited-member")
      .run();

    // Create member in organization-bravo
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-bravo', 'Bravo User', 'bravo@example.test', 1, 0, 0)`,
    ).run();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt)
       VALUES ('member-bravo-only', 'organization-bravo', 'user-bravo', 'member', 0)`,
    ).run();

    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const response = await fetchWorker(
      authRequest(
        "/api/organization/members/member-bravo-only/role",
        {
          body: JSON.stringify({ expectedRole: "member", role: "administrator" }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(response.status).toBe(404);
  });

  it("blocks direct Better Auth role update endpoint", async () => {
    await seedInvitedUser();
    await seedOrganizations();

    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const response = await fetchWorker(
      authRequest(
        "/api/auth/organization/update-member-role",
        {
          body: JSON.stringify({ memberId: "member-alpha", role: "admin" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(response.status).toBe(404);
  });
});
