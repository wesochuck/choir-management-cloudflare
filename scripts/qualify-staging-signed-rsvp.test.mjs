import { describe, expect, it } from "vitest";

import {
  safeRsvpQualificationSummary,
  signedRsvpQualificationPlan,
} from "./qualify-staging-signed-rsvp.mjs";

describe("staging signed RSVP qualification helpers", () => {
  it("plans only supported, bounded operations", () => {
    expect(signedRsvpQualificationPlan("profile-id")).toEqual([
      "create one temporary Performance and link Profile profile-id through supported APIs",
      "issue an RSVP link without printing or persisting the signed value",
      "verify LCC details, Yes/No updates with replay, and required response fields",
      "verify the same signed value is rejected on the LMC Organization host",
      "archive the temporary Performance and verify the previously valid link is revoked",
      "retain only safe fixture IDs and status evidence; never retain the signed value",
    ]);
  });

  it("summarizes only safe status and fixture identifiers", () => {
    const summary = safeRsvpQualificationSummary({
      archived: true,
      crossOrganizationRejected: true,
      eventId: "event-id",
      replayAllowed: true,
      restored: true,
      validDetails: true,
      token: "signed-token-must-not-escape",
    });
    expect(summary).toEqual({
      archived: true,
      crossOrganizationRejected: true,
      eventId: "event-id",
      replayAllowed: true,
      restored: true,
      validDetails: true,
    });
    expect(JSON.stringify(summary)).not.toContain("signed-token");
  });
});
