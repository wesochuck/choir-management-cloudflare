import { describe, expect, it } from "vitest";

import { renderRosterCsv } from "./rosterCsv";

describe("roster CSV", () => {
  it("preserves field order, Idle status, escaping, and the section-leader block", () => {
    expect(
      renderRosterCsv([
        {
          displayName: 'Alex "Ace", Singer',
          email: "alex@example.test",
          globalStatus: "Idle",
          isSectionLeader: true,
          phone: "555-0100",
          voicePart: "T2",
        },
        {
          displayName: "Sam Singer",
          email: "",
          globalStatus: "Active",
          isSectionLeader: false,
          phone: "",
          voicePart: "B2",
        },
      ]),
    ).toBe(
      [
        "Name,Email,Phone,Voice Part,Status",
        '"Alex ""Ace"", Singer","alex@example.test","555-0100","T2","Idle"',
        '"Sam Singer","","","B2","Active"',
        "",
        "Section Leaders",
        "Name,Email,Phone,Voice Part,Status",
        '"Alex ""Ace"", Singer","alex@example.test","555-0100","T2","Idle"',
      ].join("\n"),
    );
  });

  it("omits the leader block when no Profile is a section leader", () => {
    const csv = renderRosterCsv([
      {
        displayName: "Singer",
        email: "",
        globalStatus: "Inactive",
        isSectionLeader: false,
        phone: "",
        voicePart: "",
      },
    ]);
    expect(csv).not.toContain("Section Leaders");
    expect(csv.split("\n")).toHaveLength(2);
  });
});
