import { describe, expect, it } from "vitest";

import {
  rsvpAttendanceBoundaryEvidence,
  isRsvpAttendanceUuid,
  rsvpAttendanceBoundarySafe,
  rsvpAttendanceQualificationPlan,
  rsvpAttendanceRequestHeaders,
  safeRsvpAttendanceQualificationSummary,
} from "./qualify-staging-rsvp-attendance.mjs";

describe("staging RSVP and attendance qualification helpers", () => {
  it("accepts the UUID shape returned by the roster qualification", () => {
    expect(isRsvpAttendanceUuid("ae39ebb6-5060-4551-a452-e6759f271ce6")).toBe(true);
    expect(isRsvpAttendanceUuid("ae39ebb6-5060-4551-a452-e6759f271ce6-extra")).toBe(false);
  });

  it("plans notes, balances, check-in, finalization, isolation, and cleanup", () => {
    const plan = rsvpAttendanceQualificationPlan().join("\n");
    expect(plan).toContain("declined RSVP with a note");
    expect(plan).toContain("event balance row");
    expect(plan).toContain("Absent without changing Yes");
    expect(plan).toContain("finalize");
    expect(plan).toContain("wrong Organization host");
    expect(plan).toContain("archive");
  });

  it("accepts authorization failures or target absence on the wrong Organization", () => {
    expect(
      rsvpAttendanceBoundarySafe(
        [
          { status: 200, body: { rows: [{ profileId: "other-profile" }] } },
          { status: 404, body: { code: "event_not_found" } },
          { status: 200, text: "Other Event" },
        ],
        "target-profile",
        "Target Event",
      ),
    ).toBe(true);
    expect(
      rsvpAttendanceBoundarySafe(
        [
          { status: 200, body: { rows: [{ profileId: "target-profile" }] } },
          { status: 403, body: { code: "forbidden" } },
          { status: 404, text: "" },
        ],
        "target-profile",
        "Target Event",
      ),
    ).toBe(false);
  });

  it("reports bounded boundary statuses and target flags", () => {
    expect(
      rsvpAttendanceBoundaryEvidence(
        [
          { status: 404, body: { code: "not_found" } },
          { status: 403, body: { code: "forbidden" } },
          { status: 404, text: "" },
        ],
        "target-profile",
        "Target Event",
      ),
    ).toEqual({
      safe: true,
      statuses: [404, 403, 404],
      targetFlags: [false, false, false],
    });
  });

  it("returns only bounded qualification evidence", () => {
    const summary = safeRsvpAttendanceQualificationSummary({
      attendanceFinalized: true,
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      eventId: "event-id",
      exportChecksum: "b".repeat(64),
      noteTransitionsVerified: true,
      profileId: "profile-id",
      rsvpHistoryVerified: true,
      rsvpNote: "must-not-appear",
      sessionCookie: "must-not-appear",
    });
    expect(summary).toEqual({
      attendanceFinalized: true,
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      eventId: "event-id",
      exportChecksum: "b".repeat(64),
      noteTransitionsVerified: true,
      profileId: "profile-id",
      rsvpHistoryVerified: true,
    });
    expect(JSON.stringify(summary)).not.toContain("must-not-appear");
  });

  it("sets the canonical origin on mutating requests", () => {
    expect(
      rsvpAttendanceRequestHeaders(
        "https://lcc.staging.musicsite.org/api/organization/events/event-id/rsvp",
        "choir-management.session_token=redacted",
        true,
      ),
    ).toMatchObject({
      origin: "https://lcc.staging.musicsite.org",
      "content-type": "application/json",
      cookie: "choir-management.session_token=redacted",
    });
  });
});
