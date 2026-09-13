import { describe, expect, it } from "vitest";

import { buildRosterBalanceLayout } from "./rosterBalanceLayout";

describe("buildRosterBalanceLayout", () => {
  it("computes 2 + 2 configuration layout correctly", () => {
    const sections = [
      { code: "T", name: "Tenors" },
      { code: "B", name: "Basses" },
    ];
    const voiceParts = [
      { label: "T1", sectionCode: "T" },
      { label: "T2", sectionCode: "T" },
      { label: "B1", sectionCode: "B" },
      { label: "B2", sectionCode: "B" },
    ];

    const layout = buildRosterBalanceLayout(sections, voiceParts);

    expect(layout.valid).toBe(true);
    expect(layout.columnCount).toBe(4);
    expect(layout.orderedParts.map((p) => p.label)).toEqual(["T1", "T2", "B1", "B2"]);
    expect(layout.sections).toHaveLength(2);
    expect(layout.sections[0]?.section.code).toBe("T");
    expect(layout.sections[0]?.span).toBe(2);
    expect(layout.sections[0]?.parts.map((p) => p.label)).toEqual(["T1", "T2"]);
    expect(layout.sections[1]?.section.code).toBe("B");
    expect(layout.sections[1]?.span).toBe(2);
    expect(layout.sections[1]?.parts.map((p) => p.label)).toEqual(["B1", "B2"]);

    const totalSpan = layout.sections.reduce((acc, s) => acc + s.span, 0);
    expect(totalSpan).toBe(layout.columnCount);
  });

  it("computes 1 + 3 configuration layout correctly", () => {
    const sections = [
      { code: "T", name: "Tenors" },
      { code: "B", name: "Basses" },
    ];
    const voiceParts = [
      { label: "T1", sectionCode: "T" },
      { label: "B1", sectionCode: "B" },
      { label: "B2", sectionCode: "B" },
      { label: "B3", sectionCode: "B" },
    ];

    const layout = buildRosterBalanceLayout(sections, voiceParts);

    expect(layout.valid).toBe(true);
    expect(layout.columnCount).toBe(4);
    expect(layout.orderedParts.map((p) => p.label)).toEqual(["T1", "B1", "B2", "B3"]);
    expect(layout.sections[0]?.span).toBe(1);
    expect(layout.sections[1]?.span).toBe(3);

    const totalSpan = layout.sections.reduce((acc, s) => acc + s.span, 0);
    expect(totalSpan).toBe(layout.columnCount);
  });

  it("re-orders interleaved raw parts by section order then part order", () => {
    const sections = [
      { code: "T", name: "Tenors" },
      { code: "B", name: "Basses" },
    ];
    const voiceParts = [
      { label: "T1", sectionCode: "T" },
      { label: "B1", sectionCode: "B" },
      { label: "T2", sectionCode: "T" },
      { label: "B2", sectionCode: "B" },
    ];

    const layout = buildRosterBalanceLayout(sections, voiceParts);

    expect(layout.valid).toBe(true);
    expect(layout.columnCount).toBe(4);
    expect(layout.orderedParts.map((p) => p.label)).toEqual(["T1", "T2", "B1", "B2"]);
    expect(layout.sections[0]?.parts.map((p) => p.label)).toEqual(["T1", "T2"]);
    expect(layout.sections[1]?.parts.map((p) => p.label)).toEqual(["B1", "B2"]);
  });

  it("handles multiple uneven sections (e.g. 2 + 3 + 1)", () => {
    const sections = [
      { code: "S", name: "Sopranos" },
      { code: "A", name: "Altos" },
      { code: "T", name: "Tenors" },
    ];
    const voiceParts = [
      { label: "S1", sectionCode: "S" },
      { label: "S2", sectionCode: "S" },
      { label: "A1", sectionCode: "A" },
      { label: "A2", sectionCode: "A" },
      { label: "A3", sectionCode: "A" },
      { label: "T1", sectionCode: "T" },
    ];

    const layout = buildRosterBalanceLayout(sections, voiceParts);

    expect(layout.valid).toBe(true);
    expect(layout.columnCount).toBe(6);
    expect(layout.sections[0]?.span).toBe(2);
    expect(layout.sections[1]?.span).toBe(3);
    expect(layout.sections[2]?.span).toBe(1);

    const totalSpan = layout.sections.reduce((acc, s) => acc + s.span, 0);
    expect(totalSpan).toBe(layout.columnCount);
  });

  it("handles zero visible parts safely", () => {
    const sections = [
      { code: "T", name: "Tenors" },
      { code: "B", name: "Basses" },
    ];
    const voiceParts: { label: string; sectionCode: string }[] = [];

    const layout = buildRosterBalanceLayout(sections, voiceParts);

    expect(layout.valid).toBe(false);
    expect(layout.columnCount).toBe(0);
    expect(layout.orderedParts).toHaveLength(0);
    // Span is defensively at least 1, never 0
    expect(layout.sections.every((s) => s.span >= 1)).toBe(true);
  });

  it("handles empty sections and parts safely", () => {
    const layout = buildRosterBalanceLayout([], []);
    expect(layout.valid).toBe(false);
    expect(layout.columnCount).toBe(0);
    expect(layout.orderedParts).toHaveLength(0);
    expect(layout.sections).toHaveLength(0);
  });

  it("handles invalid or orphan section mapping without dropping parts", () => {
    const sections = [{ code: "T", name: "Tenors" }];
    const voiceParts = [
      { label: "T1", sectionCode: "T" },
      { label: "Orphan1", sectionCode: "UNKNOWN" },
    ];

    const layout = buildRosterBalanceLayout(sections, voiceParts);

    expect(layout.valid).toBe(false);
    expect(layout.columnCount).toBe(2);
    expect(layout.orderedParts.map((p) => p.label)).toEqual(["T1", "Orphan1"]);
  });

  it("handles a section with 0 voice parts as invalid layout with safe fallback spans", () => {
    const sections = [
      { code: "T", name: "Tenors" },
      { code: "B", name: "Basses" },
    ];
    const voiceParts = [
      { label: "T1", sectionCode: "T" },
      { label: "T2", sectionCode: "T" },
    ];

    const layout = buildRosterBalanceLayout(sections, voiceParts);

    expect(layout.valid).toBe(false);
    expect(layout.columnCount).toBe(2);
    expect(layout.sections[0]?.span).toBe(2);
    // Basses has 0 parts, defensively clamped to 1
    expect(layout.sections[1]?.span).toBe(1);
    expect(layout.orderedParts.map((p) => p.label)).toEqual(["T1", "T2"]);
  });
});
