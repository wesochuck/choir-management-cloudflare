import { describe, expect, it } from "vitest";
import { rosterAssignmentConversion } from "./rosterStructure";
import { isPerformer } from "./index";

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
