import { describe, expect, it } from "vitest";

import {
  formatQualificationSummary,
  qualificationSnapshot,
  qualificationSnapshotsMatch,
  selectQualificationEvents,
  summarizeCommunicationMessages,
  summarizeDeliverySummary,
  summarizeScheduledMessages,
} from "./staging-qualification-inspection.mjs";

const eventId = "11111111-1111-4111-8111-111111111111";
const secondEventId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";

describe("staging qualification inspection", () => {
  it("selects only events owned by the qualification prefix", () => {
    expect(
      selectQualificationEvents(
        [
          { id: eventId, startsAt: "2026-08-12T12:00:00.000Z", title: "QUAL-2026-08-12-a event" },
          { id: secondEventId, startsAt: "2026-08-12T13:00:00.000Z", title: "Existing event" },
        ],
        "QUAL-2026-08-12-a",
      ),
    ).toEqual([
      {
        id: eventId,
        isCanceled: false,
        startsAt: "2026-08-12T12:00:00.000Z",
        title: "QUAL-2026-08-12-a event",
        type: null,
      },
    ]);
  });

  it("summarizes only safe scheduler fields and excludes message content", () => {
    const summary = summarizeScheduledMessages(
      [
        {
          eventId,
          id: messageId,
          kind: "event_reminder",
          recipientCount: 1,
          status: "Sent",
          subject: "secret fixture subject",
        },
        {
          eventId: secondEventId,
          id: "44444444-4444-4444-8444-444444444444",
          kind: "attendance_report",
          recipientCount: 2,
          status: "Failed",
          subject: "unrelated",
        },
      ],
      [eventId],
    );
    expect(summary).toMatchObject({
      byKind: { event_reminder: 1 },
      byStatus: { Sent: 1 },
      recipientCount: 1,
      total: 1,
    });
    expect(JSON.stringify(summary)).not.toContain("secret fixture subject");
  });

  it("keeps communication history and delivery summaries redacted", () => {
    const communication = summarizeCommunicationMessages(
      [
        {
          audience: { eventId },
          channel: "Email",
          contentMarkdown: "signed-token-content",
          id: messageId,
          reach: { total: 1 },
          status: "Sent",
          subject: "private subject",
        },
      ],
      [eventId],
    );
    const delivery = summarizeDeliverySummary({
      email: { sent: 1, total: 1 },
      failures: [{ maskedDestination: "secret@example.test" }],
      state: "sent",
      total: { sent: 1, total: 1 },
    });
    expect(JSON.stringify(communication)).not.toContain("signed-token-content");
    expect(JSON.stringify(communication)).not.toContain("private subject");
    expect(JSON.stringify(delivery)).not.toContain("secret@example.test");
    expect(delivery).toMatchObject({ emailSent: 1, state: "sent", totalSent: 1 });
  });

  it("compares stable qualification snapshots for idempotency", () => {
    const scheduled = summarizeScheduledMessages(
      [{ eventId, id: messageId, kind: "event_reminder", recipientCount: 1, status: "Sent" }],
      [eventId],
    );
    const communications = summarizeCommunicationMessages(
      [
        {
          audience: { eventId },
          channel: "Email",
          id: messageId,
          reach: { total: 1 },
          status: "Sent",
        },
      ],
      [eventId],
    );
    const first = qualificationSnapshot(scheduled, communications, [
      { messageId, status: "Sent", summary: { state: "sent" } },
    ]);
    const second = qualificationSnapshot(scheduled, communications, [
      { messageId, status: "Sent", summary: { state: "sent" } },
    ]);
    expect(qualificationSnapshotsMatch(first, second)).toBe(true);
    expect(formatQualificationSummary({ ...first, scheduled, communications })).toContain(
      "scheduled=1",
    );
  });
});
