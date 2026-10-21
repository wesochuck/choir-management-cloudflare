import { describe, expect, it } from "vitest";
import { practiceLoudnessGain } from "./loudness";
const measurement = (integratedLufs: number, truePeakDbtp: number) => ({
  analysisVersion: 1,
  contentVersion: "upload-version",
  integratedLufs,
  truePeakDbtp,
});
describe("constant peak-safe practice gain", () => {
  it("boosts only with headroom and attenuates loud recordings", () => {
    expect(practiceLoudnessGain(measurement(-26, -12)).appliedGainDb).toBe(8);
    expect(practiceLoudnessGain(measurement(-26, -3))).toMatchObject({
      appliedGainDb: 2,
      peakCapped: true,
    });
    expect(practiceLoudnessGain(measurement(-12, -2)).appliedGainDb).toBe(-6);
    expect(practiceLoudnessGain(measurement(-26, 3)).appliedGainDb).toBe(-4);
    expect(practiceLoudnessGain(measurement(-70, -100)).appliedGainDb).toBe(18);
  });
  it("uses unity for absent, nonfinite, out-of-range and outdated results", () => {
    for (const value of [
      undefined,
      null,
      measurement(NaN, -3),
      measurement(-26, Infinity),
      measurement(-71, -3),
      measurement(-26, 13),
      { ...measurement(-26, -3), analysisVersion: 2 },
      { ...measurement(-26, -3), contentVersion: "" },
    ])
      expect(practiceLoudnessGain(value).linearGain).toBe(1);
  });
});
