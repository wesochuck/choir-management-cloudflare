import { describe, expect, it } from "vitest";

import {
  failure,
  formatTimezoneName,
  formatTimezoneOption,
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

  it("formats common timezone indicators for standard and daylight saving dates", () => {
    expect(formatTimezoneName("America/New_York", "2026-11-17")).toBe("Eastern Standard Time");
    expect(formatTimezoneName("America/New_York", "2026-07-15")).toBe("Eastern Daylight Time");
    expect(formatTimezoneName("America/Chicago", "2026-11-17")).toBe("Central Standard Time");
    expect(formatTimezoneName("America/Chicago", "2026-07-15")).toBe("Central Daylight Time");
    expect(formatTimezoneName("America/Los_Angeles", "2026-11-17")).toBe("Pacific Standard Time");
    expect(formatTimezoneName("America/Los_Angeles", "2026-07-15")).toBe("Pacific Daylight Time");
    expect(formatTimezoneName("America/Denver", "2026-11-17")).toBe("Mountain Standard Time");
    expect(formatTimezoneName("America/Denver", "2026-07-15")).toBe("Mountain Daylight Time");
    expect(formatTimezoneName("America/Phoenix", "2026-07-15")).toBe("Mountain Standard Time");
    expect(formatTimezoneName("UTC", "2026-07-15")).toBe("UTC");
    expect(formatTimezoneName("Not_A_Timezone", "2026-07-15")).toBe("Not_A_Timezone");
  });

  it("formats generic timezone indicators when date is omitted", () => {
    expect(formatTimezoneName("America/New_York")).toBe("Eastern Time");
    expect(formatTimezoneName("America/Chicago")).toBe("Central Time");
    expect(formatTimezoneName("America/Denver")).toBe("Mountain Time");
    expect(formatTimezoneName("America/Los_Angeles")).toBe("Pacific Time");
    expect(formatTimezoneName("UTC")).toBe("UTC");
  });

  it("formats timezone options for dropdown selects", () => {
    expect(formatTimezoneOption("America/New_York")).toBe("America/New_York (Eastern Time)");
    expect(formatTimezoneOption("America/Chicago")).toBe("America/Chicago (Central Time)");
    expect(formatTimezoneOption("UTC")).toBe("UTC");
  });
});
