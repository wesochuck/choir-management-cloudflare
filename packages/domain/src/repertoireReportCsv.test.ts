import { describe, expect, it } from "vitest";

import {
  renderRepertoireReportCsv,
  repertoireReportFilename,
  type RepertoireReportPiece,
} from "./repertoireReportCsv";

const basePiece: RepertoireReportPiece = {
  arranger: "Jane Arranger",
  catalogId: "CAT-001",
  composer: "John Composer",
  lastPerformed: "2026-06-15T19:30:00.000Z",
  title: "Amazing Grace",
  totalPerformances: 3,
};

describe("renderRepertoireReportCsv", () => {
  it("produces a header-only CSV when there are no pieces", () => {
    const csv = renderRepertoireReportCsv({ pieces: [] });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      '"Title","Composer","Arranger","Catalog ID","Total Performances","Last Performed"',
    );
    expect(lines[1]).toBe("");
  });

  it("renders pieces never performed with Never and 0 total", () => {
    const never: RepertoireReportPiece = {
      ...basePiece,
      lastPerformed: null,
      title: "Brand New",
      totalPerformances: 0,
    };
    const csv = renderRepertoireReportCsv({ pieces: [never] });
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('"Brand New","John Composer","Jane Arranger","CAT-001","0","Never"');
  });

  it("sorts pieces by title ascending", () => {
    const zebra: RepertoireReportPiece = { ...basePiece, title: "Zebra Song" };
    const apple: RepertoireReportPiece = { ...basePiece, title: "Apple Song" };
    const mango: RepertoireReportPiece = { ...basePiece, title: "Mango Song" };
    const csv = renderRepertoireReportCsv({ pieces: [zebra, apple, mango] });
    const dataLines = csv.split("\r\n").slice(1, -1);
    expect(dataLines[0]).toContain('"Apple Song"');
    expect(dataLines[1]).toContain('"Mango Song"');
    expect(dataLines[2]).toContain('"Zebra Song"');
  });

  it("escapes commas and quotes in title and composer", () => {
    const piece: RepertoireReportPiece = {
      ...basePiece,
      composer: 'John "JC" Composer, Jr.',
      title: 'Amazing "Grace", Version 2',
    };
    const csv = renderRepertoireReportCsv({ pieces: [piece] });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"Amazing ""Grace"", Version 2"');
    expect(lines[1]).toContain('"John ""JC"" Composer, Jr."');
  });

  it("neutralizes spreadsheet-formula injection in catalog ID", () => {
    const piece: RepertoireReportPiece = {
      ...basePiece,
      catalogId: "=cmd|/c|calc",
    };
    const csv = renderRepertoireReportCsv({ pieces: [piece] });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("'=cmd");
  });

  it("renders empty composer/arranger as empty quoted field, not undefined", () => {
    const piece: RepertoireReportPiece = {
      ...basePiece,
      arranger: "",
      composer: "",
    };
    const csv = renderRepertoireReportCsv({ pieces: [piece] });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"Amazing Grace","","","CAT-001"');
  });

  it("renders lastPerformed as YYYY-MM-DD for deterministic output", () => {
    const piece: RepertoireReportPiece = {
      ...basePiece,
      lastPerformed: "2026-06-15T19:30:00.000Z",
    };
    const csv = renderRepertoireReportCsv({ pieces: [piece] });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"2026-06-15"');
  });

  it("renders Never for an invalid date string", () => {
    const piece: RepertoireReportPiece = {
      ...basePiece,
      lastPerformed: "not-a-date",
    };
    const csv = renderRepertoireReportCsv({ pieces: [piece] });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"Never"');
  });
});

describe("repertoireReportFilename", () => {
  it("always returns the fixed filename", () => {
    expect(repertoireReportFilename()).toBe("repertoire_history_report.csv");
  });
});
