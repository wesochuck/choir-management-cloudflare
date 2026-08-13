import { describe, expect, it } from "vitest";

import {
  parseSignedUnsubscribeUrl,
  safeUnsubscribeQualificationSummary,
  signedUnsubscribeQualificationPlan,
} from "./qualify-staging-signed-unsubscribe.mjs";

describe("staging signed-unsubscribe qualification helpers", () => {
  it("plans one targeted, bounded flow", () => {
    expect(signedUnsubscribeQualificationPlan("profile-id")).toEqual([
      "send one targeted sandbox email to Profile profile-id through the supported communications API",
      "wait for the bounded delivery state without inspecting provider payloads",
      "accept an unsubscribe URL only in the local process and never print or persist its token",
      "verify idempotent unsubscribe success and wrong-Organization rejection",
      "verify a later reach preview excludes the suppressed Profile",
      "retain only safe message/profile IDs and suppression status evidence",
    ]);
  });

  it("accepts only the expected public host and path", () => {
    expect(
      parseSignedUnsubscribeUrl(
        "https://lcc.staging.example/unsubscribe?token=abc",
        "https://lcc.staging.example",
      ),
    ).toBe("abc");
    expect(() =>
      parseSignedUnsubscribeUrl(
        "https://lmc.staging.example/unsubscribe?token=abc",
        "https://lcc.staging.example",
      ),
    ).toThrow();
    expect(() =>
      parseSignedUnsubscribeUrl(
        "https://lcc.staging.example/profile?token=abc",
        "https://lcc.staging.example",
      ),
    ).toThrow();
  });

  it("returns only safe summary fields", () => {
    const summary = safeUnsubscribeQualificationSummary({
      crossOrganizationRejected: true,
      idempotent: true,
      messageId: "message-id",
      profileId: "profile-id",
      reachExcluded: true,
      token: "signed-token-must-not-escape",
      unsubscribed: true,
    });
    expect(summary).toEqual({
      crossOrganizationRejected: true,
      idempotent: true,
      messageId: "message-id",
      profileId: "profile-id",
      reachExcluded: true,
      unsubscribed: true,
    });
    expect(JSON.stringify(summary)).not.toContain("signed-token");
  });
});
