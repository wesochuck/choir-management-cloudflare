import { describe, expect, it, vi } from "vitest";
import type { OrganizationVenue } from "@choir/contracts";
import {
  clearTbdInFlightForTest,
  ensureTbdVenue,
  findTbdVenue,
  isTbdVenueName,
  normalizeVenueName,
} from "./tbdVenue";

function venue(name: string, id = `venue-${name}`): OrganizationVenue {
  return {
    address: "",
    createdAt: "2026-01-01T00:00:00Z",
    id,
    name,
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("tbdVenue helpers", () => {
  it("normalizes names case-insensitively with whitespace trimmed", () => {
    expect(normalizeVenueName("  TBD ")).toBe("tbd");
    expect(isTbdVenueName("tBd")).toBe(true);
    expect(isTbdVenueName("TBD - Mainstage")).toBe(false);
    expect(isTbdVenueName("TBD West")).toBe(false);
    expect(isTbdVenueName("")).toBe(false);
  });

  it("finds canonical TBD regardless of casing but not suffixed variants", () => {
    const venues = [
      venue("City Hall", "city"),
      venue("  tBd ", "tbd-1"),
      venue("TBD West", "west"),
    ];
    expect(findTbdVenue(venues)?.id).toBe("tbd-1");
    expect(findTbdVenue([venue("TBD West", "west")])).toBeUndefined();
    expect(findTbdVenue([venue("TBD - Mainstage", "main")])).toBeUndefined();
  });

  it("reuses existing TBD without calling create", async () => {
    clearTbdInFlightForTest();
    const existing = venue("TBD", "existing-tbd");
    const createVenue = vi.fn();
    const result = await ensureTbdVenue({
      createVenue,
      listVenues: () => Promise.resolve([]),
      venues: [venue("Hall", "hall"), existing],
    });
    expect(result.id).toBe("existing-tbd");
    expect(createVenue).not.toHaveBeenCalled();
  });

  it("creates shared TBD once for two concurrent callers", async () => {
    clearTbdInFlightForTest();
    const created = venue("TBD", "created-tbd");
    let calls = 0;
    const createVenue = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return created;
    });
    const options = {
      createVenue,
      venues: [venue("Hall", "hall")],
    };
    const [first, second] = await Promise.all([ensureTbdVenue(options), ensureTbdVenue(options)]);
    expect(first.id).toBe("created-tbd");
    expect(second.id).toBe("created-tbd");
    expect(calls).toBe(1);
    expect(createVenue).toHaveBeenCalledTimes(1);
    clearTbdInFlightForTest();
  });

  it("prefers fresh list result over duplicate creation", async () => {
    clearTbdInFlightForTest();
    const fresh = venue("tbd", "fresh-tbd");
    const createVenue = vi.fn();
    const result = await ensureTbdVenue({
      createVenue,
      listVenues: () => Promise.resolve([fresh]),
      venues: [],
    });
    expect(result.id).toBe("fresh-tbd");
    expect(createVenue).not.toHaveBeenCalled();
    clearTbdInFlightForTest();
  });
});
