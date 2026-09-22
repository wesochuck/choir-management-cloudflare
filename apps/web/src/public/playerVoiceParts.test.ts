import { describe, expect, it } from "vitest";

import { displayTrackName, formatVoicePartName, sortVoiceParts } from "./playerVoiceParts";

describe("playerVoiceParts", () => {
  describe("displayTrackName", () => {
    it("maps short codes B1, T1, S1, A1 to full names", () => {
      expect(displayTrackName("B1")).toBe("Bass 1");
      expect(displayTrackName("b1")).toBe("Bass 1");
      expect(displayTrackName("B2")).toBe("Bass 2");
      expect(displayTrackName("T1")).toBe("Tenor 1");
      expect(displayTrackName("t1")).toBe("Tenor 1");
      expect(displayTrackName("T2")).toBe("Tenor 2");
      expect(displayTrackName("S1")).toBe("Soprano 1");
      expect(displayTrackName("s1")).toBe("Soprano 1");
      expect(displayTrackName("S2")).toBe("Soprano 2");
      expect(displayTrackName("A1")).toBe("Alto 1");
      expect(displayTrackName("a1")).toBe("Alto 1");
      expect(displayTrackName("A2")).toBe("Alto 2");
    });

    it("maps tutti and choir mix aliases to Choir Mix", () => {
      expect(displayTrackName("tutti")).toBe("Choir Mix");
      expect(displayTrackName("TUTTI")).toBe("Choir Mix");
      expect(displayTrackName("choirmix")).toBe("Choir Mix");
      expect(displayTrackName("choir mix")).toBe("Choir Mix");
    });

    it("maps standard section codes", () => {
      expect(displayTrackName("s")).toBe("Soprano");
      expect(displayTrackName("a")).toBe("Alto");
      expect(displayTrackName("t")).toBe("Tenor");
      expect(displayTrackName("b")).toBe("Bass");
    });

    it("respects configured trackLabels with highest priority", () => {
      const trackLabels = {
        B1: "Baritone / Bass 1",
        SATB: "Full Chorus",
        O: "Orchestra",
        tutti: "All Voices",
      };

      expect(displayTrackName("B1", trackLabels)).toBe("Baritone / Bass 1");
      expect(displayTrackName("SATB", trackLabels)).toBe("Full Chorus");
      expect(displayTrackName("O", trackLabels)).toBe("Orchestra");
      expect(displayTrackName("tutti", trackLabels)).toBe("All Voices");
    });

    it("matches trackLabels case-insensitively if exact key not present", () => {
      const trackLabels = {
        b1: "Custom Bass 1",
        satb: "Choir Full",
      };

      expect(displayTrackName("B1", trackLabels)).toBe("Custom Bass 1");
      expect(displayTrackName("SATB", trackLabels)).toBe("Choir Full");
    });

    it("falls back gracefully for unknown keys", () => {
      expect(displayTrackName("custom_track")).toBe("Custom_track");
      expect(displayTrackName("")).toBe("");
    });
  });

  describe("formatVoicePartName backward-compatibility", () => {
    it("delegates to displayTrackName", () => {
      expect(formatVoicePartName("tutti")).toBe("Choir Mix");
      expect(formatVoicePartName("tenor1")).toBe("Tenor 1");
      expect(formatVoicePartName("B1")).toBe("Bass 1");
      expect(formatVoicePartName("B1", { B1: "Custom Bass" })).toBe("Custom Bass");
    });
  });

  describe("sortVoiceParts", () => {
    it("sorts voice parts in choral order", () => {
      const keys = ["tutti", "B2", "B1", "T1", "A2", "S1", "A1", "T2", "S2"];
      const sorted = sortVoiceParts(keys);
      expect(sorted).toEqual(["S1", "S2", "A1", "A2", "T1", "T2", "B1", "B2", "tutti"]);
    });

    it("handles mixed case and legacy names", () => {
      const keys = ["tutti", "bass", "soprano", "tenor", "alto"];
      const sorted = sortVoiceParts(keys);
      expect(sorted).toEqual(["soprano", "alto", "tenor", "bass", "tutti"]);
    });
  });
});
