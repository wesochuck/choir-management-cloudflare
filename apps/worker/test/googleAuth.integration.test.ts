import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALPHA_AUTH_ORIGIN,
  BASE_AUTH_ORIGIN,
  authRequest,
  fetchWorker,
  seedInvitedUser,
  seedOrganizations,
  setupAuthIntegration,
  teardownAuthIntegration,
  testEnv,
} from "./auth.integration.fixture";
import type { Env } from "../src/env";
import { classifyAuthOperation } from "../src/security/edgeRateLimit";

const googleTestEnv: Env = {
  ...testEnv,
  GOOGLE_CLIENT_ID: "mock-google-client-id",
  GOOGLE_CLIENT_SECRET: "mock-google-client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "http://localhost/api/auth/callback/google",
};

interface SocialInitResponse {
  readonly redirect?: boolean | undefined;
  readonly url?: string | undefined;
}

function createMockGoogleIdToken(claims: {
  readonly email: string;
  readonly email_verified: boolean;
  readonly name?: string | undefined;
  readonly picture?: string | undefined;
  readonly sub: string;
}): string {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "mock-google-client-id",
    exp: now + 3600,
    iat: now,
    iss: "https://accounts.google.com",
    name: claims.name ?? "Test User",
    picture: claims.picture ?? "https://example.com/photo.jpg",
    ...claims,
  };
  const b64 = (obj: unknown): string =>
    String(Buffer.from(JSON.stringify(obj), "utf8").toString("base64url"));
  const encodedHeader = b64(header);
  const encodedPayload = b64(payload);
  return `${encodedHeader}.${encodedPayload}.mock-signature`;
}

function extractCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";", 1)[0])
    .join("; ");
}

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function mockGoogleTokenEndpoint(getIdToken: () => string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = extractUrl(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return Promise.resolve(
        Response.json({
          access_token: "mock-google-access-token",
          expires_in: 3600,
          id_token: getIdToken(),
          token_type: "Bearer",
        }),
      );
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  });
}

beforeEach(async () => {
  await setupAuthIntegration();
  await seedInvitedUser();
  await seedOrganizations();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await teardownAuthIntegration();
});

describe("Google OAuth integration", () => {
  it("initiates Google OAuth with centralized redirect URI regardless of tenant origin", async () => {
    const callbackURL = "http://alpha.localhost/dashboard";
    const errorCallbackURL = "http://alpha.localhost/sign-in";

    const response = await fetchWorker(
      authRequest(
        "/api/auth/sign-in/social",
        {
          body: JSON.stringify({
            callbackURL,
            errorCallbackURL,
            provider: "google",
          }),
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    expect(response.status).toBe(200);
    const body: SocialInitResponse = await response.json();
    expect(body.url).toBeDefined();

    const authUrl = new URL(body.url ?? "");
    expect(authUrl.origin).toBe("https://accounts.google.com");
    expect(authUrl.searchParams.get("client_id")).toBe("mock-google-client-id");
    // Verify redirect_uri is centralized to the exact product-base host, NOT alpha.localhost
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/auth/callback/google",
    );
    expect(authUrl.searchParams.get("prompt")).toBe("select_account");
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    expect(authUrl.searchParams.get("scope")).toContain("email");
    expect(authUrl.searchParams.get("scope")).toContain("profile");
    expect(authUrl.searchParams.get("scope")).toContain("openid");

    // Cookies should include state and code_verifier
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c) => c.includes("state="))).toBe(true);
  });

  it("rejects sign-up for unknown users not present in the user table", async () => {
    const mockIdToken = createMockGoogleIdToken({
      email: "unknown.stranger@example.test",
      email_verified: true,
      sub: "google-sub-unknown",
    });
    mockGoogleTokenEndpoint(() => mockIdToken);

    // 1. Initiate on tenant domain
    const initResponse = await fetchWorker(
      authRequest(
        "/api/auth/sign-in/social",
        {
          body: JSON.stringify({
            callbackURL: "http://alpha.localhost/dashboard",
            errorCallbackURL: "http://alpha.localhost/sign-in",
            provider: "google",
          }),
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    const initBody: SocialInitResponse = await initResponse.json();
    expect(initBody.url).toBeDefined();
    const authUrl = new URL(initBody.url ?? "");
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookieHeader = extractCookies(initResponse);

    // 2. Callback to centralized endpoint
    const callbackResponse = await fetchWorker(
      authRequest(
        `/api/auth/callback/google?code=mock-auth-code&state=${encodeURIComponent(state ?? "")}`,
        {
          headers: {
            cookie: cookieHeader,
          },
          method: "GET",
        },
        BASE_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    // Should redirect to errorCallbackURL with signup_disabled
    expect(callbackResponse.status).toBe(302);
    const location = callbackResponse.headers.get("location");
    expect(location).toBeDefined();
    const redirectUrl = new URL(location ?? "");
    expect(redirectUrl.pathname).toBe("/sign-in");
    expect(redirectUrl.searchParams.get("error")).toBe("signup_disabled");

    // Verify user table was NOT touched
    const user = await googleTestEnv.CONTROL_DB.prepare("SELECT id FROM user WHERE email = ?")
      .bind("unknown.stranger@example.test")
      .first();
    expect(user).toBeNull();

    // Verify account table was NOT touched
    const account = await googleTestEnv.CONTROL_DB.prepare(
      "SELECT id FROM account WHERE accountId = ?",
    )
      .bind("google-sub-unknown")
      .first();
    expect(account).toBeNull();
  });

  it("blocks linking when existing user has not verified their email (emailVerified = 0)", async () => {
    const unverifiedEmail = "unverified.invited@example.test";
    const now = Date.now();
    await googleTestEnv.CONTROL_DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES (?, ?, ?, 0, ?, ?, 0)`,
    )
      .bind("user-unverified", "Unverified User", unverifiedEmail, now, now)
      .run();

    const mockIdToken = createMockGoogleIdToken({
      email: unverifiedEmail,
      email_verified: true,
      sub: "google-sub-unverified",
    });
    mockGoogleTokenEndpoint(() => mockIdToken);

    // 1. Initiate
    const initResponse = await fetchWorker(
      authRequest(
        "/api/auth/sign-in/social",
        {
          body: JSON.stringify({
            callbackURL: "http://alpha.localhost/dashboard",
            errorCallbackURL: "http://alpha.localhost/sign-in",
            provider: "google",
          }),
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    const initBody: SocialInitResponse = await initResponse.json();
    expect(initBody.url).toBeDefined();
    const authUrl = new URL(initBody.url ?? "");
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookieHeader = extractCookies(initResponse);

    // 2. Callback
    const callbackResponse = await fetchWorker(
      authRequest(
        `/api/auth/callback/google?code=mock-auth-code&state=${encodeURIComponent(state ?? "")}`,
        {
          headers: {
            cookie: cookieHeader,
          },
          method: "GET",
        },
        BASE_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    // Should redirect to errorCallbackURL with account_not_linked
    expect(callbackResponse.status).toBe(302);
    const location = callbackResponse.headers.get("location");
    expect(location).toBeDefined();
    const redirectUrl = new URL(location ?? "");
    expect(redirectUrl.pathname).toBe("/sign-in");
    expect(redirectUrl.searchParams.get("error")).toBe("account_not_linked");

    // Verify account table was NOT linked
    const account = await googleTestEnv.CONTROL_DB.prepare(
      "SELECT id FROM account WHERE accountId = ?",
    )
      .bind("google-sub-unverified")
      .first();
    expect(account).toBeNull();
  });

  it("links and signs in a verified existing user (emailVerified = 1)", async () => {
    const verifiedEmail = "verified.member@example.test";
    const now = Date.now();
    await googleTestEnv.CONTROL_DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES (?, ?, ?, 1, ?, ?, 0)`,
    )
      .bind("user-verified-member", "Verified Member", verifiedEmail, now, now)
      .run();

    const currentIdToken = createMockGoogleIdToken({
      email: verifiedEmail,
      email_verified: true,
      name: "Verified Member Google",
      sub: "google-sub-verified-123",
    });
    mockGoogleTokenEndpoint(() => currentIdToken);

    // 1. Initiate on tenant origin
    const initResponse = await fetchWorker(
      authRequest(
        "/api/auth/sign-in/social",
        {
          body: JSON.stringify({
            callbackURL: "http://alpha.localhost/dashboard",
            errorCallbackURL: "http://alpha.localhost/sign-in",
            provider: "google",
          }),
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    const initBody: SocialInitResponse = await initResponse.json();
    expect(initBody.url).toBeDefined();
    const authUrl = new URL(initBody.url ?? "");
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookieHeader = extractCookies(initResponse);

    // 2. Callback
    const callbackResponse = await fetchWorker(
      authRequest(
        `/api/auth/callback/google?code=mock-auth-code&state=${encodeURIComponent(state ?? "")}`,
        {
          headers: {
            cookie: cookieHeader,
          },
          method: "GET",
        },
        BASE_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    // Should redirect to callbackURL
    expect(callbackResponse.status).toBe(302);
    const location = callbackResponse.headers.get("location");
    expect(location).toBeDefined();
    const redirectUrl = new URL(location ?? "");
    expect(redirectUrl.origin).toBe("http://alpha.localhost");
    expect(redirectUrl.pathname).toBe("/dashboard");

    // Session cookie should be set
    const setCookies = callbackResponse.headers.getSetCookie();
    expect(setCookies.some((c) => c.includes("session_token="))).toBe(true);

    // Verify account was created with providerId 'google'
    const account = await googleTestEnv.CONTROL_DB.prepare(
      "SELECT providerId, accountId, userId FROM account WHERE accountId = ?",
    )
      .bind("google-sub-verified-123")
      .first<{ providerId: string; accountId: string; userId: string }>();
    expect(account).toBeDefined();
    expect(account?.providerId).toBe("google");
    expect(account?.userId).toBe("user-verified-member");

    // Verify user count did not change
    const userCount = await googleTestEnv.CONTROL_DB.prepare(
      "SELECT COUNT(*) as count FROM user WHERE email = ?",
    )
      .bind(verifiedEmail)
      .first<{ count: number }>();
    expect(userCount?.count).toBe(1);

    // 3. Second sign-in with already-linked account succeeds cleanly
    const init2 = await fetchWorker(
      authRequest(
        "/api/auth/sign-in/social",
        {
          body: JSON.stringify({
            callbackURL: "http://alpha.localhost/dashboard",
            errorCallbackURL: "http://alpha.localhost/sign-in",
            provider: "google",
          }),
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );
    const init2Body: SocialInitResponse = await init2.json();
    expect(init2Body.url).toBeDefined();
    const auth2Url = new URL(init2Body.url ?? "");
    const state2 = auth2Url.searchParams.get("state");
    expect(state2).toBeTruthy();
    const cookieHeader2 = extractCookies(init2);

    const callback2 = await fetchWorker(
      authRequest(
        `/api/auth/callback/google?code=mock-auth-code-2&state=${encodeURIComponent(state2 ?? "")}`,
        {
          headers: {
            cookie: cookieHeader2,
          },
          method: "GET",
        },
        BASE_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    expect(callback2.status).toBe(302);
    expect(callback2.headers.get("location")).toBe("http://alpha.localhost/dashboard");

    // Verify account count is still 1
    const accountCount = await googleTestEnv.CONTROL_DB.prepare(
      "SELECT COUNT(*) as count FROM account WHERE accountId = ?",
    )
      .bind("google-sub-verified-123")
      .first<{ count: number }>();
    expect(accountCount?.count).toBe(1);
  });

  it("preserves destination path such as accept-invitation on callback", async () => {
    const verifiedEmail = "verified.invitee@example.test";
    const now = Date.now();
    await googleTestEnv.CONTROL_DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES (?, ?, ?, 1, ?, ?, 0)`,
    )
      .bind("user-verified-invitee", "Verified Invitee", verifiedEmail, now, now)
      .run();

    const currentIdToken = createMockGoogleIdToken({
      email: verifiedEmail,
      email_verified: true,
      name: "Verified Invitee",
      sub: "google-sub-invitee-456",
    });
    mockGoogleTokenEndpoint(() => currentIdToken);

    const returnUrl = "http://alpha.localhost/accept-invitation?id=inv-12345";
    const initResponse = await fetchWorker(
      authRequest(
        "/api/auth/sign-in/social",
        {
          body: JSON.stringify({
            callbackURL: returnUrl,
            errorCallbackURL: "http://alpha.localhost/sign-in",
            provider: "google",
          }),
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    const initBody: SocialInitResponse = await initResponse.json();
    expect(initBody.url).toBeDefined();
    const authUrl = new URL(initBody.url ?? "");
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookieHeader = extractCookies(initResponse);

    const callbackResponse = await fetchWorker(
      authRequest(
        `/api/auth/callback/google?code=mock-auth-code&state=${encodeURIComponent(state ?? "")}`,
        {
          headers: {
            cookie: cookieHeader,
          },
          method: "GET",
        },
        BASE_AUTH_ORIGIN,
      ),
      googleTestEnv,
    );

    expect(callbackResponse.status).toBe(302);
    const location = callbackResponse.headers.get("location");
    expect(location).toBe(returnUrl);
  });

  it("returns 404 when auth endpoints are requested on a custom domain", async () => {
    // Insert custom domain for organization-alpha
    const now = new Date().toISOString();
    await googleTestEnv.CONTROL_DB.prepare(
      `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES (?, ?, ?, 'custom_public', 'active', 1, ?, ?)`,
    )
      .bind("domain-custom", "organization-alpha", "custom.example.org", now, now)
      .run();

    const response = await fetchWorker(
      authRequest("/api/auth/callback/google", { method: "GET" }, "http://custom.example.org"),
      googleTestEnv,
    );
    expect(response.status).toBe(404);
  });

  it("correctly classifies auth operations for rate limiting", () => {
    expect(classifyAuthOperation("/api/auth/callback/google")).toBe("auth:callback");
    expect(classifyAuthOperation("/api/auth/sign-in/social")).toBe("auth:sensitive");
  });
});
