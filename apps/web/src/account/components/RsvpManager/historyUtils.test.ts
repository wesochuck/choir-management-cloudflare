import { organizationEventSchema, type OrganizationEvent } from "@choir/contracts";
import { describe, expect, it } from "vitest";

import { isHistoryFilter, nearestUpcomingPerformance } from "./historyUtils";

const perfId1 = "11111111-1111-4111-8111-111111111111";
const perfIdPast = "22222222-2222-4222-8222-222222222222";
const otherId1 = "33333333-3333-4333-8333-333333333333";
const otherId2 = "44444444-4444-4444-8444-444444444444";
const otherIdPast = "55555555-5555-4555-8555-555555555555";

function createMockEvent(
  id: string,
  type: "Performance" | "Other",
  startsAt: string,
): OrganizationEvent {
  return organizationEventSchema.parse({
    callTime: "",
    createdAt: "2026-08-01T00:00:00Z",
    details: `${type} event`,
    endsAt: startsAt,
    id,
    location: "Hall",
    ...(type === "Other" ? { otherEventRsvpMode: "optional" as const } : {}),
    parentPerformanceId: null,
    rsvpDeadlineDate: type === "Performance" ? startsAt.slice(0, 10) : null,
    rsvpDeadlinePassed: false,
    startsAt,
    title: `${type} ${id}`,
    type,
    updatedAt: "2026-08-01T00:00:00Z",
  });
}

describe("nearestUpcomingPerformance", () => {
  it("returns the nearest upcoming Performance when both Performance and Other exist in future", () => {
    const futurePerf = createMockEvent(perfId1, "Performance", "2099-06-15T20:00:00Z");
    const futureOther = createMockEvent(otherId1, "Other", "2099-05-10T18:00:00Z");
    const pastPerf = createMockEvent(perfIdPast, "Performance", "2020-01-01T20:00:00Z");

    const result = nearestUpcomingPerformance([pastPerf, futurePerf, futureOther]);
    expect(result).toBe(perfId1);
  });

  it("falls back to nearest upcoming Other event when no upcoming Performance exists", () => {
    const pastPerf = createMockEvent(perfIdPast, "Performance", "2020-01-01T20:00:00Z");
    const futureOther1 = createMockEvent(otherId1, "Other", "2099-06-15T18:00:00Z");
    const futureOther2 = createMockEvent(otherId2, "Other", "2099-05-10T18:00:00Z");

    const result = nearestUpcomingPerformance([pastPerf, futureOther1, futureOther2]);
    expect(result).toBe(otherId2);
  });

  it("returns empty string when no events are in the future", () => {
    const pastPerf = createMockEvent(perfIdPast, "Performance", "2020-01-01T20:00:00Z");
    const pastOther = createMockEvent(otherIdPast, "Other", "2020-02-01T18:00:00Z");

    const result = nearestUpcomingPerformance([pastPerf, pastOther]);
    expect(result).toBe("");
  });

  it("returns empty string when events list is empty", () => {
    expect(nearestUpcomingPerformance([])).toBe("");
  });
});

describe("isHistoryFilter", () => {
  it("identifies valid history filter values", () => {
    expect(isHistoryFilter("All")).toBe(true);
    expect(isHistoryFilter("Yes")).toBe(true);
    expect(isHistoryFilter("No")).toBe(true);
    expect(isHistoryFilter("Pending")).toBe(true);
    expect(isHistoryFilter("Invalid")).toBe(false);
  });
});
