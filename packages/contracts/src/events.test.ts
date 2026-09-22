import { describe, expect, it } from "vitest";

import {
  organizationEventFieldsSchema,
  organizationEventRequestSchema,
  organizationEventSchema,
} from "./index";

describe("organization event contracts", () => {
  const baseValidEvent = {
    rsvpDeadlineDate: "2026-10-10",
    startsAt: "2026-10-15T19:30:00Z",
    title: "Fall Concert",
    type: "Performance" as const,
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
});
