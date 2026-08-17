import { describe, expect, it } from "vitest";

import { normalizeDurationInput, parseDuration } from "./utils";

describe("music duration input", () => {
  it("repairs minute-only and short seconds values", () => {
    expect(normalizeDurationInput("3")).toBe("3:00");
    expect(normalizeDurationInput("3:")).toBe("3:00");
    expect(normalizeDurationInput("3:5")).toBe("3:05");
  });

  it("parses repaired values as seconds", () => {
    expect(parseDuration("3")).toBe(180);
    expect(parseDuration("3:5")).toBe(185);
    expect(parseDuration("3:60")).toBeUndefined();
  });
});
