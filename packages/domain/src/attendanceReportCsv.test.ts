import { describe, expect, it } from "vitest";

import {
  attendanceReportFilename,
  renderAttendanceReportCsv,
  type AttendanceReportSinger,
} from "./attendanceReportCsv";

const baseSinger: AttendanceReportSinger = {
  absences: 1,
  attendanceRate: 83.3,
  name: "Alice Anderson",
  presenceCount: 5,
  totalEvents: 6,
  voicePart: "Soprano 1",
};

describe("renderAttendanceReportCsv", () => {
  it("produces a header-only CSV when there are no singers", () => {
    const csv = renderAttendanceReportCsv({
      performerLabel: "Performer",
      singers: [],
    });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      '"Name","Last Name","Performer","Absences","Presence Count","Total Rehearsals","Attendance Rate %"',
    );
    expect(lines[1]).toBe("");
  });

  it("uses the configured performerLabel for the performer column header", () => {
    const csv = renderAttendanceReportCsv({
      performerLabel: "Singer",
      singers: [baseSinger],
    });
    expect(csv.split("\r\n")[0]).toBe(
      '"Name","Last Name","Singer","Absences","Presence Count","Total Rehearsals","Attendance Rate %"',
    );
  });

  it("renders a single singer row with correct values including 1-decimal rate", () => {
    const csv = renderAttendanceReportCsv({
      performerLabel: "Performer",
      singers: [baseSinger],
    });
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('"Alice Anderson","Anderson","Soprano 1","1","5","6","83.3"');
  });

  it("sorts by absences descending then surname ascending", () => {
    const highAbsences: AttendanceReportSinger = {
      ...baseSinger,
      absences: 5,
      name: "Zoe Zulu",
    };
    const lowAbsences: AttendanceReportSinger = {
      ...baseSinger,
      absences: 0,
      name: "Bob Brown",
    };
    const midAbsences: AttendanceReportSinger = {
      ...baseSinger,
      absences: 5,
      name: "Alice Adams",
    };
    const csv = renderAttendanceReportCsv({
      performerLabel: "Performer",
      singers: [lowAbsences, highAbsences, baseSinger, midAbsences],
    });
    const dataLines = csv.split("\r\n").slice(1, -1);
    // absences 5 group, surname ascending: Alice Adams, Zoe Zulu
    expect(dataLines[0]).toContain('"Alice Adams","Adams"');
    expect(dataLines[1]).toContain('"Zoe Zulu","Zulu"');
    // absences 1: Alice Anderson
    expect(dataLines[2]).toContain('"Alice Anderson","Anderson"');
    // absences 0: Bob Brown
    expect(dataLines[3]).toContain('"Bob Brown","Brown"');
  });

  it("honors the requested name sort by canonical surname", () => {
    const csv = renderAttendanceReportCsv({
      performerLabel: "Performer",
      singers: [
        { ...baseSinger, absences: 0, name: "Sarah Van Dyke" },
        { ...baseSinger, absences: 0, name: "Mary Ann Smith" },
        { ...baseSinger, absences: 5, name: "Alice Adams" },
      ],
      sort: "name",
    });
    const dataLines = csv.split("\r\n").slice(1, -1);
    // Adams -> Smith -> Van Dyke
    expect(dataLines[0]).toContain('"Alice Adams","Adams"');
    expect(dataLines[1]).toContain('"Mary Ann Smith","Smith"');
    expect(dataLines[2]).toContain('"Sarah Van Dyke","Van Dyke"');
  });

  it("ensures uniform 7-column counts across all rows", () => {
    const csv = renderAttendanceReportCsv({
      performerLabel: "Performer",
      singers: [baseSinger],
    });
    const lines = csv.split("\r\n").filter(Boolean);
    for (const line of lines) {
      expect(line.split(",").length).toBe(7);
    }
  });

  it("escapes commas and quotes in singer name", () => {
    const singer: AttendanceReportSinger = {
      ...baseSinger,
      name: 'Alice "Ace" Anderson, Jr.',
    };
    const csv = renderAttendanceReportCsv({
      performerLabel: "Performer",
      singers: [singer],
    });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"Alice ""Ace"" Anderson, Jr."');
  });

  it("neutralizes spreadsheet-formula injection in performer name", () => {
    const singer: AttendanceReportSinger = {
      ...baseSinger,
      name: '=HYPERLINK("evil")',
    };
    const csv = renderAttendanceReportCsv({
      performerLabel: "Performer",
      singers: [singer],
    });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("'=HYPERLINK");
  });

  it("renders 100.0 and 0.0 attendance rates with exactly one decimal", () => {
    const perfect: AttendanceReportSinger = {
      ...baseSinger,
      attendanceRate: 100,
      name: "Perfect",
    };
    const zero: AttendanceReportSinger = {
      ...baseSinger,
      attendanceRate: 0,
      name: "Zero",
    };
    const csv = renderAttendanceReportCsv({
      performerLabel: "Performer",
      singers: [perfect, zero],
    });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"100.0"');
    expect(lines[2]).toContain('"0.0"');
  });
});

describe("attendanceReportFilename", () => {
  it("replaces whitespace with underscores in the performance title", () => {
    expect(attendanceReportFilename("Winter Concert 2026")).toBe(
      "attendance_report_Winter_Concert_2026.csv",
    );
  });

  it("falls back to 'event' when title is empty", () => {
    expect(attendanceReportFilename("")).toBe("attendance_report_event.csv");
  });
});
