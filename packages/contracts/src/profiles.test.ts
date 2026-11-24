import { describe, expect, it } from "vitest";

import {
  memberProfileSchema,
  memberProfileUpdateRequestSchema,
  organizationProfileActivityResponseSchema,
  organizationProfileDeleteResponseSchema,
  organizationProfileRequestSchema,
  organizationProfileSchema,
} from "./profiles";

describe("organizationProfileRequestSchema", () => {
  it("accepts an optional independent contact email, including explicit removal", () => {
    expect(organizationProfileRequestSchema.parse({ displayName: "Person" }).email).toBeUndefined();
    expect(organizationProfileRequestSchema.parse({ displayName: "Person", email: "" }).email).toBe(
      "",
    );
    expect(
      organizationProfileRequestSchema.parse({
        displayName: "Person",
        email: "person@example.test",
      }).email,
    ).toBe("person@example.test");
    expect(
      organizationProfileRequestSchema.safeParse({ displayName: "Person", email: null }).success,
    ).toBe(false);
    expect(
      organizationProfileRequestSchema.safeParse({ displayName: "Person", email: "invalid" })
        .success,
    ).toBe(false);
    expect(
      memberProfileUpdateRequestSchema.parse({
        displayName: "Person",
        email: "ignored@example.test",
      }),
    ).not.toHaveProperty("email");
  });

  it("defaults receiveAdminNotifications to false for member profiles", () => {
    const parsed = organizationProfileRequestSchema.parse({
      displayName: "Jane Doe",
    });
    expect(parsed.receiveAdminNotifications).toBe(false);
    expect(parsed.receiveAuditionNotifications).toBeUndefined();
    expect(parsed.receiveAttendanceReports).toBe(true);
    expect(parsed.showInDirectory).toBe(true);
    expect(parsed.doNotEmail).toBe(false);
    expect(parsed.hidden).toBe(false);
    expect(parsed.isSectionLeader).toBe(false);
  });

  it("accepts receiveAuditionNotifications in profile requests and defaults to false in profile schema", () => {
    const requestWithTrue = organizationProfileRequestSchema.parse({
      displayName: "Jane Doe",
      receiveAuditionNotifications: true,
    });
    expect(requestWithTrue.receiveAuditionNotifications).toBe(true);

    const parsed = organizationProfileSchema.parse({
      createdAt: "2026-01-01T00:00:00.000Z",
      displayName: "Jane Doe",
      id: "11111111-1111-4111-8111-111111111111",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.receiveAuditionNotifications).toBe(false);
  });
});

describe("reminder preferences", () => {
  it("leaves reminder flags undefined when omitted from update payloads", () => {
    const update = memberProfileUpdateRequestSchema.parse({ displayName: "Jane Doe" });
    expect(update.receiveRehearsalReminders).toBeUndefined();
    expect(update.receivePerformanceReminders).toBeUndefined();
    expect(update.receiveOtherEventReminders).toBeUndefined();
    const adminUpdate = organizationProfileRequestSchema.parse({ displayName: "Jane Doe" });
    expect(adminUpdate.receiveRehearsalReminders).toBeUndefined();
    expect(
      memberProfileSchema.parse({
        displayName: "Jane Doe",
        email: "",
        globalStatus: "Active",
        id: "11111111-1111-4111-8111-111111111111",
        voicePart: "S1",
      }),
    ).toMatchObject({
      receiveOtherEventReminders: true,
      receivePerformanceReminders: true,
      receiveRehearsalReminders: true,
    });
  });
});

describe("organizationProfileDeleteResponseSchema", () => {
  it("validates successful profile deletion response", () => {
    const parsed = organizationProfileDeleteResponseSchema.parse({
      deleted: true,
      profileId: "11111111-1111-4111-8111-111111111111",
      requestId: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed.deleted).toBe(true);
    expect(parsed.profileId).toBe("11111111-1111-4111-8111-111111111111");
  });
});

describe("directory contact visibility preferences", () => {
  it("keeps omitted update fields absent for backward-compatible writes", () => {
    const parsed = memberProfileUpdateRequestSchema.parse({ displayName: "Singer" });
    expect(parsed.showEmailInDirectory).toBeUndefined();
    expect(parsed.showPhoneInDirectory).toBeUndefined();
  });
  it.each([true, false, undefined])("accepts boolean or omitted preferences (%s)", (value) => {
    expect(
      memberProfileUpdateRequestSchema.parse({
        displayName: "Singer",
        showEmailInDirectory: value,
        showPhoneInDirectory: value,
      }),
    ).toMatchObject({ displayName: "Singer" });
  });
  it.each([null, "false", 0])("rejects invalid preference values (%s)", (value) => {
    expect(
      memberProfileUpdateRequestSchema.safeParse({
        displayName: "Singer",
        showEmailInDirectory: value,
      }).success,
    ).toBe(false);
    expect(
      memberProfileUpdateRequestSchema.safeParse({
        displayName: "Singer",
        showPhoneInDirectory: value,
      }).success,
    ).toBe(false);
  });
  it("defaults missing read fields to visible for older responses", () => {
    const parsed = memberProfileSchema.parse({
      displayName: "Singer",
      email: "singer@example.test",
      globalStatus: "Active",
      id: "11111111-1111-4111-8111-111111111111",
      voicePart: "",
    });
    expect(parsed).toMatchObject({ showEmailInDirectory: true, showPhoneInDirectory: true });
  });
});

// Older DELETE callers omit the contact policy; retention is the safe default.
it("defaults profile deletion to retaining Contacts and rejects unknown policies", async () => {
  const { organizationProfileDeleteRequestSchema } = await import("./profiles");
  expect(organizationProfileDeleteRequestSchema.parse({})).toEqual({ contacts: "keep" });
  expect(organizationProfileDeleteRequestSchema.parse({ contacts: undefined })).toEqual({
    contacts: "keep",
  });
  expect(organizationProfileDeleteRequestSchema.parse({ contacts: "delete_unused" })).toEqual({
    contacts: "delete_unused",
  });
  expect(organizationProfileDeleteRequestSchema.safeParse({ contacts: null }).success).toBe(false);
  expect(organizationProfileDeleteRequestSchema.safeParse({ contacts: "delete_all" }).success).toBe(
    false,
  );
});

describe("organizationProfileActivityResponseSchema", () => {
  const baseProfileId = "11111111-1111-4111-8111-111111111111";
  const baseEventId = "22222222-2222-4222-8222-222222222222";
  const baseRequestId = "33333333-3333-4333-8333-333333333333";

  it("parses a populated linked profile activity response", () => {
    const parsed = organizationProfileActivityResponseSchema.parse({
      attendance: {
        lastAttendedEvent: {
          eventId: baseEventId,
          eventTitle: "Tuesday Rehearsal",
          eventType: "Rehearsal",
          startsAt: "2026-06-10T23:00:00.000Z",
        },
        recentRehearsals: {
          absentCount: 1,
          pendingCount: 0,
          presentCount: 5,
          totalCount: 6,
        },
      },
      emailHealth: {
        bounceReason: "",
        doNotEmail: false,
        lastBounceAt: null,
        lastDeliveredAt: "2026-06-11T15:00:00.000Z",
        providerEmailSuppressed: false,
      },
      lastPollResponseAt: "2026-06-08T12:00:00.000Z",
      lastRsvpResponseAt: "2026-06-09T14:00:00.000Z",
      portal: {
        emailVerified: true,
        hasGoogleAccount: true,
        hasPassword: true,
        joinedAt: "2026-01-15T12:00:00.000Z",
        joinedViaInviteLink: true,
        lastActiveAt: "2026-06-12T18:30:00.000Z",
        linked: true,
        passkeyCount: 2,
        pendingInvitation: null,
        role: "member",
        twoFactorEnabled: true,
      },
      profileCreatedAt: "2026-01-10T10:00:00.000Z",
      profileId: baseProfileId,
      profileUpdatedAt: "2026-06-10T10:00:00.000Z",
      requestId: baseRequestId,
      timeline: [
        {
          actorType: "member",
          detail: "Pending → Yes",
          id: "rsvp:1",
          kind: "rsvp_change",
          occurredAt: "2026-06-09T14:00:00.000Z",
          title: "RSVP updated for Spring Concert",
        },
      ],
    });
    expect(parsed.portal.lastActiveAt).toBe("2026-06-12T18:30:00.000Z");
    expect(parsed.portal.passkeyCount).toBe(2);
    expect(parsed.attendance.lastAttendedEvent?.eventTitle).toBe("Tuesday Rehearsal");
    expect(parsed.timeline).toHaveLength(1);
  });

  it("defaults optional/nullable activity fields safely for unlinked profiles with pending invite", () => {
    const parsed = organizationProfileActivityResponseSchema.parse({
      attendance: {
        recentRehearsals: { absentCount: 0, pendingCount: 0, presentCount: 0, totalCount: 0 },
      },
      emailHealth: {},
      portal: {
        linked: false,
        pendingInvitation: {
          createdAt: "2026-06-01T12:00:00.000Z",
          expiresAt: "2026-06-09T12:00:00.000Z",
          role: "member",
        },
      },
      profileCreatedAt: "2026-06-01T10:00:00.000Z",
      profileId: baseProfileId,
      profileUpdatedAt: "2026-06-01T10:00:00.000Z",
      requestId: baseRequestId,
      timeline: [
        {
          id: "profile_created",
          kind: "profile_created",
          occurredAt: "2026-06-01T10:00:00.000Z",
          title: "Profile created",
        },
      ],
    });
    expect(parsed.portal.lastActiveAt).toBeNull();
    expect(parsed.portal.passkeyCount).toBeNull();
    expect(parsed.portal.joinedViaInviteLink).toBe(false);
    expect(parsed.portal.pendingInvitation?.role).toBe("member");
    expect(parsed.attendance.lastAttendedEvent).toBeNull();
    expect(parsed.emailHealth.lastDeliveredAt).toBeNull();
    expect(parsed.lastPollResponseAt).toBeNull();
    expect(parsed.lastRsvpResponseAt).toBeNull();
    expect(parsed.timeline[0]?.actorType).toBeNull();
    expect(parsed.timeline[0]?.detail).toBe("");
  });

  it("rejects invalid timeline size, unknown kinds, and negative counts", () => {
    const tooManyEvents = Array.from({ length: 51 }, (_, index) => ({
      id: `event-${String(index)}`,
      kind: "attendance" as const,
      occurredAt: "2026-06-01T10:00:00.000Z",
      title: "Rehearsal",
    }));
    expect(
      organizationProfileActivityResponseSchema.safeParse({
        attendance: {
          recentRehearsals: { absentCount: 0, pendingCount: 0, presentCount: 0, totalCount: 0 },
        },
        emailHealth: {},
        portal: { linked: false },
        profileCreatedAt: "2026-06-01T10:00:00.000Z",
        profileId: baseProfileId,
        profileUpdatedAt: "2026-06-01T10:00:00.000Z",
        requestId: baseRequestId,
        timeline: tooManyEvents,
      }).success,
    ).toBe(false);
    expect(
      organizationProfileActivityResponseSchema.safeParse({
        attendance: {
          recentRehearsals: { absentCount: -1, pendingCount: 0, presentCount: 0, totalCount: 0 },
        },
        emailHealth: {},
        portal: { linked: false },
        profileCreatedAt: "2026-06-01T10:00:00.000Z",
        profileId: baseProfileId,
        profileUpdatedAt: "2026-06-01T10:00:00.000Z",
        requestId: baseRequestId,
        timeline: [],
      }).success,
    ).toBe(false);
  });
});
