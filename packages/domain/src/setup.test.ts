import { describe, expect, it } from "vitest";

import { MODULE_DEFINITIONS, isSetupComplete, nextSetupStep, resolveModuleEnabled } from "./setup";

describe("setup domain model", () => {
  it("resolves explicitly configured granular modules", () => {
    const config = {
      music_library: true,
      setlists: false,
    };
    expect(resolveModuleEnabled("music_library", config)).toBe(true);
    expect(resolveModuleEnabled("setlists", config)).toBe(false);
  });

  it("falls back to legacy parent bucket configuration when granular key is missing", () => {
    const config = {
      programs: false,
      people: true,
    };
    // setlists has legacyParent "programs" -> should be false
    expect(resolveModuleEnabled("setlists", config)).toBe(false);
    // music_library has legacyParent "programs" -> should be false
    expect(resolveModuleEnabled("music_library", config)).toBe(false);
    // roster has legacyParent "people" -> should be true
    expect(resolveModuleEnabled("roster", config)).toBe(true);
  });

  it("defaults unconfigured modules to true", () => {
    expect(resolveModuleEnabled("music_library", {})).toBe(true);
    expect(resolveModuleEnabled("events", {})).toBe(true);
  });

  it("determines setup steps and completion correctly", () => {
    expect(nextSetupStep([])).toBe("organization_info");
    expect(nextSetupStep(["organization_info"])).toBe("modules");
    expect(nextSetupStep(["organization_info", "modules", "theme", "launch"])).toBeNull();

    expect(
      isSetupComplete({
        allModulesConfigured: true,
        completedSteps: ["organization_info", "modules", "theme", "launch"],
        currentStep: null,
        launched: true,
      }),
    ).toBe(true);

    expect(
      isSetupComplete({
        allModulesConfigured: true,
        completedSteps: ["organization_info", "modules"],
        currentStep: "theme",
        launched: false,
      }),
    ).toBe(false);
  });

  it("contains complete metadata for all standard modules", () => {
    expect(MODULE_DEFINITIONS.length).toBeGreaterThanOrEqual(19);
    for (const def of MODULE_DEFINITIONS) {
      expect(def.id).toBeTruthy();
      expect(def.label).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.category).toBeTruthy();
    }
  });
});
