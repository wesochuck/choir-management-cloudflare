import { describe, expect, it } from "vitest";
import { seatingTemplateSchema } from "@choir/contracts";
import {
  equivalentSeatingFormation,
  importedSeatingFormation,
  matchSeatingTemplate,
} from "./seatingImport";

const formation = {
  id: "columns-standard",
  name: "S–B–T–A",
  isVoicePartLayout: false,
  sectionOrder: ["S", "B", "T", "A"],
  strategy: "vertical_column" as const,
};
const chart = {
  name: "Main",
  formation,
  rowCounts: [3],
  assignments: [{ seatKey: "0-0", name: "  Álex   Singer " }],
};

describe("seating template name matching", () => {
  it("normalizes Unicode, whitespace, and case while using destination IDs", () => {
    const result = matchSeatingTemplate(
      chart,
      [{ id: "new-id", displayName: "ÁLEX SINGER" }],
      new Set(["new-id"]),
    );
    expect(result).toEqual({ assignments: { "0-0": "new-id" }, unresolved: [] });
  });
  it("reports missing and ineligible Profiles without guessing or changing attendance", () => {
    const result = matchSeatingTemplate(
      {
        ...chart,
        assignments: [
          { seatKey: "0-0", name: "Missing" },
          { seatKey: "0-1", name: "Pending" },
        ],
      },
      [{ id: "p", displayName: "Pending" }],
      new Set(),
    );
    expect(result.assignments).toEqual({});
    expect(result.unresolved.map(({ reason }) => reason)).toEqual([
      "No matching Profile",
      "Must be Active, have a voice part, and RSVP Yes",
    ]);
  });
  it("blocks ambiguous destination names even if only one candidate is eligible", () => {
    const result = matchSeatingTemplate(
      chart,
      [
        { id: "1", displayName: "Álex Singer" },
        { id: "2", displayName: "álex singer" },
      ],
      new Set(["1"]),
    );
    expect(result.assignments).toEqual({});
    expect(result.unresolved[0]?.reason).toBe("Name is ambiguous");
  });
  it("blocks repeated source names rather than assigning one Profile to two seats", () => {
    const result = matchSeatingTemplate(
      {
        ...chart,
        assignments: [
          { seatKey: "0-0", name: "Alex" },
          { seatKey: "0-1", name: "Alex" },
        ],
      },
      [{ id: "1", displayName: "Alex" }],
      new Set(["1"]),
    );
    expect(result.assignments).toEqual({});
    expect(result.unresolved).toHaveLength(2);
  });
});

describe("imported formation preservation", () => {
  it("reuses equivalent definitions, not just IDs", () => {
    const destination = { ...formation, id: "destination", name: "Existing preset" };
    expect(equivalentSeatingFormation(formation, [destination])).toBe(destination);
    const conflicting = { ...formation, sectionOrder: ["S", "A", "T", "B"] };
    expect(equivalentSeatingFormation(formation, [conflicting])).toBeUndefined();
    expect(importedSeatingFormation(formation, [conflicting])).toEqual({
      ...formation,
      id: "import-columns-standard",
    });
    expect(conflicting.sectionOrder).toEqual(["S", "A", "T", "B"]);
  });
  it("keeps generated IDs unique on repeated imports with conflicting definitions", () => {
    const conflicting = {
      ...formation,
      id: "import-columns-standard",
      sectionOrder: ["S", "A", "T", "B"],
    };
    expect(importedSeatingFormation(formation, [conflicting]).id).toBe("import-columns-standard-2");
  });
});

describe("portable seating template validation", () => {
  const template = { format: "choir-seating-template", version: 1, charts: [chart] };
  it("accepts portable names and rejects unsupported versions and missing properties", () => {
    expect(seatingTemplateSchema.safeParse(template).success).toBe(true);
    expect(seatingTemplateSchema.safeParse({ ...template, version: 2 }).success).toBe(false);
    for (const assignments of [null, undefined]) {
      expect(
        seatingTemplateSchema.safeParse({ ...template, charts: [{ ...chart, assignments }] })
          .success,
      ).toBe(false);
    }
    expect(
      seatingTemplateSchema.safeParse({
        ...template,
        charts: [{ name: chart.name, rowCounts: chart.rowCounts, formation }],
      }).success,
    ).toBe(false);
  });
  it("rejects out-of-range seats, duplicate seats, and excessive capacity", () => {
    for (const assignments of [
      [{ seatKey: "0-3", name: "Alex" }],
      [{ seatKey: "1-0", name: "Alex" }],
      [
        { seatKey: "0-0", name: "Alex" },
        { seatKey: "0-0", name: "Other" },
      ],
    ]) {
      expect(
        seatingTemplateSchema.safeParse({ ...template, charts: [{ ...chart, assignments }] })
          .success,
      ).toBe(false);
    }
    expect(
      seatingTemplateSchema.safeParse({
        ...template,
        charts: [{ ...chart, rowCounts: Array.from({ length: 21 }, () => 200) }],
      }).success,
    ).toBe(false);
  });
  it("does not carry source tenant IDs into import data", () => {
    const parsed = seatingTemplateSchema.parse({
      ...template,
      organizationId: "source",
      charts: [{ ...chart, assignments: [{ seatKey: "0-0", name: "Alex", profileId: "legacy" }] }],
    });
    expect(parsed.charts[0]?.assignments[0]).toEqual({ seatKey: "0-0", name: "Alex" });
    expect(parsed).not.toHaveProperty("organizationId");
  });
});

describe("reusable template matching", () => {
  it("matches names without attendance when saving and applies eligibility only when used", () => {
    const profiles = [{ id: "p", displayName: "Álex Singer" }];
    expect(matchSeatingTemplate(chart, profiles).assignments).toEqual({ "0-0": "p" });
    expect(matchSeatingTemplate(chart, profiles, new Set()).assignments).toEqual({});
    expect(matchSeatingTemplate(chart, profiles, new Set(["p"])).assignments).toEqual({
      "0-0": "p",
    });
  });
  it("honors an explicit local match for duplicate or renamed Profiles", () => {
    const profiles = [
      { id: "1", displayName: "Álex Singer" },
      { id: "2", displayName: "Álex Singer" },
    ];
    expect(matchSeatingTemplate(chart, profiles, undefined, { "0-0": "2" }).assignments).toEqual({
      "0-0": "2",
    });
    expect(
      matchSeatingTemplate(chart, [{ id: "2", displayName: "Renamed" }], new Set(["2"]), {
        "0-0": "2",
      }).assignments,
    ).toEqual({ "0-0": "2" });
    expect(
      matchSeatingTemplate(chart, profiles, new Set(["1"]), { "0-0": "2" }).assignments,
    ).toEqual({});
  });
  it("rejects explicit matches that would seat a Profile twice or refer outside the roster", () => {
    const twoSeats = {
      ...chart,
      assignments: [
        { seatKey: "0-0", name: "Alex" },
        { seatKey: "0-1", name: "Other" },
      ],
    };
    const profiles = [{ id: "1", displayName: "Alex" }];
    const result = matchSeatingTemplate(twoSeats, profiles, undefined, { "0-1": "1" });
    expect(result.assignments).toEqual({});
    expect(result.unresolved).toHaveLength(2);
    expect(
      matchSeatingTemplate(chart, profiles, undefined, { "0-0": "foreign" }).assignments,
    ).toEqual({});
  });
});
