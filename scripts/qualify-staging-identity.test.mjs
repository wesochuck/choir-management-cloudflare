import { describe, expect, it } from "vitest";

import {
  identityQualificationPlan,
  parsePasswordResetUrl,
  safeIdentityQualificationSummary,
} from "./qualify-staging-identity.mjs";

describe("staging identity qualification helpers", () => {
  it("plans invitation activation, recovery, replay, and isolation evidence", () => {
    const plan = identityQualificationPlan().join("\n");
    expect(plan).toContain("pending Organization invitation");
    expect(plan).toContain("password recovery");
    expect(plan).toContain("wrong Organization");
  });

  it("parses only a product-host password reset URL and validates its token", () => {
    expect(
      parsePasswordResetUrl(
        "https://staging.musicsite.org/reset-password#token=valid_reset-token-123456",
        "https://staging.musicsite.org",
      ),
    ).toBe("valid_reset-token-123456");
    expect(() =>
      parsePasswordResetUrl(
        "https://lcc.staging.musicsite.org/reset-password#token=valid_reset-token-123456",
        "https://staging.musicsite.org",
      ),
    ).toThrow("staging password-reset URL");
    expect(() =>
      parsePasswordResetUrl(
        "https://staging.musicsite.org/reset-password#token=too-short",
        "https://staging.musicsite.org",
      ),
    ).toThrow("valid token");
  });

  it("keeps the qualification summary bounded", () => {
    const summary = safeIdentityQualificationSummary({
      crossOrganizationRejected: true,
      firstPasswordSet: true,
      invitationAccepted: true,
      passwordReset: true,
      recoveredPasswordSignIn: true,
      resetReplayRejected: true,
      qualificationEmail: "qual-identity@example.test",
      qualificationProfileId: "11111111-1111-4111-8111-111111111111",
      secretPassword: "must-not-appear",
    });
    expect(summary).toEqual({
      crossOrganizationRejected: true,
      firstPasswordSet: true,
      invitationAccepted: true,
      passwordReset: true,
      recoveredPasswordSignIn: true,
      resetReplayRejected: true,
      qualificationEmail: "qual-identity@example.test",
      qualificationProfileId: "11111111-1111-4111-8111-111111111111",
    });
    expect(JSON.stringify(summary)).not.toContain("must-not-appear");
  });
});
