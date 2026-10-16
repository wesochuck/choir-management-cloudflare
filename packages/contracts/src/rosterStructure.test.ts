import { describe, expect, it } from "vitest";
import {
  organizationRosterConfigurationRequestSchema,
  organizationRosterConfigurationResponseSchema,
} from "./events";

const sections = [
  { code: "F", name: "Flute", color: "#123456", trackOnly: false },
  { code: "MIX", name: "Full ensemble", color: "#654321", trackOnly: true },
];

describe("roster structure contracts", () => {
  it("accepts section-only input without parts and round-trips its compatible assignment projection", () => {
    const configuration = organizationRosterConfigurationRequestSchema.parse({
      rosterStructure: "sections_only",
      sections,
    });
    expect(configuration.voiceParts).toEqual([{ label: "F", fullName: "Flute", sectionCode: "F" }]);
    expect(
      organizationRosterConfigurationResponseSchema.parse({
        ...configuration,
        requestId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toMatchObject(configuration);
  });

  it("derives assignments from sections rather than accepting stale or forged parts", () => {
    const parsed = organizationRosterConfigurationRequestSchema.parse({
      rosterStructure: "sections_only",
      sections,
      voiceParts: [{ label: "FAKE", fullName: "Fake", sectionCode: "NO" }],
    });
    expect(parsed.voiceParts.map(({ label }) => label)).toEqual(["F"]);
  });

  it("preserves existing configurations with an omitted or undefined mode", () => {
    const legacy = {
      sections,
      voiceParts: [{ label: "F1", fullName: "Flute 1", sectionCode: "F" }],
    };
    expect(organizationRosterConfigurationRequestSchema.parse(legacy).voiceParts).toEqual(
      legacy.voiceParts,
    );
    expect(
      organizationRosterConfigurationRequestSchema.parse({ ...legacy, rosterStructure: undefined })
        .voiceParts,
    ).toEqual(legacy.voiceParts);
  });

  it("rejects invalid, null, empty, duplicate, and unassignable configurations", () => {
    for (const input of [
      { rosterStructure: null, sections },
      { rosterStructure: "invalid", sections },
      { rosterStructure: "sections_with_parts", sections, voiceParts: [] },
      { sections, voiceParts: [] },
      { rosterStructure: "sections_only", sections: [] },
      { rosterStructure: "sections_only", sections: [sections[0], sections[0]] },
      { rosterStructure: "sections_only", sections: [sections[1]] },
    ]) {
      expect(organizationRosterConfigurationRequestSchema.safeParse(input).success).toBe(false);
    }
  });
});
