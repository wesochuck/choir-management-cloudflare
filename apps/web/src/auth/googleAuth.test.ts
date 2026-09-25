import { describe, expect, it } from "vitest";
import { buildOAuthDestinations, mapOAuthErrorMessage } from "./googleAuth";

describe("buildOAuthDestinations", () => {
  it("creates callback and errorCallback on current origin defaulting to /login?oauth=complete", () => {
    const destinations = buildOAuthDestinations("https://alpha.example.org/login");
    expect(destinations.callbackURL).toBe("https://alpha.example.org/login?oauth=complete");
    expect(destinations.errorCallbackURL).toBe("https://alpha.example.org/login");
  });

  it("preserves explicit returnTo when safe", () => {
    const destinations = buildOAuthDestinations(
      "https://alpha.example.org/login",
      "/accept-invitation?id=invite-456",
    );
    expect(destinations.callbackURL).toBe(
      "https://alpha.example.org/login?oauth=complete&returnTo=%2Faccept-invitation%3Fid%3Dinvite-456",
    );
    expect(destinations.errorCallbackURL).toBe(
      "https://alpha.example.org/login?returnTo=%2Faccept-invitation%3Fid%3Dinvite-456",
    );
  });

  it("preserves returnTo from searchParams when explicit returnTo not provided", () => {
    const destinations = buildOAuthDestinations(
      "https://alpha.example.org/login?returnTo=%2Fadmin%2Froster",
    );
    expect(destinations.callbackURL).toBe(
      "https://alpha.example.org/login?oauth=complete&returnTo=%2Fadmin%2Froster",
    );
    expect(destinations.errorCallbackURL).toBe(
      "https://alpha.example.org/login?returnTo=%2Fadmin%2Froster",
    );
  });

  it("rejects unsafe returnTo protocols or relative escape attempts", () => {
    const evilTargets = [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/%5cevil.com",
      "/safe\x00evil",
    ];
    for (const evil of evilTargets) {
      const destinations = buildOAuthDestinations(
        `https://alpha.example.org/login?returnTo=${encodeURIComponent(evil)}`,
      );
      expect(destinations.callbackURL).toBe("https://alpha.example.org/login?oauth=complete");
      expect(destinations.errorCallbackURL).toBe("https://alpha.example.org/login");
    }
  });

  it("omits redundant returnTo=/dashboard", () => {
    const destinations = buildOAuthDestinations(
      "https://alpha.example.org/login?returnTo=/dashboard",
    );
    expect(destinations.callbackURL).toBe("https://alpha.example.org/login?oauth=complete");
    expect(destinations.errorCallbackURL).toBe("https://alpha.example.org/login");
  });
});

describe("mapOAuthErrorMessage", () => {
  it("maps signup_disabled to uninvited user message", () => {
    const msg = mapOAuthErrorMessage("signup_disabled");
    expect(msg).toBe(
      "This Google account cannot sign in. Use the email address that was invited, or ask an Organization Owner or Administrator for access.",
    );
    expect(mapOAuthErrorMessage("signup disabled")).toBe(msg);
  });

  it("maps account_not_linked to unverified email message", () => {
    const msg = mapOAuthErrorMessage("account_not_linked");
    expect(msg).toBe(
      "Google sign-in is not available for this account yet. Sign in with an email code once to verify your invited email, then you can use Google.",
    );
    expect(mapOAuthErrorMessage("email_not_verified")).toBe(msg);
  });

  it("maps access_denied and canceled to user cancellation message", () => {
    expect(mapOAuthErrorMessage("access_denied")).toBe("Google sign-in was canceled.");
    expect(mapOAuthErrorMessage("cancelled")).toBe("Google sign-in was canceled.");
    expect(mapOAuthErrorMessage("canceled")).toBe("Google sign-in was canceled.");
  });

  it("maps unknown errors to generic safe message without raw provider leak", () => {
    expect(mapOAuthErrorMessage("server_internal_error_bad_token")).toBe(
      "Unable to complete Google sign-in. Please try again or use another sign-in method.",
    );
  });

  it("returns null for empty or missing error", () => {
    expect(mapOAuthErrorMessage(null)).toBeNull();
    expect(mapOAuthErrorMessage(undefined)).toBeNull();
    expect(mapOAuthErrorMessage("")).toBeNull();
  });
});
