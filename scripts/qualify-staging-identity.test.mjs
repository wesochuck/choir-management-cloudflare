import { describe, expect, it } from "vitest";

import {
  identityQualificationPlan,
  parsePasswordResetUrl,
  safeIdentityQualificationSummary,
  selectQualificationProfileId,
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

  it("uses the Membership-linked Profile before a fixture-name match", () => {
    const profiles = [
      { displayName: "Qualification Identity Temp stale", id: "profile-stale" },
      { displayName: "Existing linked singer", id: "profile-linked" },
    ];
    expect(
      selectQualificationProfileId(
        profiles,
        { profileId: "profile-linked" },
        "Qualification Identity Temp stale",
      ),
    ).toBe("profile-linked");
  });

  it("reuses an unlinked fixture Profile by name without assuming Profiles contain email", () => {
    const profiles = [
      { displayName: "Qualification Identity Temp controlled", id: "profile-controlled" },
    ];
    expect(
      selectQualificationProfileId(
        profiles,
        { profileId: null },
        "Qualification Identity Temp controlled",
      ),
    ).toBe("profile-controlled");
    expect(
      selectQualificationProfileId(
        profiles,
        { profileId: null },
        "Qualification Identity Temp missing",
      ),
    ).toBeNull();
  });

  it("rejects a Membership link whose Organization Profile is absent", () => {
    expect(() =>
      selectQualificationProfileId([], { profileId: "profile-missing" }, "ignored"),
    ).toThrow("missing Organization Profile");
  });
});
