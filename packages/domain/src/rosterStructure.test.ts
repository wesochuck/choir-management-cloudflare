import { describe, expect, it } from "vitest";
import { getAssignableVoiceParts, rosterAssignmentConversion } from "./rosterStructure";
import { isPerformer } from "./index";

describe("getAssignableVoiceParts", () => {
  it("filters out parts belonging to track-only sections", () => {
    const sections = [
      { code: "T", name: "Tenor", trackOnly: false },
      { code: "B", name: "Bass", trackOnly: false },
      { code: "O", name: "Other", trackOnly: true },
    ];
    const voiceParts = [
      { label: "T1", fullName: "Tenor 1", sectionCode: "T" },
      { label: "T2", fullName: "Tenor 2", sectionCode: "T" },
      { label: "B1", fullName: "Bass 1", sectionCode: "B" },
      { label: "SATB", fullName: "SATB Recordings", sectionCode: "O" },
      { label: "TP", fullName: "Two Part", sectionCode: "O" },
    ];
    const assignable = getAssignableVoiceParts(sections, voiceParts);
    expect(assignable.map(({ label }) => label)).toEqual(["T1", "T2", "B1"]);
  });

  it("returns all parts when no sections are track-only", () => {
    const sections = [{ code: "T", trackOnly: false }];
    const voiceParts = [{ label: "T1", sectionCode: "T" }];
    expect(getAssignableVoiceParts(sections, voiceParts)).toEqual(voiceParts);
  });
});

describe("section-only assignments", () => {
  const previous = {
    voiceParts: [
      { label: "F1", sectionCode: "F" },
      { label: "F", sectionCode: "TR" },
    ],
  };
  const next = {
    rosterStructure: "sections_only" as const,
    voiceParts: [
      { label: "F", sectionCode: "F" },
      { label: "TR", sectionCode: "TR" },
    ],
  };

  it("maps original labels to their parent sections even when destination codes overlap labels", () => {
    const conversion = rosterAssignmentConversion(previous, next);
    expect(conversion.get("F1")).toBe("F");
    expect(conversion.get("F")).toBe("TR");
    expect(isPerformer({ voicePart: conversion.get("F1") ?? null })).toBe(true);
    expect(isPerformer({ voicePart: "" })).toBe(false);
  });

  it("is idempotent and preserves section assignments when returning to parts", () => {
    expect(rosterAssignmentConversion(next, next).size).toBe(0);
    expect(rosterAssignmentConversion(next, previous).size).toBe(0);
  });
});
