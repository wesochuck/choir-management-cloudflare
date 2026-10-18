import { describe, expect, it } from "vitest";

import {
  organizationEventFieldsSchema,
  organizationEventRequestSchema,
  organizationEventSchema,
  singerEventSchema,
} from "./index";

describe("organization event contracts", () => {
  const venueId = "22222222-2222-4222-8222-222222222222";
  const baseValidEvent = {
    rsvpDeadlineDate: "2026-10-10",
    startsAt: "2026-10-15T19:30:00Z",
    title: "Fall Concert",
    type: "Performance" as const,
    venueId,
  };

  it("defaults setListDefaultTransitionSeconds to 0 when omitted", () => {
    const parsedFields = organizationEventFieldsSchema.parse(baseValidEvent);
    expect(parsedFields.setListDefaultTransitionSeconds).toBe(0);

    const parsedRequest = organizationEventRequestSchema.parse(baseValidEvent);
    expect(parsedRequest.setListDefaultTransitionSeconds).toBe(0);

    const parsedEvent = organizationEventSchema.parse({
      ...baseValidEvent,
      createdAt: "2026-10-01T00:00:00Z",
      id: "11111111-1111-4111-8111-111111111111",
      updatedAt: "2026-10-01T00:00:00Z",
    });
    expect(parsedEvent.setListDefaultTransitionSeconds).toBe(0);
  });

  it("persists valid integer seconds", () => {
    const parsed = organizationEventRequestSchema.parse({
      ...baseValidEvent,
      setListDefaultTransitionSeconds: 45,
    });
    expect(parsed.setListDefaultTransitionSeconds).toBe(45);

    const upper = organizationEventRequestSchema.parse({
      ...baseValidEvent,
      setListDefaultTransitionSeconds: 3_600,
    });
    expect(upper.setListDefaultTransitionSeconds).toBe(3_600);
  });

  it("rejects negative values", () => {
    expect(() =>
      organizationEventRequestSchema.parse({
        ...baseValidEvent,
        setListDefaultTransitionSeconds: -1,
      }),
    ).toThrow();
  });

  it("rejects out-of-range values", () => {
    expect(() =>
      organizationEventRequestSchema.parse({
        ...baseValidEvent,
        setListDefaultTransitionSeconds: 3_601,
      }),
    ).toThrow();
  });

  it("rejects non-integer values", () => {
    expect(() =>
      organizationEventRequestSchema.parse({
        ...baseValidEvent,
        setListDefaultTransitionSeconds: 15.5,
      }),
    ).toThrow();
  });

  it("requires a saved venue on new Performance saves", () => {
    const missing = organizationEventRequestSchema.safeParse({
      ...baseValidEvent,
      venueId: null,
    });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues.some((issue) => issue.path.join(".") === "venueId")).toBe(true);
    }
    const omitted = organizationEventRequestSchema.safeParse({
      advancePriceCents: 0,
      callTime: "",
      dayOfPriceCents: 0,
      details: "",
      doorsOpenTime: "",
      durationMinutes: null,
      isTicketingEnabled: false,
      location: "",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: false,
      rsvpDeadlineDate: "2026-10-10",
      rsvpFollowUpLeadHours: null,
      rsvpFollowUpMode: "inherit",
      setList: [],
      setListApproved: false,
      setListDefaultTransitionSeconds: 0,
      startsAt: "2026-10-15T19:30:00Z",
      ticketCapacity: null,
      title: "No Venue",
      type: "Performance",
    });
    // venueId defaults to null, which must be rejected with a venueId path.
    expect(omitted.success).toBe(false);
    if (!omitted.success) {
      expect(omitted.error.issues.some((issue) => issue.path.join(".") === "venueId")).toBe(true);
    }
  });

  it("requires a saved venue on new Rehearsal saves", () => {
    const result = organizationEventRequestSchema.safeParse({
      startsAt: "2026-10-16T19:00:00Z",
      title: "Sectional",
      type: "Rehearsal",
      venueId: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "venueId")).toBe(true);
    }
  });

  it("keeps ancillary ticket fields optional when ticketing is enabled", () => {
    const parsed = organizationEventRequestSchema.parse({
      ...baseValidEvent,
      isTicketingEnabled: true,
      ticketCapacity: null,
    });
    expect(parsed.ticketCapacity).toBeNull();
    expect(parsed.advancePriceCents).toBe(0);
  });

  it("enforces conditional RSVP logic for Performances", () => {
    const missingDeadline = organizationEventRequestSchema.safeParse({
      ...baseValidEvent,
      rsvpDeadlineDate: null,
    });
    expect(missingDeadline.success).toBe(false);

    const rehearsalWithDeadline = organizationEventRequestSchema.safeParse({
      startsAt: "2026-10-16T19:00:00Z",
      title: "Rehearsal",
      type: "Rehearsal",
      venueId,
      rsvpDeadlineDate: "2026-10-10",
    });
    expect(rehearsalWithDeadline.success).toBe(false);
  });

  it("accepts historical null venues on the read schema", () => {
    const parsedFields = organizationEventFieldsSchema.parse({
      ...baseValidEvent,
      venueId: null,
    });
    expect(parsedFields.venueId).toBeNull();

    const parsedEvent = organizationEventSchema.parse({
      ...baseValidEvent,
      createdAt: "2026-10-01T00:00:00Z",
      id: "11111111-1111-4111-8111-111111111111",
      updatedAt: "2026-10-01T00:00:00Z",
      venueId: null,
    });
    expect(parsedEvent.venueId).toBeNull();
  });
});

describe("member event score availability", () => {
  it.each([undefined, false, true])("preserves optional availability %s", (scoreAvailable) => {
    const item = singerEventSchema.shape.setList.parse([
      { title: "Opening Song", scoreAvailable },
    ])[0];
    expect(item?.scoreAvailable).toBe(scoreAvailable);
  });

  it("rejects non-boolean availability", () => {
    expect(
      singerEventSchema.shape.setList.safeParse([{ title: "Opening Song", scoreAvailable: "yes" }])
        .success,
    ).toBe(false);
  });
});
