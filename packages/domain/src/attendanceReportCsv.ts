export type AttendanceExportSort = "absences" | "name";

export interface AttendanceReportSinger {
  readonly absences: number;
  readonly attendanceRate: number;
  readonly name: string;
  readonly presenceCount: number;
  readonly totalEvents: number;
  readonly voicePart: string;
}

export interface AttendanceReportInput {
  readonly performerLabel: string;
  readonly singers: readonly AttendanceReportSinger[];
  readonly sort?: AttendanceExportSort;
}

const dangerousFormulaPrefix = /^[=+\-@\t\r]/;

function csvField(value: string | number): string {
  const text = String(value);
  const safe = dangerousFormulaPrefix.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function attendanceRate(rate: number): string {
  return rate.toFixed(1);
}

/**
 * Sort by absences descending, then name ascending (case-insensitive).
 * This mirrors the baseline reportService sort, which is independent of any UI
 * sort selection.
 */
function sortSingers(
  singers: readonly AttendanceReportSinger[],
): readonly AttendanceReportSinger[] {
  return [...singers].sort((left, right) => {
    const absDiff = right.absences - left.absences;
    if (absDiff !== 0) return absDiff;
    return left.name.localeCompare(right.name);
  });
}

export function attendanceReportFilename(performanceTitle: string): string {
  const safe = performanceTitle.replace(/\s+/g, "_");
  return `attendance_report_${safe || "event"}.csv`;
}

export function renderAttendanceReportCsv(input: AttendanceReportInput): string {
  const header = [
    input.performerLabel,
    "Voice Part",
    "Absences",
    "Presence Count",
    "Total Rehearsals",
    "Attendance Rate %",
  ]
    .map(csvField)
    .join(",");

  if (input.singers.length === 0) {
    return `${header}\r\n`;
  }

  const sorted = sortSingers(input.singers);
  const lines = [header];
  for (const singer of sorted) {
    lines.push(
      [
        singer.name,
        singer.voicePart,
        singer.absences,
        singer.presenceCount,
        singer.totalEvents,
        attendanceRate(singer.attendanceRate),
      ]
        .map(csvField)
        .join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}
