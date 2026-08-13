import { describe, expect, it } from "vitest";

import {
  safeSchedulerQualificationSummary,
  schedulerBoundaryStatusesRejected,
  schedulerQualificationPlan,
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
