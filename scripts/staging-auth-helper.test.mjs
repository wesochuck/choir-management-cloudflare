import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeBase32,
  generateTotp,
  hasUsableSessionCookie,
  passwordSignIn,
  readCachedSession,
  saveCachedSession,
  clearCachedSession,
  sessionCookieFromResponse,
} from "./staging-auth-helper.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staging auth helper", () => {
  it("decodes valid base32 string without padding", () => {
    const bytes = decodeBase32("JBSWY3DPEHPK3PXP");
    expect(bytes instanceof Uint8Array).toBe(true);
    expect(bytes.length).toBe(10);
  });

  it("handles lowercase and padding", () => {
    const bytes = decodeBase32("jbswy3dpehpk3pxp====");
    expect(bytes.length).toBe(10);
  });

  it("throws on invalid characters", () => {
    expect(() => decodeBase32("INVALID1890!")).toThrow(/not valid base32/);
  });

  it("generates expected 6-digit code for standard secret", async () => {
    // Standard test secret "JBSWY3DPEHPK3PXP" (base32 for "Hello!\xde\xad\xbe\xef")
    const timestamp = 1600000000000; // Counter 53333333
    const code = await generateTotp("JBSWY3DPEHPK3PXP", timestamp);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("parses otpauth URI format", async () => {
    const uri =
      "otpauth://totp/Choir%20Management:admin%40staging.musicsite.org?secret=JBSWY3DPEHPK3PXP&issuer=Choir%20Management";
    const code = await generateTotp(uri, 1600000000000);
    const codeFromSecret = await generateTotp("JBSWY3DPEHPK3PXP", 1600000000000);
    expect(code).toBe(codeFromSecret);
  });

  it("extracts choir-management.session_token from response headers", () => {
    const mockResponse = {
      headers: {
        getSetCookie: () => [
          "choir-management.session_token=abc123xyz; Path=/; HttpOnly; Secure; SameSite=Lax",
          "other_cookie=value; Path=/",
        ],
        get: () => null,
      },
    };
    const cookie = sessionCookieFromResponse(mockResponse);
    expect(cookie).toContain("choir-management.session_token=abc123xyz");
  });

  it("does not treat an expired secure session cookie as usable", () => {
    expect(hasUsableSessionCookie("__Secure-choir-management.session_token=; Max-Age=0")).toBe(
      false,
    );
    expect(hasUsableSessionCookie("__Secure-choir-management.session_token=active-session")).toBe(
      true,
    );
  });

  it("recognizes a password sign-in that requires account MFA", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        headers: {
          get: () => null,
          getSetCookie: () => [
            "__Secure-choir-management.session_token=; Max-Age=0",
            "__Secure-choir-management.session_data=; Max-Age=0",
            "__Secure-choir-management.two_factor=challenge-cookie; Max-Age=600",
          ],
        },
        json: async () => ({ twoFactorMethods: ["totp"], twoFactorRedirect: true }),
        ok: true,
        status: 200,
      }),
    );

    await expect(
      passwordSignIn("https://staging.musicsite.org", "test-user@example.test", "password"),
    ).resolves.toMatchObject({ twoFactorRequired: true });
  });

  it("saves, reads, and clears cached session correctly", () => {
    const testUrl = "https://staging.musicsite.org";
    const testEmail = "test-user@example.test";
    const testCookie = "choir-management.session_token=mock-token-for-test-lifecycle";
    const testCacheFile = ".cache/test-staging-session.json";

    saveCachedSession(testUrl, testEmail, testCookie, testCacheFile);
    const retrieved = readCachedSession(testUrl, testEmail, testCacheFile);
    expect(retrieved).toBe(testCookie);

    clearCachedSession(testCacheFile);
    const afterClear = readCachedSession(testUrl, testEmail, testCacheFile);
    expect(afterClear).toBeNull();
  });
});
