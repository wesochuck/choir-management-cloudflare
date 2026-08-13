import { describe, expect, it } from "vitest";

import {
  safeSchedulerQualificationSummary,
  schedulerBoundaryStatusesRejected,
  schedulerProfileReachFailure,
  schedulerQualificationPlan,
  validateAttendanceReportRecipient,
} from "./qualify-staging-scheduler.mjs";

const eventId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";

describe("staging scheduler qualification helpers", () => {
  it("plans bounded reminder and post-event report evidence", () => {
    const plan = schedulerQualificationPlan("profile-id").join("\n");
    expect(plan).toContain("48-hour event-reminder horizon");
    expect(plan).toContain("parent Performance RSVP roster");
    expect(plan).toContain("attendance_report");
    expect(plan).toContain("archive all qualification-owned Performance/Rehearsal fixtures");
  });

  it("accepts only rejected cross-Organization statuses", () => {
    expect(schedulerBoundaryStatusesRejected([401, 403, 404])).toBe(true);
    expect(schedulerBoundaryStatusesRejected([404, 200])).toBe(false);
  });

  it("explains an unreachable Profile without exposing membership email data", () => {
    const failure = schedulerProfileReachFailure(
      {
        doNotEmail: false,
        id: "33333333-3333-4333-8333-333333333333",
        providerEmailSuppressed: false,
      },
      [],
      { email: 0, total: 0 },
    );
    expect(failure).toContain("no Organization Membership is currently linked");
    expect(failure).not.toContain("@");
  });

  it("explains other member-audience exclusions without exposing membership email data", () => {
    const failure = schedulerProfileReachFailure(
      {
        doNotEmail: false,
        id: "33333333-3333-4333-8333-333333333333",
        providerEmailSuppressed: false,
        voicePart: "S1",
      },
      [{ email: "secret@example.test", profileId: "33333333-3333-4333-8333-333333333333" }],
      { email: 0, total: 0 },
    );
    expect(failure).toContain("active communication suppression or a configured track-only");
    expect(failure).not.toContain("secret@example.test");
  });

  it("accepts an attendance-report recipient without requiring a voice part", () => {
    const profile = validateAttendanceReportRecipient(
      {
        email: "secret@example.test",
        profileId: "33333333-3333-4333-8333-333333333333",
        role: "owner",
      },
      [
        {
          doNotEmail: false,
          globalStatus: "Active",
          id: "33333333-3333-4333-8333-333333333333",
          providerEmailSuppressed: false,
          receiveAttendanceReports: true,
          voicePart: "",
        },
      ],
    );
    expect(profile.voicePart).toBe("");
  });

  it("rejects an attendance-report recipient without an email", () => {
    expect(() =>
      validateAttendanceReportRecipient(
        {
          email: "",
          profileId: "33333333-3333-4333-8333-333333333333",
          role: "owner",
        },
        [
          {
            doNotEmail: false,
            globalStatus: "Active",
            id: "33333333-3333-4333-8333-333333333333",
            providerEmailSuppressed: false,
            receiveAttendanceReports: true,
          },
        ],
      ),
    ).toThrow("the linked Organization Membership has no email address");
  });

  it("keeps the summary bounded and excludes message content or recipient data", () => {
    const summary = safeSchedulerQualificationSummary({
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      eventReminder: {
        communicationCount: 1,
        deliveryState: "sent",
        eventId,
        jobCount: 1,
        messageId,
        reach: 1,
        replayStable: true,
      },
      rehearsalParent: {
        communicationCount: 1,
        deliveryState: "sent",
        eventId,
        jobCount: 1,
        messageId,
        parentRosterApplied: true,
        reach: 1,
        replayStable: true,
      },
      postEventReport: {
        aggregateMatched: true,
        communicationCount: 1,
        deliveryState: "sent",
        eventId,
        jobCount: 1,
        messageId,
        reach: 1,
        replayStable: true,
      },
      profileId: "33333333-3333-4333-8333-333333333333",
      secretBody: "signed-token-content",
      recipientEmail: "secret@example.test",
    });
    expect(JSON.stringify(summary)).not.toContain("signed-token-content");
    expect(JSON.stringify(summary)).not.toContain("secret@example.test");
    expect(summary).toMatchObject({
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      eventReminder: { deliveryState: "sent", jobCount: 1, reach: 1 },
      rehearsalParent: { parentRosterApplied: true, replayStable: true },
      postEventReport: { aggregateMatched: true, replayStable: true },
    });
  });
});
