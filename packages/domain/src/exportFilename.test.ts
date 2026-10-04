import { describe, expect, it } from "vitest";
import { timestampedExportFilename } from "./exportFilename";

describe("timestampedExportFilename", () => {
  it.each([
    ["2026-10-03T20:43:07Z", "2026-Oct-03_08-43-07-PM-UTC"],
    ["2026-01-01T00:00:00Z", "2026-Jan-01_12-00-00-AM-UTC"],
    ["2026-12-31T12:05:09Z", "2026-Dec-31_12-05-09-PM-UTC"],
    ["2026-10-03T23:43:07-04:00", "2026-Oct-04_03-43-07-AM-UTC"],
  ])("uses a readable UTC stamp for %s", (date, stamp) => {
    expect(timestampedExportFilename("contacts.csv", new Date(date))).toBe(`contacts_${stamp}.csv`);
  });
  it("preserves the stem and final extension for different export formats", () => {
    const date = new Date("2026-10-03T20:43:07Z");
    for (const extension of ["csv", "json", "png"]) {
      expect(timestampedExportFilename(`choir.roster.${extension}`, date)).toBe(
        `choir.roster_2026-Oct-03_08-43-07-PM-UTC.${extension}`,
      );
    }
    expect(timestampedExportFilename("export", date)).toBe("export_2026-Oct-03_08-43-07-PM-UTC");
  });
  it("bounds long filenames while preserving the timestamp and extension", () => {
    const filename = timestampedExportFilename(
      `${"x".repeat(255)}.csv`,
      new Date("2026-10-03T20:43:07Z"),
    );
    expect(filename).toHaveLength(255);
    expect(filename).toMatch(/_2026-Oct-03_08-43-07-PM-UTC\.csv$/);
    expect(filename).not.toMatch(/[<>:"/\\|?*]/);
  });
  it("rejects invalid dates", () => {
    expect(() => timestampedExportFilename("contacts.csv", new Date("invalid"))).toThrow(
      RangeError,
    );
  });
});
