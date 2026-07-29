import { describe, expect, it } from "vitest";

import {
  inspectMusicCsv,
  MusicCsvError,
  musicCsvHeader,
  parseMusicCsv,
  renderMusicCsv,
  selectMusicCsvColumns,
} from "./musicCsv";

describe("music CSV", () => {
  it("preserves the baseline header and renders current metadata safely", () => {
    expect(
      renderMusicCsv([
        {
          arranger: 'Doe, Jane "J"',
          catalogId: "CAT-1",
          composer: "Handel",
          copies: 24,
          durationSeconds: 3_725,
          genres: ["Classical", "Sacred"],
          notes: "Line one\nLine two",
          purchaseDate: "2026-05-01",
          sectionBuckets: ["S", "A"],
          title: "=Hallelujah",
        },
      ]),
    ).toBe(
      [
        musicCsvHeader,
        '"\'=Hallelujah","Handel","Doe, Jane ""J""","24","CAT-1","1:02:05","","S;A","Classical;Sacred","2026-05-01","Line one\nLine two"',
      ].join("\n"),
    );
  });

  it("parses quoted multiline fields and all supported legacy columns", () => {
    const pieces = parseMusicCsv(
      [
        musicCsvHeader,
        '"Hallelujah","Handel","Doe, Jane","24","CAT-1","4:05","SATB","S;A","Classical;Sacred","2026-05-01","First line',
        'second line"',
        '"All Choir","","","","","","","All","","",""',
      ].join("\r\n"),
    );
    expect(pieces).toEqual([
      {
        arranger: "Doe, Jane",
        catalogId: "CAT-1",
        composer: "Handel",
        copies: 24,
        durationSeconds: 245,
        genres: ["Classical", "Sacred"],
        notes: "First line\r\nsecond line",
        purchaseDate: "2026-05-01",
        sectionBuckets: ["S", "A"],
        title: "Hallelujah",
      },
      {
        arranger: "",
        catalogId: "",
        composer: "",
        copies: null,
        durationSeconds: null,
        genres: [],
        notes: "",
        purchaseDate: null,
        sectionBuckets: [],
        title: "All Choir",
      },
    ]);
  });

  it("rejects the whole file on invalid bounded values", () => {
    expect(() => parseMusicCsv("Title,Copies\nBad,1.5")).toThrow(MusicCsvError);
    expect(() => parseMusicCsv("Title,Duration\nBad,4:99")).toThrow(
      "Duration minutes and seconds must be below 60.",
    );
    expect(() => parseMusicCsv("Composer\nHandel")).toThrow('CSV must contain a "Title" column.');
  });

  it("previews ignored columns and invalid rows for a graceful import", () => {
    const inspection = inspectMusicCsv(
      ["Title,Duration,Legacy Notes", "Good,4:05,ok", "Needs review,4:99,ok"].join("\n"),
    );
    expect(inspection.warnings).toEqual([
      {
        header: "Legacy Notes",
        message: "This column is not part of the preferred music format and will be ignored.",
      },
      {
        header: "Duration",
        message: "Duration minutes and seconds must be below 60.",
        rows: [3],
      },
    ]);
  });

  it("can remove excluded columns before the server import", () => {
    expect(
      selectMusicCsvColumns("Title,Duration,Legacy\nGood,4:05,ignore", ["Duration", "Legacy"]),
    ).toBe('"Title"\n"Good"');
  });
});
