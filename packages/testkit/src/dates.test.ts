import { describe, expect, it } from "vitest";

import {
  futureDate,
  futureDateString,
  futureIsoDate,
  pastDate,
  pastDateString,
  pastIsoDate,
  relativeDate,
  relativeIsoDate,
} from "./dates";

describe("testkit date factories", () => {
  const fixedBase = "2026-06-01T12:00:00.000Z";

  it("computes relativeDate correctly with positive and negative offsets", () => {
    const nextWeek = relativeDate({ base: fixedBase, days: 7 });
    expect(nextWeek.toISOString()).toBe("2026-06-08T12:00:00.000Z");

    const prevDay = relativeDate({ base: fixedBase, days: -1 });
    expect(prevDay.toISOString()).toBe("2026-05-31T12:00:00.000Z");
  });

  it("computes relativeIsoDate", () => {
    expect(relativeIsoDate({ base: fixedBase, hours: 2 })).toBe("2026-06-01T14:00:00.000Z");
  });

  it("computes futureDate and futureIsoDate defaulting to 30 days ahead", () => {
    const future = futureDate({ base: fixedBase });
    expect(future.toISOString()).toBe("2026-07-01T12:00:00.000Z");

    const futureIso = futureIsoDate({ base: fixedBase, days: 10 });
    expect(futureIso).toBe("2026-06-11T12:00:00.000Z");

    const futureStr = futureDateString({ base: fixedBase, days: 5 });
    expect(futureStr).toBe("2026-06-06");
  });

  it("computes pastDate and pastIsoDate defaulting to 30 days ago", () => {
    const past = pastDate({ base: fixedBase });
    expect(past.toISOString()).toBe("2026-05-02T12:00:00.000Z");

    const pastIso = pastIsoDate({ base: fixedBase, days: 10 });
    expect(pastIso).toBe("2026-05-22T12:00:00.000Z");

    const pastStr = pastDateString({ base: fixedBase, days: 5 });
    expect(pastStr).toBe("2026-05-27");
  });
});
