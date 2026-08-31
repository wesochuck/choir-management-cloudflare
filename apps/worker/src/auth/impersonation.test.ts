import { describe, expect, it } from "vitest";
import {
  createImpersonationToken,
  formatImpersonationClearCookie,
  formatImpersonationSetCookie,
  readImpersonationCookie,
  verifyImpersonationCookie,
} from "./impersonation";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_ORG_ID = "11111111-1111-4111-8111-111111111111";
const TEST_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const TEST_ADMIN_USER_ID = "33333333-3333-4333-8333-333333333333";
const TEST_ADMIN_SESSION_ID = "session-44444444-4444-4444-8444-444444444444";

describe("impersonation helper", () => {
  it("issues and verifies a valid impersonation token cookie", async () => {
    const now = new Date("2026-08-30T12:00:00Z");
    const { token, expiresAt } = await createImpersonationToken(
      TEST_SECRET,
      TEST_ORG_ID,
      TEST_PROFILE_ID,
      TEST_ADMIN_USER_ID,
      TEST_ADMIN_SESSION_ID,
      now,
    );

    expect(token).toBeTruthy();
    expect(expiresAt).toBe(new Date("2026-08-30T13:00:00Z").toISOString());

    const cookieHeader = `session=abc; choir_impersonation=${token}; other=123`;
    expect(readImpersonationCookie(cookieHeader)).toBe(token);

    const verified = await verifyImpersonationCookie(
      TEST_SECRET,
      TEST_ORG_ID,
      TEST_ADMIN_USER_ID,
      TEST_ADMIN_SESSION_ID,
      cookieHeader,
      now,
    );

    expect(verified.active).toBe(true);
    expect(verified.impersonatedProfileId).toBe(TEST_PROFILE_ID);
    expect(verified.adminUserId).toBe(TEST_ADMIN_USER_ID);
    expect(verified.expiresAt).toBe(expiresAt);
  });

  it("rejects an expired token or mismatched user/org/session", async () => {
    const now = new Date("2026-08-30T12:00:00Z");
    const { token } = await createImpersonationToken(
      TEST_SECRET,
      TEST_ORG_ID,
      TEST_PROFILE_ID,
      TEST_ADMIN_USER_ID,
      TEST_ADMIN_SESSION_ID,
      now,
    );

    const cookieHeader = `choir_impersonation=${token}`;

    // Expired
    const expired = await verifyImpersonationCookie(
      TEST_SECRET,
      TEST_ORG_ID,
      TEST_ADMIN_USER_ID,
      TEST_ADMIN_SESSION_ID,
      cookieHeader,
      new Date("2026-08-30T13:01:00Z"),
    );
    expect(expired.active).toBe(false);

    // Wrong organization
    const wrongOrg = await verifyImpersonationCookie(
      TEST_SECRET,
      "99999999-9999-4999-8999-999999999999",
      TEST_ADMIN_USER_ID,
      TEST_ADMIN_SESSION_ID,
      cookieHeader,
      now,
    );
    expect(wrongOrg.active).toBe(false);

    // Wrong admin user
    const wrongUser = await verifyImpersonationCookie(
      TEST_SECRET,
      TEST_ORG_ID,
      "other-user",
      TEST_ADMIN_SESSION_ID,
      cookieHeader,
      now,
    );
    expect(wrongUser.active).toBe(false);

    // Wrong admin session
    const wrongSession = await verifyImpersonationCookie(
      TEST_SECRET,
      TEST_ORG_ID,
      TEST_ADMIN_USER_ID,
      "other-session-id",
      cookieHeader,
      now,
    );
    expect(wrongSession.active).toBe(false);
  });

  it("formats set and clear cookie headers correctly", () => {
    const setCookie = formatImpersonationSetCookie("my-token", true);
    expect(setCookie).toContain("choir_impersonation=my-token");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=3600");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");

    const clearCookie = formatImpersonationClearCookie(true);
    expect(clearCookie).toContain("choir_impersonation=");
    expect(clearCookie).toContain("Max-Age=0");
    expect(clearCookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });
});
