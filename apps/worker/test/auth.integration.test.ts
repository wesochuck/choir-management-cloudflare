import {
  accountSecurityResponseSchema,
  accountOrganizationsResponseSchema,
} from "@choir/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setupAuthIntegration,
  teardownAuthIntegration,
  BASE_AUTH_ORIGIN,
  INVITED_EMAIL,
  testEnv,
  enrollmentResponseSchema,
  authRequest,
  generateTotp,
  fetchWorker,
  responseCookie,
  seedInvitedUser,
  seedOrganizations,
  signInInvitedUser,
  readCapturedPlatformEmailsForTest,
} from "./auth.integration.fixture";
beforeEach(async () => setupAuthIntegration());
afterEach(async () => teardownAuthIntegration());

describe("Better Auth Worker integration", () => {
  it("does not expose authentication on a non-product hostname", async () => {
    const response = await fetchWorker(
      authRequest("/api/auth/get-session", undefined, "https://public.example.test"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: "Authentication is available only on a canonical product hostname.",
    });
  });

  it("does not expose authentication on an unregistered product subdomain", async () => {
    const response = await fetchWorker(
      authRequest("/api/auth/get-session", undefined, "http://unknown.localhost"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "not_found" });
  });

  it("does not create or email an unknown user through the public OTP endpoint", async () => {
    const response = await fetchWorker(
      authRequest("/api/auth/email-otp/send-verification-otp", {
        body: JSON.stringify({ email: "unknown@example.test", type: "sign-in" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(readCapturedPlatformEmailsForTest()).toEqual([]);
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM user").first(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM verification").first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("completes invited-user email OTP sign-in and stores no plaintext OTP", async () => {
    await seedInvitedUser();

    const sendResponse = await fetchWorker(
      authRequest("/api/auth/email-otp/send-verification-otp", {
        body: JSON.stringify({ email: INVITED_EMAIL, type: "sign-in" }),
        method: "POST",
      }),
    );
    expect(sendResponse.status).toBe(200);

    const capturedMessage = readCapturedPlatformEmailsForTest()[0];
    expect(capturedMessage).toBeDefined();
    const otp = capturedMessage?.text.match(/Use (\d{6}) to sign in/)?.[1];
    expect(otp).toMatch(/^\d{6}$/);

    const verification = await testEnv.CONTROL_DB.prepare(
      "SELECT value FROM verification WHERE identifier = ?",
    )
      .bind(`sign-in-otp-${INVITED_EMAIL}`)
      .first<{ value: string }>();
    expect(verification?.value).not.toContain(otp);

    const signInResponse = await fetchWorker(
      authRequest("/api/auth/sign-in/email-otp", {
        body: JSON.stringify({ email: INVITED_EMAIL, otp }),
        method: "POST",
      }),
    );
    expect(signInResponse.status).toBe(200);
    const sessionCookie = signInResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(sessionCookie).toContain("choir-management.session_token=");

    const sessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", {
        headers: { cookie: sessionCookie ?? "" },
        method: "GET",
      }),
    );
    expect(sessionResponse.status).toBe(200);
    const sessionBody: {
      readonly session?: Record<string, unknown>;
      readonly user?: Record<string, unknown>;
    } = await sessionResponse.json();
    expect(sessionBody).toMatchObject({
      session: { userId: "user-invited-member" },
      user: { email: INVITED_EMAIL, emailVerified: true },
    });
    expect(sessionBody.session).not.toHaveProperty("token");
  });

  it("expires stale auth cookies when a presented token fails verification", async () => {
    const response = await fetchWorker(
      authRequest("/api/auth/get-session", {
        headers: {
          cookie:
            "__Secure-choir-management.session_token=stale.value; choir-management.session_token=older",
        },
        method: "GET",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    const expirations = response.headers
      .getSetCookie()
      .filter((cookie) => cookie.includes("Max-Age=0"));
    expect(
      expirations.some(
        (cookie) =>
          cookie.includes("choir-management.session_token=") &&
          cookie.includes("HttpOnly") &&
          cookie.includes("Path=/"),
      ),
    ).toBe(true);
  });

  it("keeps the email-and-password sign-up path disabled", async () => {
    const response = await fetchWorker(
      authRequest("/api/auth/sign-up/email", {
        body: JSON.stringify({
          email: "self-registered@example.test",
          name: "Self Registered",
          password: "not-a-real-password",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM user").first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("lists and revokes the user's own active sessions", async () => {
    await seedInvitedUser();
    const firstSessionCookie = await signInInvitedUser();
    const secondSessionCookie = await signInInvitedUser();
    const accountListResponse = await fetchWorker(
      authRequest("/api/account/sessions", {
        headers: { cookie: firstSessionCookie },
      }),
    );
    expect(accountListResponse.status).toBe(200);
    const accountSessions: Record<string, unknown>[] = await accountListResponse.json();
    expect(accountSessions).toHaveLength(2);
    expect(accountSessions.every((entry) => !("token" in entry))).toBe(true);

    const sessionIds = await testEnv.CONTROL_DB.prepare(
      "SELECT id, token FROM session WHERE userId = ?",
    )
      .bind("user-invited-member")
      .all<{ id: string; token: string }>();
    const secondSessionId = sessionIds.results.find((row) =>
      decodeURIComponent(secondSessionCookie).includes(row.token),
    )?.id;
    expect(secondSessionId).toBeDefined();

    const accountRevokeResponse = await fetchWorker(
      authRequest("/api/account/sessions/revoke", {
        body: JSON.stringify({ sessionId: secondSessionId }),
        headers: { cookie: firstSessionCookie },
        method: "POST",
      }),
    );
    expect(accountRevokeResponse.status).toBe(200);

    const revokedSessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", {
        headers: { cookie: secondSessionCookie },
      }),
    );
    await expect(revokedSessionResponse.json()).resolves.toBeNull();
    const retainedSessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", {
        headers: { cookie: firstSessionCookie },
      }),
    );
    await expect(retainedSessionResponse.json()).resolves.toMatchObject({
      user: { id: "user-invited-member" },
    });
  });

  it("lists only the signed-in user's Organizations from a canonical product host", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    const sessionCookie = await signInInvitedUser();

    const anonymousResponse = await fetchWorker(
      authRequest("/api/account/organizations?organizationId=organization-bravo"),
    );
    expect(anonymousResponse.status).toBe(401);

    const response = await fetchWorker(
      authRequest("/api/account/organizations?organizationId=organization-no-access", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(response.status).toBe(200);
    expect(accountOrganizationsResponseSchema.parse(await response.json()).organizations).toEqual([
      {
        canonicalHostname: "alpha.localhost",
        canonicalStatus: "active",
        lifecycleState: "active",
        name: "Organization Alpha",
        organizationId: "organization-alpha",
        profileId: null,
        role: "administrator",
        slug: "alpha",
      },
      {
        canonicalHostname: "bravo.localhost",
        canonicalStatus: "active",
        lifecycleState: "active",
        name: "Organization Bravo",
        organizationId: "organization-bravo",
        profileId: null,
        role: "member",
        slug: "bravo",
      },
    ]);

    const publicHostResponse = await fetchWorker(
      new Request("https://public.example.test/api/account/organizations", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(publicHostResponse.status).toBe(404);
  });

  it("lets an invited user set and then change only their own password", async () => {
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();

    const initialStatus = await fetchWorker(
      authRequest("/api/account/security", { headers: { cookie: sessionCookie } }),
    );
    expect(accountSecurityResponseSchema.parse(await initialStatus.json()).passwordSet).toBe(false);

    const shortPassword = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({ mode: "set", newPassword: "too-short" }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(shortPassword.status).toBe(400);

    const firstPassword = "correct-horse-battery-staple";
    const setResponse = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({ mode: "set", newPassword: firstPassword }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(setResponse.status).toBe(200);
    expect(accountSecurityResponseSchema.parse(await setResponse.json()).passwordSet).toBe(true);
    await expect(
      testEnv.CONTROL_DB.prepare(
        "SELECT password FROM account WHERE userId = ? AND providerId = 'credential'",
      )
        .bind("user-invited-member")
        .first<{ password: string }>(),
    ).resolves.not.toMatchObject({ password: firstPassword });

    const wrongCurrentPassword = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({
          currentPassword: "incorrect-current-password",
          mode: "change",
          newPassword: "another-secure-password",
        }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(wrongCurrentPassword.status).toBe(400);

    const secondPassword = "a-different-secure-password";
    const changeResponse = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({
          currentPassword: firstPassword,
          mode: "change",
          newPassword: secondPassword,
        }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(changeResponse.status).toBe(200);

    const oldPasswordSignIn = await fetchWorker(
      authRequest("/api/auth/sign-in/email", {
        body: JSON.stringify({ email: INVITED_EMAIL, password: firstPassword }),
        method: "POST",
      }),
    );
    expect(oldPasswordSignIn.status).toBeGreaterThanOrEqual(400);
    const newPasswordSignIn = await fetchWorker(
      authRequest("/api/auth/sign-in/email", {
        body: JSON.stringify({ email: INVITED_EMAIL, password: secondPassword }),
        method: "POST",
      }),
    );
    expect(newPasswordSignIn.status).toBe(200);
  });

  it("blocks cross-origin cookie mutations while allowing same-origin requests to reach validation", async () => {
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    const crossOrigin = await fetchWorker(
      new Request(`${BASE_AUTH_ORIGIN}/api/account/password`, {
        body: JSON.stringify({ mode: "set", newPassword: "correct-horse-battery-staple" }),
        headers: {
          cookie: sessionCookie,
          "content-type": "application/json",
          origin: "http://evil.example.test",
        },
        method: "PUT",
      }),
    );
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toMatchObject({ code: "csrf_origin_mismatch" });

    const sameOrigin = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({ mode: "set", newPassword: "short" }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(sameOrigin.status).toBe(400);
  });

  it("recovers only an invited identity with a single-use link and revokes its sessions", async () => {
    await seedInvitedUser();
    const firstSessionCookie = await signInInvitedUser();
    await signInInvitedUser();
    const oldPassword = "an-existing-secure-password";
    const setResponse = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({ mode: "set", newPassword: oldPassword }),
        headers: { cookie: firstSessionCookie },
        method: "PUT",
      }),
    );
    expect(setResponse.status).toBe(200);

    const requestBody = {
      email: INVITED_EMAIL,
    };
    const requestResponse = await fetchWorker(
      authRequest("/api/auth/request-password-reset", {
        body: JSON.stringify(requestBody),
        method: "POST",
      }),
    );
    expect(requestResponse.status).toBe(200);
    const requestResult: unknown = await requestResponse.json();

    const unknownResponse = await fetchWorker(
      authRequest("/api/auth/request-password-reset", {
        body: JSON.stringify({ ...requestBody, email: "unknown@example.test" }),
        method: "POST",
      }),
    );
    expect(unknownResponse.status).toBe(200);
    await expect(unknownResponse.json()).resolves.toEqual(requestResult);
    expect(
      readCapturedPlatformEmailsForTest().filter((message) => message.kind === "password-reset"),
    ).toHaveLength(1);

    const resetEmail = readCapturedPlatformEmailsForTest().find(
      (message) => message.kind === "password-reset" && message.recipient === INVITED_EMAIL,
    );
    expect(resetEmail?.html).toContain(">Reset password</a>");
    const resetLinkValue = /Reset password: (\S+)/.exec(resetEmail?.text ?? "")?.[1];
    if (!resetLinkValue) {
      throw new Error("The captured reset email did not contain a link.");
    }
    const resetLink = new URL(resetLinkValue);
    expect(resetLink.origin).toBe(BASE_AUTH_ORIGIN);
    expect(resetLink.pathname).toBe("/reset-password");
    expect(resetLink.search).toBe("");
    const resetToken = new URLSearchParams(resetLink.hash.replace(/^#/, "")).get("token");
    expect(resetToken).toMatch(/^[a-zA-Z0-9_-]+$/);

    const newPassword = "a-recovered-secure-password";
    const resetResponse = await fetchWorker(
      authRequest("/api/auth/reset-password", {
        body: JSON.stringify({ newPassword, token: resetToken }),
        method: "POST",
      }),
    );
    expect(resetResponse.status).toBe(200);
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT COUNT(*) AS count FROM session WHERE userId = ?")
        .bind("user-invited-member")
        .first(),
    ).resolves.toEqual({ count: 0 });

    const reusedResponse = await fetchWorker(
      authRequest("/api/auth/reset-password", {
        body: JSON.stringify({ newPassword: "another-recovered-password", token: resetToken }),
        method: "POST",
      }),
    );
    expect(reusedResponse.status).toBe(400);

    const oldPasswordSignIn = await fetchWorker(
      authRequest("/api/auth/sign-in/email", {
        body: JSON.stringify({ email: INVITED_EMAIL, password: oldPassword }),
        method: "POST",
      }),
    );
    expect(oldPasswordSignIn.status).toBeGreaterThanOrEqual(400);
    const newPasswordSignIn = await fetchWorker(
      authRequest("/api/auth/sign-in/email", {
        body: JSON.stringify({ email: INVITED_EMAIL, password: newPassword }),
        method: "POST",
      }),
    );
    expect(newPasswordSignIn.status).toBe(200);
  });

  it("completes password sign-in challenges with TOTP and a recovery code", async () => {
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    const password = "a-password-with-second-factor";
    const setResponse = await fetchWorker(
      authRequest("/api/account/password", {
        body: JSON.stringify({ mode: "set", newPassword: password }),
        headers: { cookie: sessionCookie },
        method: "PUT",
      }),
    );
    expect(setResponse.status).toBe(200);

    const enableResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/enable", {
        body: JSON.stringify({ password }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(enableResponse.status).toBe(200);
    const enrollment = enrollmentResponseSchema.parse(await enableResponse.json());
    const verifyEnrollmentResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/verify-totp", {
        body: JSON.stringify({
          code: await generateTotp(enrollment.totpURI),
          trustDevice: false,
        }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(verifyEnrollmentResponse.status).toBe(200);

    const beginPasswordSignIn = async () => {
      const response = await fetchWorker(
        authRequest("/api/auth/sign-in/email", {
          body: JSON.stringify({ email: INVITED_EMAIL, password }),
          method: "POST",
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.clone().json()).resolves.toMatchObject({
        twoFactorMethods: ["totp"],
        twoFactorRedirect: true,
      });
      return responseCookie(response, "choir-management.two_factor");
    };

    const totpChallengeCookie = await beginPasswordSignIn();
    const totpResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/verify-totp", {
        body: JSON.stringify({
          code: await generateTotp(enrollment.totpURI),
          trustDevice: false,
        }),
        headers: { cookie: totpChallengeCookie },
        method: "POST",
      }),
    );
    expect(totpResponse.status).toBe(200);
    const totpSessionCookie = responseCookie(totpResponse, "choir-management.session_token");
    const totpSessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", { headers: { cookie: totpSessionCookie } }),
    );
    await expect(totpSessionResponse.json()).resolves.toMatchObject({
      user: { id: "user-invited-member" },
    });

    const recoveryChallengeCookie = await beginPasswordSignIn();
    const recoveryResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/verify-backup-code", {
        body: JSON.stringify({
          code: enrollment.backupCodes[0],
          trustDevice: false,
        }),
        headers: { cookie: recoveryChallengeCookie },
        method: "POST",
      }),
    );
    expect(recoveryResponse.status).toBe(200);
    const recoverySessionCookie = responseCookie(
      recoveryResponse,
      "choir-management.session_token",
    );
    const recoverySessionResponse = await fetchWorker(
      authRequest("/api/auth/get-session", { headers: { cookie: recoverySessionCookie } }),
    );
    await expect(recoverySessionResponse.json()).resolves.toMatchObject({
      user: { id: "user-invited-member" },
    });
  });

  it("enforces rate limits on authentication endpoints and returns 429", async () => {
    const sendOtp = (ip: string) =>
      fetchWorker(
        authRequest("/api/auth/email-otp/send-verification-otp", {
          body: JSON.stringify({ email: "unknown@example.test", type: "sign-in" }),
          headers: { "cf-connecting-ip": ip },
          method: "POST",
        }),
      );

    const clientIp = "198.51.100.1";
    // 3 allowed per 60-second window
    const res1 = await sendOtp(clientIp);
    expect(res1.status).toBe(200);

    const res2 = await sendOtp(clientIp);
    expect(res2.status).toBe(200);

    const res3 = await sendOtp(clientIp);
    expect(res3.status).toBe(200);

    // 4th request exceeds rate limit
    const res4 = await sendOtp(clientIp);
    expect(res4.status).toBe(429);
    expect(res4.headers.get("x-retry-after")).toBeDefined();
    await expect(res4.json()).resolves.toMatchObject({
      message: "Too many requests. Please try again later.",
    });

    // A different IP is not blocked
    const otherIpRes = await sendOtp("198.51.100.2");
    expect(otherIpRes.status).toBe(200);
  });

  it("cleans up expired rateLimit database records when a window expires", async () => {
    const clientIp = "198.51.100.10";
    const now = Date.now();
    const expiredTimestamp = now - 120_000; // 2 minutes ago (> 60s max window)

    // Seed expired rate limit entries representing old windows from various keys
    await testEnv.CONTROL_DB.batch([
      testEnv.CONTROL_DB.prepare(
        "INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        `${clientIp}|/email-otp/send-verification-otp`,
        3,
        expiredTimestamp,
      ),
      testEnv.CONTROL_DB.prepare(
        "INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), "198.51.100.11|/sign-in/email", 5, expiredTimestamp),
      testEnv.CONTROL_DB.prepare(
        "INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        "198.51.100.12|/email-otp/send-verification-otp",
        2,
        expiredTimestamp,
      ),
    ]);

    // Also seed an active entry that is NOT expired
    const activeKey = "198.51.100.99|/email-otp/send-verification-otp";
    await testEnv.CONTROL_DB.prepare(
      "INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), activeKey, 1, now)
      .run();

    // Verify initial state has 4 rows
    const beforeCount = await testEnv.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS total FROM rateLimit",
    ).first<{ total: number }>();
    expect(beforeCount?.total).toBe(4);

    // Make a request from clientIp whose window has expired.
    // Better Auth detects now - data.lastRequest > windowInMs, resets the counter,
    // and triggers background cleanup (deleteExpiredRows) via waitUntil.
    const response = await fetchWorker(
      authRequest("/api/auth/email-otp/send-verification-otp", {
        body: JSON.stringify({ email: "unknown@example.test", type: "sign-in" }),
        headers: { "cf-connecting-ip": clientIp },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);

    // Check remaining rateLimit rows
    const rows = await testEnv.CONTROL_DB.prepare(
      "SELECT key, count, lastRequest FROM rateLimit",
    ).all<{ count: number; key: string; lastRequest: number }>();

    // Expired rows for 198.51.100.11 and 198.51.100.12 must have been pruned
    const keys = rows.results.map((r) => r.key);
    expect(keys).not.toContain("198.51.100.11|/sign-in/email");
    expect(keys).not.toContain("198.51.100.12|/email-otp/send-verification-otp");

    // The active row should still be present
    expect(keys).toContain(activeKey);

    // The requesting client row should be refreshed with count = 1 and new timestamp
    const clientRow = rows.results.find(
      (r) => r.key === `${clientIp}|/email-otp/send-verification-otp`,
    );
    expect(clientRow).toBeDefined();
    expect(clientRow?.count).toBe(1);
    expect(clientRow?.lastRequest).toBeGreaterThanOrEqual(now);

    // Table entries are bounded to active windows
    expect(rows.results.length).toBe(2);
  });
});
