import { describe, expect, it } from "vitest";
import { emailAddressSchema } from "@choir/contracts";

import {
  inspectRosterCsv,
  mapRosterCsvColumns,
  parseRosterCsv,
  renderRosterCsv,
  resolveVoicePartLabel,
  RosterCsvError,
} from "./rosterCsv";

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
        "Name,Email,Phone,Performer,Status",
        '"Alex ""Ace"", Singer","alex@example.test","555-0100","T2","Idle"',
        '"Sam Singer","","","B2","Active"',
        "",
        "Section Leaders",
        "Name,Email,Phone,Performer,Status",
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

  it("round-trips an export using the configured performer label", () => {
    const csv = renderRosterCsv(
      [
        {
          displayName: "Singer One",
          email: "one@example.test",
          globalStatus: "Active",
          isSectionLeader: false,
          phone: "",
          voicePart: "S1",
        },
      ],
      "Singer",
    );
    expect(parseRosterCsv(csv, 500, "Singer")[0]?.voicePart).toBe("S1");
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

  it("uses the same email validator as the API contract", () => {
    const email = "singer..name@example.test";
    expect(emailAddressSchema.safeParse(email).success).toBe(false);
    expect(() => parseRosterCsv(`Name,Email\nSinger,${email}`)).toThrow(/not valid/);
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

  describe("voice part auto-resolution and validation", () => {
    const configuredVoiceParts = [
      { fullName: "Soprano 1", label: "S1" },
      { fullName: "Soprano 2", label: "S2" },
      { fullName: "Alto 1", label: "A1" },
      { fullName: "Alto 2", label: "A2" },
      { fullName: "Tenor 1", label: "T1" },
      { fullName: "Tenor 2", label: "T2" },
      { fullName: "Bass 1", label: "B1" },
      { fullName: "Bass 2", label: "B2" },
    ];

    it("resolves voice parts by label and fullName case-insensitively with trimming", () => {
      expect(resolveVoicePartLabel("s1", configuredVoiceParts)).toEqual({
        matched: true,
        canonicalLabel: "S1",
      });
      expect(resolveVoicePartLabel("  Soprano 1  ", configuredVoiceParts)).toEqual({
        matched: true,
        canonicalLabel: "S1",
      });
      expect(resolveVoicePartLabel("alto 2", configuredVoiceParts)).toEqual({
        matched: true,
        canonicalLabel: "A2",
      });
      expect(resolveVoicePartLabel("", configuredVoiceParts)).toEqual({
        matched: true,
        canonicalLabel: "",
      });
      expect(resolveVoicePartLabel("Baritenor", configuredVoiceParts)).toEqual({
        matched: false,
      });
    });

    it("maps standard full voice part names and trimmed lowercase labels to canonical labels on CSV import", () => {
      const csv = [
        "Name,Voice Part",
        "Singer One,Soprano 1",
        "Singer Two, alto 2 ",
        "Singer Three,t1",
        "Singer Four,",
      ].join("\n");
      const parsed = parseRosterCsv(csv, 500, "Performer", configuredVoiceParts);
      expect(parsed[0]?.voicePart).toBe("S1");
      expect(parsed[1]?.voicePart).toBe("A2");
      expect(parsed[2]?.voicePart).toBe("T1");
      expect(parsed[3]?.voicePart).toBe("");
    });

    it("rejects unrecognized voice parts with row number, offending value, and configured options", () => {
      const csv = ["Name,Voice Part", "Valid Singer,S1", "Invalid Singer,Baritenor"].join("\n");
      expect(() => parseRosterCsv(csv, 500, "Performer", configuredVoiceParts)).toThrow(
        'Unrecognized voice part "Baritenor" on row 3. Configured voice parts: S1, S2, A1, A2, T1, T2, B1, B2.',
      );
    });

    it("surfaces pre-import warnings and fatal error for unrecognized voice parts during inspection", () => {
      const csv = ["Name,Voice Part", "Alice,Soprano 1", "Bob,Baritenor"].join("\n");
      const inspection = inspectRosterCsv(csv, "Performer", configuredVoiceParts);
      expect(inspection.fatalError).toBe(
        'Unrecognized voice part "Baritenor" on row 3. Configured voice parts: S1, S2, A1, A2, T1, T2, B1, B2.',
      );
      expect(inspection.warnings).toContainEqual(
        expect.objectContaining({
          header: "Voice Part",
          message:
            'Unrecognized voice part "Baritenor". Configured voice parts: S1, S2, A1, A2, T1, T2, B1, B2.',
          rows: [3],
        }),
      );
    });

    it("inspects cleanly when full names are resolved", () => {
      const csv = ["Name,Voice Part", "Alice,Soprano 1", "Bob,Alto 2"].join("\n");
      const inspection = inspectRosterCsv(csv, "Performer", configuredVoiceParts);
      expect(inspection.fatalError).toBeNull();
      expect(inspection.warnings).toHaveLength(0);
    });
  });
});
