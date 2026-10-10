import { describe, expect, it } from "vitest";

import {
  profileReconciliationExecuteRequestSchema,
  profileReconciliationPreviewRequestSchema,
  profileReconciliationPreviewResponseSchema,
  profileReconciliationResponseSchema,
} from "./profileReconciliation";

describe("profileReconciliation contracts", () => {
  it("validates preview request schema", () => {
    const valid = profileReconciliationPreviewRequestSchema.safeParse({
      membershipId: "mem-123",
      targetProfileId: "12345678-1234-4234-8234-123456789abc",
    });
    expect(valid.success).toBe(true);

    const invalid = profileReconciliationPreviewRequestSchema.safeParse({
      membershipId: "",
      targetProfileId: "not-a-uuid",
    });
    expect(invalid.success).toBe(false);
  });

  it("validates preview response schema", () => {
    const valid = profileReconciliationPreviewResponseSchema.safeParse({
      canReconcile: true,
      conflictInventory: {
        blockers: [],
        contactConflicts: [],
        deliveryConflicts: [],
        duesConflicts: [],
        eventRosterConflicts: [],
        pollConflicts: [],
        warnings: [],
      },
      memberEmail: "jane@example.test",
      membershipId: "mem-123",
      memberName: "Jane Smith",
      memberRole: "member",
      previewRevision: "rev-abc-123",
      requestId: "12345678-1234-4234-8234-123456789def",
      sourceProfile: {
        createdAt: "2026-01-01T00:00:00.000Z",
        displayName: "Jane Smith",
        doNotEmail: false,
        globalStatus: "Active",
        hidden: false,
        id: "12345678-1234-4234-8234-123456789111",
        isSectionLeader: false,
        membershipEmail: "jane@example.test",
        notes: "",
        phone: "555-1234",
        showInDirectory: true,
        voicePart: "Alto",
      },
      status: "ready",
      targetProfile: {
        createdAt: "2025-01-01T00:00:00.000Z",
        displayName: "Jane Smith",
        doNotEmail: false,
        globalStatus: "Active",
        hidden: false,
        id: "12345678-1234-4234-8234-123456789222",
        isSectionLeader: false,
        membershipEmail: null,
        notes: "Historical notes",
        phone: "",
        showInDirectory: true,
        voicePart: "Alto",
      },
    });
    expect(valid.success).toBe(true);
  });

  it("validates execute request schema requiring confirmedSamePerson to be true", () => {
    const valid = profileReconciliationExecuteRequestSchema.safeParse({
      confirmedSamePerson: true,
      expectedSourceProfileId: "12345678-1234-4234-8234-123456789111",
      fieldChoices: {
        notes: "keep_target",
        phone: "overwrite_with_source",
      },
      idempotencyKey: "idem-key-1",
      membershipId: "mem-123",
      previewRevision: "rev-abc-123",
      targetProfileId: "12345678-1234-4234-8234-123456789222",
    });
    expect(valid.success).toBe(true);

    const invalid = profileReconciliationExecuteRequestSchema.safeParse({
      confirmedSamePerson: false,
      expectedSourceProfileId: "12345678-1234-4234-8234-123456789111",
      idempotencyKey: "idem-key-1",
      membershipId: "mem-123",
      previewRevision: "rev-abc-123",
      targetProfileId: "12345678-1234-4234-8234-123456789222",
    });
    expect(invalid.success).toBe(false);
  });

  it("validates reconciliation response schema", () => {
    const valid = profileReconciliationResponseSchema.safeParse({
      canonicalProfileId: "12345678-1234-4234-8234-123456789222",
      id: "rec-1",
      membershipId: "mem-123",
      message: "Profiles successfully consolidated.",
      occurredAt: "2026-10-09T22:00:00.000Z",
      requestId: "12345678-1234-4234-8234-123456789def",
      sourceProfileId: "12345678-1234-4234-8234-123456789111",
      status: "completed",
      targetProfileId: "12345678-1234-4234-8234-123456789222",
    });
    expect(valid.success).toBe(true);
  });
});
