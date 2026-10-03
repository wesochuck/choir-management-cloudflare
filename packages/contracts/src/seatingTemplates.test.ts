import { describe, expect, it } from "vitest";
import { seatingConfigurationRequestSchema, savedSeatingTemplateSchema } from "./seating";

const formation = {
  id: "standard",
  name: "Standard",
  strategy: "vertical_column",
  sectionOrder: ["S"],
  isVoicePartLayout: false,
};
const configuration = { defaultFormationId: "standard", formations: [formation] };
const template = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Reference",
  formation,
  rowCounts: [2],
  assignments: [
    { name: "Singer", seatKey: "0-0", profileId: "22222222-2222-4222-8222-222222222222" },
    { name: "Unresolved", seatKey: "0-1" },
  ],
};

describe("saved seating template contracts", () => {
  it("round-trips local matches and unresolved names, and accepts old configuration payloads", () => {
    expect(
      seatingConfigurationRequestSchema.parse({ ...configuration, templates: [template] })
        .templates,
    ).toEqual([template]);
    expect(seatingConfigurationRequestSchema.parse(configuration)).toEqual(configuration);
    expect(
      seatingConfigurationRequestSchema.parse({ ...configuration, templates: undefined }).templates,
    ).toBeUndefined();
    expect(
      seatingConfigurationRequestSchema.parse({ ...configuration, templates: [] }).templates,
    ).toEqual([]);
    expect(
      seatingConfigurationRequestSchema.safeParse({ ...configuration, templates: null }).success,
    ).toBe(false);
  });
  it("rejects duplicate local assignments, invalid IDs, and out-of-range seats", () => {
    for (const assignments of [
      [template.assignments[0], { ...template.assignments[0], seatKey: "0-1" }],
      [{ name: "Singer", seatKey: "3-0" }],
      [{ name: "Singer", seatKey: "0-0", profileId: null }],
      [{ name: "Singer", seatKey: "0-0", profileId: "legacy-id" }],
    ])
      expect(savedSeatingTemplateSchema.safeParse({ ...template, assignments }).success).toBe(
        false,
      );
    expect(
      seatingConfigurationRequestSchema.safeParse({
        ...configuration,
        templates: [template, template],
      }).success,
    ).toBe(false);
    expect(
      seatingConfigurationRequestSchema.safeParse({
        ...configuration,
        templates: Array.from({ length: 21 }, () => template),
      }).success,
    ).toBe(false);
  });
});
