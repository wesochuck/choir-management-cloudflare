import { describe, expect, it } from "vitest";

import { mapRosterCsvColumns, parseRosterCsv, renderRosterCsv, RosterCsvError } from "./rosterCsv";

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

  it("neutralizes spreadsheet formulas in exported Profile fields", () => {
    const csv = renderRosterCsv([
      {
        displayName: '=HYPERLINK("bad")',
        email: "",
        globalStatus: "Active",
        isSectionLeader: false,
        phone: "+123",
        voicePart: "S1",
      },
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"\'+123"');
  });

  it("round-trips the baseline export without duplicating section leaders", () => {
    const csv = renderRosterCsv([
      {
        displayName: "Singer, One",
        email: "one@example.test",
        globalStatus: "Idle",
        isSectionLeader: true,
        phone: "555-0101",
        voicePart: "S1",
      },
    ]);
    expect(parseRosterCsv(csv)).toEqual([
      {
        displayName: "Singer, One",
        email: "one@example.test",
        globalStatus: "Idle",
        isSectionLeader: true,
        notes: "",
        phone: "555-0101",
        voicePart: "S1",
      },
    ]);
  });

  it("handles escaped quotes and multiline notes with header aliases", () => {
    expect(
      parseRosterCsv(
        'Singer Name,E-mail,Cell,Part,Global Status,Comments,Section Leader\n"Alex ""Ace""",alex@example.test,555,S2,On Break,"Line one\nLine two",yes',
      ),
    ).toEqual([
      expect.objectContaining({
        displayName: 'Alex "Ace"',
        globalStatus: "Idle",
        isSectionLeader: true,
        notes: "Line one\nLine two",
      }),
    ]);
  });

  it("rejects missing names, invalid emails, statuses, and row overflow", () => {
    expect(() => parseRosterCsv("Email\na@example.test")).toThrow(RosterCsvError);
    expect(() => parseRosterCsv("Name,Email\nSinger,invalid")).toThrow(/not valid/);
    expect(() => parseRosterCsv("Name,Status\nSinger,Unknown")).toThrow(/not recognized/);
    expect(() => parseRosterCsv("Name\nOne\nTwo", 1)).toThrow(/at most 1/);
  });

  it("maps arbitrary source headers and preserves section leader rows", () => {
    const mapped = mapRosterCsvColumns(
      [
        "Full name,Contact,Part,Ignore me",
        "Alex Singer,alex@example.test,S1,no",
        "",
        "Section Leaders",
        "Full name,Contact,Part,Ignore me",
        "Alex Singer,alex@example.test,S1,no",
      ].join("\n"),
      [
        { sourceIndex: 0, targetHeader: "Name" },
        { sourceIndex: 1, targetHeader: "Email" },
        { sourceIndex: 2, targetHeader: "Voice Part" },
        { sourceIndex: 3, targetHeader: null },
      ],
    );
    expect(parseRosterCsv(mapped)).toEqual([
      expect.objectContaining({
        displayName: "Alex Singer",
        email: "alex@example.test",
        isSectionLeader: true,
        voicePart: "S1",
      }),
    ]);
  });
});
