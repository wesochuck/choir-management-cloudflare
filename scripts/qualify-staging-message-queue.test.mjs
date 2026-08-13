import { describe, expect, it } from "vitest";

import {
  messageQueueCrossOrganizationRejected,
  messageQueueFailure,
  messageQueueReachFailure,
  messageQueueQualificationPlan,
  safeMessageQueueQualificationSummary,
} from "./qualify-staging-message-queue.mjs";

describe("staging message-queue qualification helpers", () => {
  it("plans one bounded, one-recipient queue flow", () => {
    expect(messageQueueQualificationPlan("profile-id")).toEqual([
      "send one targeted sandbox email to Profile profile-id through the supported communications API",
      "wait for one sent delivery with one queue attempt and one provider-accepted result",
      "repeat read-only history and delivery inspection without creating a second delivery",
      "prove the message and its delivery summary are rejected on the wrong Organization host",
      "retain only safe message/profile IDs and bounded delivery counts; do not retry a queue job",
    ]);
  });

  it("returns only safe delivery evidence", () => {
    const summary = safeMessageQueueQualificationSummary({
      attempts: 1,
      crossOrganizationRejected: true,
      deliveryState: "sent",
      messageId: "message-id",
      profileId: "profile-id",
      providerStatus: "accepted",
      replayStable: true,
      sentDeliveries: 1,
      destination: "recipient@example.test",
      subject: "contains no output",
    });
    expect(summary).toEqual({
      attempts: true,
      crossOrganizationRejected: true,
      deliveryState: true,
      messageId: "message-id",
      profileId: "profile-id",
      providerAccepted: true,
      replayStable: true,
      sentDeliveries: true,
    });
    expect(JSON.stringify(summary)).not.toContain("recipient@example.test");
  });

  it("surfaces only the safe application error code for a rejected send", () => {
    expect(
      messageQueueFailure(409, {
        code: "communication_has_no_recipients",
        requestId: "request-id-not-output",
      }),
    ).toBe("HTTP 409 (communication_has_no_recipients)");
    expect(messageQueueFailure(503, { message: "provider payload" })).toBe("HTTP 503");
  });

  it("explains an unreachable controlled Profile without exposing recipient data", () => {
    const failure = messageQueueReachFailure(
      {
        doNotEmail: false,
        globalStatus: "Active",
        providerEmailSuppressed: false,
        voicePart: "S1",
      },
      { email: 0, total: 0 },
    );
    expect(failure).toContain("active unsubscribe suppression");
    expect(failure).toContain("Use a dedicated, unsuppressed qualification Profile.");
    expect(failure).not.toContain("@");
  });

  it("accepts each expected tenant-isolation rejection status", () => {
    expect(messageQueueCrossOrganizationRejected(401)).toBe(true);
    expect(messageQueueCrossOrganizationRejected(403)).toBe(true);
    expect(messageQueueCrossOrganizationRejected(404)).toBe(true);
    expect(messageQueueCrossOrganizationRejected(200)).toBe(false);
    expect(messageQueueCrossOrganizationRejected(500)).toBe(false);
  });
});
