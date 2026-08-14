import { describe, expect, it } from "vitest";

import {
  rosterAutomationBoundaryResponsesSafe,
  rosterAutomationQualificationPlan,
  reusableStagingSessionCookie,
  safeOnBreakProfileCandidates,
  safeRosterAutomationQualificationSummary,
} from "./qualify-staging-roster-automation.mjs";

describe("staging roster automation qualification helpers", () => {
  it("plans status, RSVP, attendance, boundary, and cleanup evidence", () => {
    const plan = rosterAutomationQualificationPlan().join("\n");
    expect(plan).toContain("configured number of ended Performance fixtures");
    expect(plan).toContain("On Break timeout");
    expect(plan).toContain("future Performance RSVP");
    expect(plan).toContain("Present attendance");
    expect(plan).toContain("without changing existing Organization configuration");
  });

  it("rejects target data on the wrong Organization host", () => {
    expect(
      rosterAutomationBoundaryResponsesSafe(
        [
          { status: 200, body: { profiles: [{ id: "other-profile" }] } },
          { status: 200, body: { events: [{ id: "other-event" }] } },
          { status: 404, body: { code: "profile_not_found" } },
        ],
        "target-profile",
        ["target-event"],
      ),
    ).toBe(true);
    expect(
      rosterAutomationBoundaryResponsesSafe(
        [
          { status: 200, body: { profiles: [{ id: "target-profile" }] } },
          { status: 200, body: { events: [] } },
          { status: 404, body: { code: "profile_not_found" } },
        ],
        "target-profile",
        ["target-event"],
      ),
    ).toBe(false);
  });

  it("returns only bounded qualification fields", () => {
    expect(
      safeRosterAutomationQualificationSummary({
        attendanceReconciled: true,
        cleanupCompleted: true,
        crossOrganizationRejected: true,
        expiredRsvp: true,
        futureRecovery: true,
        inactiveAfterMisses: true,
        onBreakTimeout: true,
        previewMatched: true,
        profileId: "profile-id",
        qualificationEventCount: 7,
        recipientEmail: "secret@example.test",
      }),
    ).toEqual({
      attendanceReconciled: true,
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      expiredRsvp: true,
      futureRecovery: true,
      inactiveAfterMisses: true,
      onBreakTimeout: true,
      previewMatched: true,
      profileId: "profile-id",
      qualificationEventCount: 7,
    });
  });

  it("reuses only a staging session cookie supplied by the parent batch", () => {
    expect(reusableStagingSessionCookie("")).toBeNull();
    expect(
      reusableStagingSessionCookie("choir-management.session_token=qualification-cookie"),
    ).toBe("choir-management.session_token=qualification-cookie");
    expect(() => reusableStagingSessionCookie("session=wrong-scope")).toThrow(
      "STAGING_SESSION_COOKIE is not a staging session cookie.",
    );
  });

  it("lists only safe fields when an On Break Profile must be selected", () => {
    expect(
      safeOnBreakProfileCandidates(
        [
          {
            displayName: "Eligible One",
            email: "hidden@example.test",
            globalStatus: "Idle",
            id: "candidate-1",
            statusIsManual: false,
            voicePart: "S1",
          },
          {
            displayName: "Manual Profile",
            email: "hidden@example.test",
            globalStatus: "Idle",
            id: "candidate-2",
            statusIsManual: true,
            voicePart: "S2",
          },
        ],
        "primary",
      ),
    ).toEqual([{ displayName: "Eligible One", id: "candidate-1", voicePart: "S1" }]);
  });
});
