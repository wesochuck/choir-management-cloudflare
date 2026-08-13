import { describe, expect, it } from "vitest";

import {
  ownedFailureRows,
  queueDeadLetterQualificationPlan,
  safeQueueDeadLetterSummary,
} from "./qualify-staging-queue-dead-letter.mjs";

describe("staging queue dead-letter qualification helpers", () => {
  it("plans a bounded, provider-independent failure fixture", () => {
    expect(queueDeadLetterQualificationPlan()).toEqual([
      "sign in and verify the fresh Platform Administrator factor in memory",
      "run canonical-LCC maintenance before taking the dead-letter baseline",
      "snapshot open queue dead letters without printing operational payloads",
      "create one temporary audition addressed only to an RFC-reserved example.test fixture",
      "delete the audition through the supported Organization API before notification resolution",
      "run canonical-LCC maintenance to flush the qualification-owned notification outbox",
      "poll for a new Organization-owned audition_notification dead letter with bounded waits (up to five minutes)",
      "dismiss each newly owned dead letter once and prove a repeated dismissal is rejected",
      "leave no audition or provider-recipient state behind and never invoke queue retry",
    ]);
  });

  it("returns redacted failure evidence", () => {
    const summary = safeQueueDeadLetterSummary({
      cleanupCompleted: true,
      deadLetterCount: 2,
      dismissalCount: 2,
      duplicateDismissalRejected: true,
      qualificationOwned: true,
      idempotencyKey: "contains operational detail",
    });
    expect(summary).toEqual({
      cleanupCompleted: true,
      deadLetterCount: 2,
      dismissalCount: 2,
      duplicateDismissalRejected: true,
      qualificationOwned: true,
    });
    expect(JSON.stringify(summary)).not.toContain("operational detail");
  });

  it("uses the baseline snapshot instead of comparing clocks from separate Workers", () => {
    const rows = [
      {
        firstSeenAt: "2026-08-13T12:30:39.672Z",
        id: "new-dead-letter",
        idempotencyKey: "audition-notification:notification-id",
        jobKind: "audition_notification",
        organizationId: "organization-id",
      },
    ];

    expect(ownedFailureRows(rows, new Set(), "organization-id")).toEqual(rows);
    expect(ownedFailureRows(rows, new Set(["new-dead-letter"]), "organization-id")).toEqual([]);
  });
});
