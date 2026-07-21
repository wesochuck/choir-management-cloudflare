import { describe, expect, it } from "vitest";

import {
  failure,
  isPerformer,
  isValidTimeZone,
  success,
  utcToZonedLocalDateTime,
  zonedLocalDateTimeToUtc,
} from "./index";

describe("domain results", () => {
  it("represents success without throwing", () => {
    expect(success("ready")).toEqual({ ok: true, value: "ready" });
  });

  it("represents typed failures without provider details", () => {
    expect(failure("forbidden", "Organization access is required")).toEqual({
      error: { code: "forbidden", message: "Organization access is required" },
      ok: false,
    });
  });
});

describe("performer eligibility", () => {
  it("requires a non-empty voice part", () => {
    expect(isPerformer({ voicePart: "S1" })).toBe(true);
    expect(isPerformer({ voicePart: "  " })).toBe(false);
    expect(isPerformer({ voicePart: null })).toBe(false);
  });
});

describe("calendar timezone conversion", () => {
  it("uses the IANA offset in effect on the event date", () => {
    expect(zonedLocalDateTimeToUtc("2026-07-20T18:00", "America/New_York")).toBe(
      "2026-07-20T22:00:00.000Z",
    );
    expect(zonedLocalDateTimeToUtc("2026-12-20T18:00", "America/New_York")).toBe(
      "2026-12-20T23:00:00.000Z",
    );
    expect(utcToZonedLocalDateTime("2026-07-20T22:00:00.000Z", "America/New_York")).toBe(
      "2026-07-20T18:00",
    );
  });

  it("rejects invalid zones and nonexistent spring-forward times", () => {
    expect(isValidTimeZone("Not/A_Zone")).toBe(false);
    expect(zonedLocalDateTimeToUtc("2026-03-08T02:30", "America/New_York")).toBeNull();
  });
});
