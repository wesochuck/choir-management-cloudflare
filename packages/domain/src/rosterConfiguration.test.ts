import { describe, expect, it } from "vitest";
import { defaultRosterConfiguration, isValidRoster } from "./rosterConfiguration";

describe("roster configuration", () => {
  describe("isValidRoster", () => {
    it("returns true for a valid roster config", () => {
      expect(isValidRoster({ maxMembers: 10, sections: ["Sopranos", "Altos"] })).toBe(true);
    });

    it("returns false when maxMembers is 0", () => {
      expect(isValidRoster({ maxMembers: 0, sections: ["Sopranos", "Altos"] })).toBe(false);
    });

    it("returns false when maxMembers is negative", () => {
      expect(isValidRoster({ maxMembers: -5, sections: ["Sopranos", "Altos"] })).toBe(false);
    });

    it("returns false when sections array is empty", () => {
      expect(isValidRoster({ maxMembers: 10, sections: [] })).toBe(false);
    });

    it("returns false when both conditions fail", () => {
      expect(isValidRoster({ maxMembers: 0, sections: [] })).toBe(false);
    });
  });

  describe("defaultRosterConfiguration", () => {
    it("contains expected sections and voice parts", () => {
      expect(defaultRosterConfiguration.sections.length).toBeGreaterThan(0);
      expect(defaultRosterConfiguration.voiceParts.length).toBeGreaterThan(0);

      const sections = defaultRosterConfiguration.sections.map((s) => s.code);
      expect(sections).toContain("S");
      expect(sections).toContain("A");
      expect(sections).toContain("T");
      expect(sections).toContain("B");
    });
  });
});
