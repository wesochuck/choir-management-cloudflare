import { describe, expect, it } from "vitest";

import {
  parseSignedEmailChangeUrl,
  safeEmailChangeQualificationSummary,
  signedEmailChangeQualificationPlan,
} from "./qualify-staging-signed-email-change.mjs";

describe("staging signed-email-change qualification helpers", () => {
  it("plans two disposable-identity cycles", () => {
    expect(signedEmailChangeQualificationPlan()).toEqual([
      "request a disposable-account email change from alias A to alias B",
      "confirm the B-address link through the supported browser API route",
      "verify replay and wrong-Organization rejection without printing the token",
      "sign in as B and perform a second controlled cycle back to A",
      "verify both cycles return the confirmed identity and leave no token in output",
    ]);
  });

  it("accepts only the expected confirmation host and path", () => {
    expect(
      parseSignedEmailChangeUrl(
        "https://lcc.staging.example/confirm-email-change?token=Abc_123456789012345",
        "https://lcc.staging.example",
      ),
    ).toBe("Abc_123456789012345");
    expect(() =>
      parseSignedEmailChangeUrl(
        "https://lmc.staging.example/confirm-email-change?token=Abc_123456789012345",
        "https://lcc.staging.example",
      ),
    ).toThrow();
    expect(() =>
      parseSignedEmailChangeUrl(
        "https://lcc.staging.example/unsubscribe?token=Abc_123456789012345",
        "https://lcc.staging.example",
      ),
    ).toThrow();
  });

  it("returns only boolean evidence fields", () => {
    const summary = safeEmailChangeQualificationSummary({
      crossOrganizationRejected: true,
      firstConfirmed: true,
      firstReplayRejected: true,
      secondConfirmed: true,
      secondReplayRejected: true,
      token: "signed-token-must-not-escape",
    });
    expect(summary).toEqual({
      crossOrganizationRejected: true,
      firstConfirmed: true,
      firstReplayRejected: true,
      secondConfirmed: true,
      secondReplayRejected: true,
    });
    expect(JSON.stringify(summary)).not.toContain("signed-token");
  });
});
