import { describe, expect, it } from "vitest";

import {
  safeTicketReminderQualificationSummary,
  ticketReminderBoundaryResponsesSafe,
  ticketReminderQualificationPlan,
  ticketReminderReady,
  ticketReminderSnapshot,
  ticketReminderSnapshotsMatch,
} from "./qualify-staging-ticket-reminder.mjs";

describe("staging ticket-reminder qualification helpers", () => {
  it("describes a non-mutating checkout and cleanup sequence", () => {
    const plan = ticketReminderQualificationPlan().join(" ");
    expect(plan).toContain("zero-dollar");
    expect(plan).toContain("canonical signed receipt");
    expect(plan).toContain("refund the free simulated order");
    expect(plan).toContain("wrong Organization host");
    expect(plan).toContain("archive the qualification Performance");
  });

  it("keeps only the target event's confirmation and reminder rows", () => {
    const snapshot = ticketReminderSnapshot(
      [
        { eventId: "target", id: "b", kind: "ticket_reminder", recipientCount: 1, status: "Sent" },
        {
          eventId: "target",
          id: "a",
          kind: "ticket_confirmation",
          recipientCount: 1,
          status: "Sent",
        },
        { eventId: "other", id: "c", kind: "ticket_reminder", recipientCount: 1, status: "Sent" },
        { eventId: "target", id: "d", kind: "event_reminder", recipientCount: 1, status: "Sent" },
      ],
      "target",
    );
    expect(snapshot.rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(ticketReminderReady(snapshot)).toBe(true);
  });

  it("detects replay changes while allowing stable snapshots", () => {
    const first = ticketReminderSnapshot(
      [
        {
          eventId: "target",
          id: "reminder",
          kind: "ticket_reminder",
          recipientCount: 1,
          status: "Sent",
        },
      ],
      "target",
    );
    expect(ticketReminderSnapshotsMatch(first, { ...first, rows: [...first.rows] })).toBe(true);
    expect(
      ticketReminderSnapshotsMatch(first, {
        rows: [{ ...first.rows[0], status: "Failed" }],
      }),
    ).toBe(false);
  });

  it("rejects target data on the wrong Organization host", () => {
    const safe = ticketReminderBoundaryResponsesSafe(
      [
        { status: 200, body: { messages: [] } },
        { status: 200, body: { orders: [] } },
        { status: 404, body: { code: "not_found" } },
      ],
      "purchase",
      "event",
    );
    const unsafe = ticketReminderBoundaryResponsesSafe(
      [
        { status: 200, body: { messages: [{ eventId: "event" }] } },
        { status: 200, body: { orders: [] } },
        { status: 404, body: { code: "not_found" } },
      ],
      "purchase",
      "event",
    );
    expect(safe).toBe(true);
    expect(unsafe).toBe(false);
  });

  it("returns only safe qualification fields", () => {
    expect(
      safeTicketReminderQualificationSummary({
        cleanupCompleted: true,
        crossOrganizationRejected: true,
        eventId: "event",
        purchaseId: "purchase",
        receiptAccessible: true,
        refundCompleted: true,
        reminder: {
          deliveryState: "Sent",
          jobCount: 1,
          recipientCount: 1,
          replayStable: true,
          status: "Sent",
        },
        successToken: "must-not-be-returned",
      }),
    ).toEqual({
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      eventId: "event",
      purchaseId: "purchase",
      receiptAccessible: true,
      refundCompleted: true,
      reminder: {
        deliveryState: "Sent",
        jobCount: 1,
        recipientCount: 1,
        replayStable: true,
        status: "Sent",
      },
    });
  });
});
