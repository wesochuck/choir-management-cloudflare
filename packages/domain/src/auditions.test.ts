import { describe, expect, it } from "vitest";

import { areAuditionDatesPassed } from "./auditions";

describe("areAuditionDatesPassed", () => {
  const referenceTime = new Date("2026-08-24T12:00:00.000Z");

  it("returns false if mode is open_inquiry even if slots exist in the past", () => {
    const settings = {
      enabled: true,
      mode: "open_inquiry" as const,
      slots: [
        {
          endsAt: "2026-08-20T14:00:00.000Z",
          startsAt: "2026-08-20T13:00:00.000Z",
        },
      ],
    };
    expect(areAuditionDatesPassed(settings, referenceTime)).toBe(false);
  });

  it("returns false if there are no slots configured", () => {
    const settings = {
      enabled: true,
      mode: "audition" as const,
      slots: [],
    };
    expect(areAuditionDatesPassed(settings, referenceTime)).toBe(false);
  });

  it("returns false if all slots are in the future", () => {
    const settings = {
      enabled: true,
      mode: "audition" as const,
      slots: [
        {
          endsAt: "2026-08-25T14:00:00.000Z",
          startsAt: "2026-08-25T13:00:00.000Z",
        },
        {
          endsAt: "2026-08-26T14:00:00.000Z",
          startsAt: "2026-08-26T13:00:00.000Z",
        },
      ],
    };
    expect(areAuditionDatesPassed(settings, referenceTime)).toBe(false);
  });

  it("returns false if some slots are in the past but at least one slot is in the future", () => {
    const settings = {
      enabled: true,
      mode: "audition" as const,
      slots: [
        {
          endsAt: "2026-08-20T14:00:00.000Z",
          startsAt: "2026-08-20T13:00:00.000Z",
        },
        {
          endsAt: "2026-08-25T14:00:00.000Z",
          startsAt: "2026-08-25T13:00:00.000Z",
        },
      ],
    };
    expect(areAuditionDatesPassed(settings, referenceTime)).toBe(false);
  });

  it("returns true if all slots are in the past", () => {
    const settings = {
      enabled: true,
      mode: "audition" as const,
      slots: [
        {
          endsAt: "2026-08-20T14:00:00.000Z",
          startsAt: "2026-08-20T13:00:00.000Z",
        },
        {
          endsAt: "2026-08-24T11:59:00.000Z",
          startsAt: "2026-08-24T11:00:00.000Z",
        },
      ],
    };
    expect(areAuditionDatesPassed(settings, referenceTime)).toBe(true);
  });

  it("falls back to startsAt if endsAt is missing or invalid", () => {
    const settings = {
      enabled: true,
      mode: "audition" as const,
      slots: [
        {
          endsAt: "invalid",
          startsAt: "2026-08-20T13:00:00.000Z",
        },
      ],
    };
    expect(areAuditionDatesPassed(settings, referenceTime)).toBe(true);
  });
});
