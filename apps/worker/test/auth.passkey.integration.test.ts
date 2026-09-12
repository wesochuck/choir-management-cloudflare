import {
  organizationAuthStatusResponseSchema,
  organizationContextResponseSchema,
  organizationMfaPolicyResponseSchema,
} from "@choir/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALPHA_AUTH_ORIGIN,
  authRequest,
  enrollmentResponseSchema,
  fetchWorker,
  generateTotp,
  seedInvitedUser,
  seedOrganizations,
  setupAuthIntegration,
  signInInvitedUser,
  teardownAuthIntegration,
  testEnv,
} from "./auth.integration.fixture";

beforeEach(async () => setupAuthIntegration());
afterEach(async () => teardownAuthIntegration());

describe("passkey schema and migration", () => {
  it("creates passkey and session_auth_assurance tables with foreign key cascades", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    expect(sessionCookie).toBeTruthy();

    // Verify tables exist
    const passkeyTable = await testEnv.CONTROL_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passkey'",
    ).first<{ name: string }>();
    expect(passkeyTable?.name).toBe("passkey");

    const assuranceTable = await testEnv.CONTROL_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_auth_assurance'",
    ).first<{ name: string }>();
    expect(assuranceTable?.name).toBe("session_auth_assurance");

    // Fetch the active session
    const session = await testEnv.CONTROL_DB.prepare(
      "SELECT id, userId FROM session WHERE userId = ? LIMIT 1",
    )
      .bind("user-invited-member")
      .first<{ id: string; userId: string }>();
    expect(session).toBeDefined();
    if (!session) throw new Error("Session missing");

    // Insert a passkey record
    const passkeyId = crypto.randomUUID();
    const now = Date.now();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO passkey
        (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        passkeyId,
        "Test Passkey",
        "mock-public-key",
        session.userId,
        "mock-credential-id",
        0,
        "singleDevice",
        0,
        "internal",
        now,
      )
      .run();

    // Insert assurance for this session
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO session_auth_assurance
        (session_id, user_id, method, verified_at)
       VALUES (?, ?, 'passkey', ?)`,
    )
      .bind(session.id, session.userId, now)
      .run();

    // Verify assurance is queryable
    const assurance = await testEnv.CONTROL_DB.prepare(
      "SELECT * FROM session_auth_assurance WHERE session_id = ?",
    )
      .bind(session.id)
      .first<{ method: string; session_id: string }>();
    expect(assurance?.method).toBe("passkey");
    expect(assurance?.session_id).toBe(session.id);

    // Delete the session and verify CASCADE deletes the assurance
    await testEnv.CONTROL_DB.prepare("DELETE FROM session WHERE id = ?").bind(session.id).run();

    const assuranceAfterSessionDelete = await testEnv.CONTROL_DB.prepare(
      "SELECT * FROM session_auth_assurance WHERE session_id = ?",
    )
      .bind(session.id)
      .first();
    expect(assuranceAfterSessionDelete).toBeNull();
  });
});

describe("passkey-first session assurance and Organization MFA", () => {
  it("satisfies Organization MFA for the session lifetime when signed in with passkey", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    await testEnv.CONTROL_DB.prepare(
      "UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?",
    )
      .bind("organization-alpha", "user-invited-member")
      .run();

    // Create session via email OTP
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    // Enable MFA policy for Organization Alpha
    const policyResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-policy",
        {
          body: JSON.stringify({ mfaRequired: true }),
          headers: { cookie: sessionCookie },
          method: "PATCH",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(policyResponse.status).toBe(200);
    expect(organizationMfaPolicyResponseSchema.parse(await policyResponse.json())).toMatchObject({
      mfaRequired: true,
      organizationId: "organization-alpha",
    });

    // 1. Initially, session has no assurance. Attempting to access context fails with 401
    const beforePasskeyAccess = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(beforePasskeyAccess.status).toBe(401);
    await expect(beforePasskeyAccess.json()).resolves.toMatchObject({
      message: "A recent Organization MFA verification is required.",
    });

    // Auth status should show mfaRequired: true, mfaSatisfied: false, mfaSatisfiedBy: null
    const initialStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await initialStatusResponse.json()),
    ).toMatchObject({
      mfaRequired: true,
      mfaSatisfied: false,
      mfaSatisfiedBy: null,
      organizationId: "organization-alpha",
    });

    // 2. Now simulate that this session was authenticated via passkey (insert session_auth_assurance)
    const session = await testEnv.CONTROL_DB.prepare(
      "SELECT id, userId FROM session WHERE userId = ? LIMIT 1",
    )
      .bind("user-invited-member")
      .first<{ id: string; userId: string }>();
    if (!session) throw new Error("Session missing");

    const now = Date.now();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO session_auth_assurance
        (session_id, user_id, method, verified_at)
       VALUES (?, ?, 'passkey', ?)`,
    )
      .bind(session.id, session.userId, now)
      .run();

    // 3. Auth status now reports mfaSatisfied: true, mfaSatisfiedBy: "passkey"
    const passkeyStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await passkeyStatusResponse.json()),
    ).toMatchObject({
      mfaRequired: true,
      mfaSatisfied: true,
      mfaSatisfiedBy: "passkey",
      organizationId: "organization-alpha",
    });

    // 4. Accessing Organization context now succeeds without any TOTP verification prompt
    const passkeyAccessResponse = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(passkeyAccessResponse.status).toBe(200);
    expect(
      organizationContextResponseSchema.parse(await passkeyAccessResponse.json()),
    ).toMatchObject({
      organizationId: "organization-alpha",
      role: "owner",
      userId: "user-invited-member",
    });
  });

  it("does NOT satisfy Organization MFA merely because user owns a passkey if session was OTP-authenticated", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    await testEnv.CONTROL_DB.prepare(
      "UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?",
    )
      .bind("organization-alpha", "user-invited-member")
      .run();

    // User owns a passkey in the database
    const passkeyId = crypto.randomUUID();
    const now = Date.now();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO passkey
        (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        passkeyId,
        "Registered Passkey",
        "mock-pubkey",
        "user-invited-member",
        "mock-cred",
        0,
        "singleDevice",
        0,
        "internal",
        now,
      )
      .run();

    // Sign in via email OTP (new session without session_auth_assurance)
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    // Require MFA
    await testEnv.CONTROL_DB.prepare(
      "UPDATE organizations SET mfa_required = 1 WHERE id = 'organization-alpha'",
    ).run();

    // Check auth status: mfaSatisfied MUST be false even though user owns a passkey!
    const statusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const status = organizationAuthStatusResponseSchema.parse(await statusResponse.json());
    expect(status.mfaRequired).toBe(true);
    expect(status.mfaSatisfied).toBe(false);
    expect(status.mfaSatisfiedBy).toBeNull();

    // Access to context should be denied
    const contextResponse = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(contextResponse.status).toBe(401);
  });

  it("enforces tenant and session isolation for session assurance", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);

    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const session = await testEnv.CONTROL_DB.prepare(
      "SELECT id, userId FROM session WHERE userId = ? LIMIT 1",
    )
      .bind("user-invited-member")
      .first<{ id: string; userId: string }>();
    if (!session) throw new Error("Session missing");

    // Require MFA on Alpha
    await testEnv.CONTROL_DB.prepare(
      "UPDATE organizations SET mfa_required = 1 WHERE id = 'organization-alpha'",
    ).run();

    // Create a second session in the session table
    const otherSessionId = crypto.randomUUID();
    const now = Date.now();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO session
        (id, userId, token, expiresAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        otherSessionId,
        session.userId,
        crypto.randomUUID(),
        now + 7 * 24 * 3600 * 1000,
        now,
        now,
      )
      .run();

    // Insert assurance for the other session ID only
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO session_auth_assurance
        (session_id, user_id, method, verified_at)
       VALUES (?, ?, 'passkey', ?)`,
    )
      .bind(otherSessionId, session.userId, now)
      .run();

    // Current session should NOT be satisfied
    const statusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const status = organizationAuthStatusResponseSchema.parse(await statusResponse.json());
    expect(status.mfaSatisfied).toBe(false);
    expect(status.mfaSatisfiedBy).toBeNull();

    const contextResponse = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(contextResponse.status).toBe(401);
  });

  it("reports mfaSatisfied: true and mfaSatisfiedBy: 'totp' when TOTP is verified", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    await testEnv.CONTROL_DB.prepare(
      "UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?",
    )
      .bind("organization-alpha", "user-invited-member")
      .run();

    let sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    // Enroll user in TOTP
    const enableResponse = await fetchWorker(
      authRequest(
        "/api/auth/two-factor/enable",
        {
          body: JSON.stringify({}),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const enrollment = enrollmentResponseSchema.parse(await enableResponse.json());
    const enrollmentResponse = await fetchWorker(
      authRequest(
        "/api/auth/two-factor/verify-totp",
        {
          body: JSON.stringify({
            code: await generateTotp(enrollment.totpURI),
            trustDevice: false,
          }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(enrollmentResponse.status).toBe(200);
    sessionCookie = enrollmentResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? sessionCookie;

    // Require MFA
    await testEnv.CONTROL_DB.prepare(
      "UPDATE organizations SET mfa_required = 1 WHERE id = 'organization-alpha'",
    ).run();

    // Verify TOTP for Organization
    const verificationResponse = await fetchWorker(
      authRequest(
        "/api/organization/mfa/verify",
        {
          body: JSON.stringify({
            code: await generateTotp(enrollment.totpURI),
            method: "totp",
          }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(verificationResponse.status).toBe(200);

    // Auth status should show mfaSatisfied: true, mfaSatisfiedBy: "totp"
    const statusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const status = organizationAuthStatusResponseSchema.parse(await statusResponse.json());
    expect(status.mfaRequired).toBe(true);
    expect(status.mfaSatisfied).toBe(true);
    expect(status.mfaSatisfiedBy).toBe("totp");
    expect(status.mfaVerifiedUntil).not.toBeNull();
  });

  it("handles Better Auth passkey option endpoints with correct RpId", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    // Generate register options requires active session
    const registerOptionsResponse = await fetchWorker(
      authRequest(
        "/api/auth/passkey/generate-register-options",
        {
          headers: { cookie: sessionCookie },
          method: "GET",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(registerOptionsResponse.status).toBe(200);
    const registerOptions: unknown = await registerOptionsResponse.json();
    expect(registerOptions).toMatchObject({
      rp: { id: "localhost" },
    });

    // Generate authenticate options (public)
    const authOptionsResponse = await fetchWorker(
      authRequest(
        "/api/auth/passkey/generate-authenticate-options",
        {
          headers: {},
          method: "GET",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(authOptionsResponse.status).toBe(200);
    const authOptions: unknown = await authOptionsResponse.json();
    expect(authOptions).toMatchObject({
      rpId: "localhost",
    });
  });
});
