import { describe, expect, it } from "vitest";

import {
  failure,
  isPerformer,
  success,
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

