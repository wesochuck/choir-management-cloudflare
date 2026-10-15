import { describe, expect, it } from "vitest";
import type { OrganizationEvent, SingerEvent } from "@choir/contracts";
import {
  getApprovedPerformanceSetLists,
  isApprovedSetListEvent,
  resolveEventCanonicalId,
} from "./memberPracticeLibrary";

describe("memberPracticeLibrary", () => {
  const baseSingerEvent: SingerEvent = {
    attendanceWarning: null,
    callTime: "18:30",
    details: "",
    directRsvp: "Pending",
    durationMinutes: 120,
    featuredAssignments: [],
    id: "11111111-1111-4111-8111-111111111111",
    inheritedFromParent: false,
    location: "Hall",
    practice: {
      sourceEventId: "11111111-1111-4111-8111-111111111111",
      status: "available",
      trackCount: 3,
    },
    resolvedRsvp: "Pending",
    rsvpDeadlineAt: null,
    rsvpDeadlineDate: null,
    rsvpDeadlinePassed: false,
    rsvpNote: "",
    rsvpSelfServiceOpen: true,
    seating: { status: "not_published" },
    setList: [
      {
        pieceId: "22222222-2222-4222-8222-222222222222",
        title: "Song 1",
      },
    ],
    startsAt: "2026-11-01T19:00:00Z",
    title: "Fall Concert",
    type: "Performance",
    venueAddress: "123 Main St",
    venueName: "Concert Hall",
  };

  const baseOrgEvent: OrganizationEvent = {
    advancePriceCents: 0,
    callTime: "18:30",
    createdAt: "2026-10-01T00:00:00Z",
    dayOfPriceCents: 0,
    details: "",
    doorsOpenTime: "",
    durationMinutes: 120,
    id: "33333333-3333-4333-8333-333333333333",
    isCanceled: false,
    isTicketingEnabled: false,
    location: "Auditorium",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpDeadlineAt: null,
    rsvpDeadlineDate: null,
    rsvpDeadlinePassed: false,
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    rsvpSelfServiceOpen: true,
    setList: [
      {
        pieceId: "44444444-4444-4444-8444-444444444444",
        title: "Winter Song",
      },
    ],
    setListApproved: true,
    setListDefaultTransitionSeconds: 0,
    startsAt: "2026-12-15T19:00:00Z",
    ticketCapacity: null,
    title: "Holiday Gala",
    type: "Performance",
    updatedAt: "2026-10-01T00:00:00Z",
    venueId: null,
  };

  describe("isApprovedSetListEvent", () => {
    it("recognizes approved SingerEvent", () => {
      expect(isApprovedSetListEvent(baseSingerEvent)).toBe(true);
    });

    it("rejects SingerEvent with no setList items", () => {
      expect(isApprovedSetListEvent({ ...baseSingerEvent, setList: [] })).toBe(false);
    });

    it("rejects SingerEvent without approved practice source", () => {
      expect(
        isApprovedSetListEvent({
          ...baseSingerEvent,
          practice: { sourceEventId: null, status: "not_published", trackCount: 0 },
        }),
      ).toBe(false);
    });

    it("recognizes approved OrganizationEvent", () => {
      expect(isApprovedSetListEvent(baseOrgEvent)).toBe(true);
    });

    it("rejects unapproved OrganizationEvent", () => {
      expect(isApprovedSetListEvent({ ...baseOrgEvent, setListApproved: false })).toBe(false);
    });

    it("rejects OrganizationEvent with empty set list even if marked approved", () => {
      expect(isApprovedSetListEvent({ ...baseOrgEvent, setList: [] })).toBe(false);
    });
  });

  describe("resolveEventCanonicalId", () => {
    it("resolves SingerEvent canonical ID from practice sourceEventId", () => {
      expect(resolveEventCanonicalId(baseSingerEvent)).toBe("11111111-1111-4111-8111-111111111111");
    });

    it("resolves OrganizationEvent parentPerformanceId when present", () => {
      const rehearsalWithParent: OrganizationEvent = {
        ...baseOrgEvent,
        id: "55555555-5555-4555-8555-555555555555",
        parentPerformanceId: "33333333-3333-4333-8333-333333333333",
        type: "Rehearsal",
      };
      expect(resolveEventCanonicalId(rehearsalWithParent)).toBe(
        "33333333-3333-4333-8333-333333333333",
      );
    });

    it("resolves OrganizationEvent own ID when parentPerformanceId is null", () => {
      expect(resolveEventCanonicalId(baseOrgEvent)).toBe("33333333-3333-4333-8333-333333333333");
    });
  });

  describe("getApprovedPerformanceSetLists", () => {
    it("deduplicates rehearsal inheriting from parent performance", () => {
      const rehearsal: OrganizationEvent = {
        ...baseOrgEvent,
        id: "55555555-5555-4555-8555-555555555555",
        parentPerformanceId: "33333333-3333-4333-8333-333333333333",
        startsAt: "2026-12-10T19:00:00Z",
        title: "Holiday Gala Rehearsal",
        type: "Rehearsal",
      };

      const options = getApprovedPerformanceSetLists([rehearsal, baseOrgEvent]);
      expect(options).toHaveLength(1);
      expect(options[0]?.eventId).toBe("33333333-3333-4333-8333-333333333333");
      expect(options[0]?.title).toBe("Holiday Gala");
    });

    it("sorts upcoming events chronologically ascending", () => {
      const pastEvent: OrganizationEvent = {
        ...baseOrgEvent,
        id: "66666666-6666-4666-8666-666666666666",
        startsAt: "2026-09-01T19:00:00Z",
        title: "Past Summer Gala",
      };
      const laterUpcoming: OrganizationEvent = {
        ...baseOrgEvent,
        id: "77777777-7777-4777-8777-777777777777",
        startsAt: "2026-12-25T19:00:00Z",
        title: "Christmas Show",
      };

      const options = getApprovedPerformanceSetLists(
        [pastEvent, laterUpcoming, baseOrgEvent],
        new Date("2026-10-15T00:00:00Z"),
      );

      expect(options.map((o) => o.title)).toEqual([
        "Holiday Gala", // 2026-12-15
        "Christmas Show", // 2026-12-25
        "Past Summer Gala", // 2026-09-01 (past event at end)
      ]);
    });
  });
});
