import { describe, expect, it } from "vitest";
import { selectDefaultPerformance } from "./performanceSelection";

interface EventCandidate {
  readonly id: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: string;
}

function event(id: string, startsAt: string, type = "Performance"): EventCandidate {
  return { id, startsAt, title: id, type };
}

describe("selectDefaultPerformance", () => {
  const timezone = "America/New_York";
  const now = new Date("2025-01-15T17:00:00.000Z");

  it("chooses the earliest eligible Performance from unsorted events and includes all of today", () => {
    const todayEarlierThanNow = event("today-early", "2025-01-15T12:00:00.000Z");
    const todayLater = event("today-late", "2025-01-15T22:00:00.000Z");
    const nearFuture = event("tomorrow", "2025-01-16T18:00:00.000Z");
    const farFuture = event("far", "2025-03-01T18:00:00.000Z");
    const events = [
      farFuture,
      event("past", "2025-01-10T18:00:00.000Z"),
      nearFuture,
      todayLater,
      todayEarlierThanNow,
    ];
    const originalOrder = [...events];

    expect(selectDefaultPerformance(events, now, timezone)).toBe(todayEarlierThanNow);
    expect(events).toEqual(originalOrder);
  });

  it("uses the Organization-local day across a UTC date boundary", () => {
    const previousLocalDay = event("yesterday-local", "2025-11-02T03:30:00.000Z");
    const currentLocalDay = event("today-local", "2025-11-02T04:30:00.000Z");
    const nextLocalDay = event("tomorrow-local", "2025-11-03T05:30:00.000Z");
    const afterLocalDay = event("later", "2025-11-04T05:30:00.000Z");

    expect(
      selectDefaultPerformance(
        [afterLocalDay, previousLocalDay, nextLocalDay, currentLocalDay],
        new Date("2025-11-02T04:15:00.000Z"),
        timezone,
      ),
    ).toBe(currentLocalDay);
  });

  it("falls back to the most recent past Performance", () => {
    const latestPast = event("latest-past", "2025-01-14T22:00:00.000Z");
    expect(
      selectDefaultPerformance(
        [
          event("old", "2024-12-01T18:00:00.000Z"),
          latestPast,
          event("earlier", "2025-01-13T18:00:00.000Z"),
        ],
        now,
        timezone,
      ),
    ).toBe(latestPast);
  });

  it("uses the lexically smaller ID for equal timestamps regardless of input order", () => {
    const laterId = event("performance-z", "2025-01-15T20:00:00.000Z");
    const earlierId = event("performance-a", "2025-01-15T20:00:00.000Z");

    expect(selectDefaultPerformance([laterId, earlierId], now, timezone)).toBe(earlierId);
    expect(
      selectDefaultPerformance(
        [event("past-z", "2025-01-14T20:00:00.000Z"), event("past-a", "2025-01-14T20:00:00.000Z")],
        now,
        timezone,
      )?.id,
    ).toBe("past-a");
  });

  it("ignores rehearsals and malformed timestamps", () => {
    const valid = event("valid", "2025-01-16T18:00:00.000Z");
    expect(
      selectDefaultPerformance(
        [
          event("rehearsal", "2025-01-15T18:00:00.000Z", "Rehearsal"),
          event("malformed", "not-a-date"),
          valid,
        ],
        now,
        timezone,
      ),
    ).toBe(valid);
  });

  it("returns null for no eligible event, an empty list, or invalid selector context", () => {
    expect(selectDefaultPerformance([], now, timezone)).toBeNull();
    expect(selectDefaultPerformance([event("bad", "invalid")], now, timezone)).toBeNull();
    expect(
      selectDefaultPerformance([event("future", "2025-01-16T18:00:00.000Z")], now, "bad/tz"),
    ).toBeNull();
    expect(
      selectDefaultPerformance(
        [event("future", "2025-01-16T18:00:00.000Z")],
        new Date(Number.NaN),
        timezone,
      ),
    ).toBeNull();
  });
});
