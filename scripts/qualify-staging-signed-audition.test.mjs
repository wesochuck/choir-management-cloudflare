import { describe, expect, it } from "vitest";

import {
  parseSignedAuditionUrl,
  safeAuditionQualificationSummary,
  signedAuditionQualificationPlan,
} from "./qualify-staging-signed-audition.mjs";

describe("staging signed-audition qualification helpers", () => {
  it("plans the supported notification and revocation flow", () => {
    expect(signedAuditionQualificationPlan()).toEqual([
      "create and schedule one disposable audition through the supported Organization APIs",
      "wait for its normal audition notification without inspecting provider payloads",
      "accept the audition URL only in the local process and never print or persist its token",
      "verify LCC details and an allowed public update",
      "verify the same signed value is rejected on the LMC Organization host",
      "delete the temporary inquiry and verify the old link is revoked",
    ]);
  });

  it("accepts only the expected audition host and path", () => {
    expect(
      parseSignedAuditionUrl(
        "https://lcc.staging.example/auditions?token=abc",
        "https://lcc.staging.example",
      ),
    ).toBe("abc");
    expect(() =>
      parseSignedAuditionUrl(
        "https://lmc.staging.example/auditions?token=abc",
        "https://lcc.staging.example",
      ),
    ).toThrow();
    expect(() =>
      parseSignedAuditionUrl(
        "https://lcc.staging.example/unsubscribe?token=abc",
        "https://lcc.staging.example",
      ),
    ).toThrow();
  });

  it("returns safe evidence fields without token material", () => {
    const summary = safeAuditionQualificationSummary({
      auditionId: "audition-id",
      crossOrganizationRejected: true,
      deleted: true,
      detailsValid: true,
      revoked: true,
      token: "signed-token-must-not-escape",
      updateAllowed: true,
    });
    expect(summary).toEqual({
      auditionId: "audition-id",
      crossOrganizationRejected: true,
      deleted: true,
      detailsValid: true,
      revoked: true,
      updateAllowed: true,
    });
    expect(JSON.stringify(summary)).not.toContain("signed-token");
  });
});
