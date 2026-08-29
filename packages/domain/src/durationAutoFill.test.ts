import { describe, expect, it } from "vitest";

import {
  computeDurationAutoFillDecision,
  computeExpectedTrackDuration,
  formatDetectedDuration,
  initialDurationAutoFillState,
} from "./durationAutoFill";

describe("music duration auto-fill", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatDetectedDuration(65)).toBe("1:05");
    expect(formatDetectedDuration(0)).toBe("0:00");
  });

  it("fills an empty duration from the first detected track", () => {
    const decision = computeDurationAutoFillDecision(initialDurationAutoFillState, "", "alto", 245);

    expect(decision).toEqual({
      newDuration: "4:05",
      newState: { manuallyEdited: false, runningMax: 245, tuttiLocked: false },
    });
  });

  it("uses Tutti as the authoritative duration after part tracks", () => {
    const first = computeDurationAutoFillDecision(initialDurationAutoFillState, "", "alto", 245);
    const second = computeDurationAutoFillDecision(
      first?.newState ?? initialDurationAutoFillState,
      first?.newDuration ?? "",
      "tutti",
      210,
    );

    expect(second?.newDuration).toBe("3:30");
    expect(second?.newState.tuttiLocked).toBe(true);
  });

  it("does not overwrite a manually entered duration", () => {
    const decision = computeDurationAutoFillDecision(
      { ...initialDurationAutoFillState, manuallyEdited: true },
      "3:00",
      "tutti",
      245,
    );

    expect(decision).toBeNull();
  });

  it("prefers Tutti for mismatch suggestions and otherwise uses the longest track", () => {
    expect(computeExpectedTrackDuration({ alto: 245, soprano: 250 })).toBe(250);
    expect(computeExpectedTrackDuration({ alto: 245, tutti: 210 })).toBe(210);
    expect(computeExpectedTrackDuration({ alto: null })).toBeNull();
  });
});
