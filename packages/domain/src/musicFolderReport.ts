import { lastNameSortKey } from "./name";

export type MusicFolderReportStatus =
  "not_applicable" | "not_assigned" | "outstanding" | "returned";

export interface MusicFolderCountRow {
  readonly status: MusicFolderReportStatus;
}

export interface MusicFolderReportCounts {
  readonly assigned: number;
  readonly notAssigned: number;
  readonly outstanding: number;
  readonly returnRate: number;
  readonly returned: number;
}

export interface MusicFolderProfileSortValue {
  readonly displayName: string;
  readonly profileId: string;
}

export interface MusicFolderCsvRow {
  readonly eventTitle: string;
  readonly folderNumber: string;
  readonly isArchived: boolean;
  readonly isCanceled: boolean;
  readonly profileName: string;
  readonly returnedAt: string | null;
  readonly startsAt: string;
  readonly status: Exclude<MusicFolderReportStatus, "not_applicable">;
}

const dangerousFormulaPrefix = /^[=+\-@\t\r]/;

export function normalizeFolderNumber(value: string): string {
  return value.trim();
}

export function normalizedFolderNumberKey(value: string): string {
  return normalizeFolderNumber(value).toLowerCase();
}

export function deriveMusicFolderStatus(
  folderNumber: string,
  folderReturned: boolean,
  applicable = true,
): MusicFolderReportStatus {
  if (!applicable) return "not_applicable";
  if (normalizeFolderNumber(folderNumber).length === 0) return "not_assigned";
  return folderReturned ? "returned" : "outstanding";
}

export function calculateMusicFolderCounts(
  rows: readonly MusicFolderCountRow[],
): MusicFolderReportCounts {
  const returned = rows.filter((row) => row.status === "returned").length;
  const outstanding = rows.filter((row) => row.status === "outstanding").length;
  const notAssigned = rows.filter((row) => row.status === "not_assigned").length;
  const assigned = returned + outstanding;
  return {
    assigned,
    notAssigned,
    outstanding,
    returnRate: assigned === 0 ? 0 : returned / assigned,
    returned,
  };
}

export function sortMusicFolderProfiles<T extends MusicFolderProfileSortValue>(
  profiles: readonly T[],
): readonly T[] {
  return [...profiles].sort((left, right) => {
    const lastNameComparison = lastNameSortKey(left.displayName).localeCompare(
      lastNameSortKey(right.displayName),
    );
    if (lastNameComparison !== 0) return lastNameComparison;
    const displayNameComparison = left.displayName.localeCompare(right.displayName);
    if (displayNameComparison !== 0) return displayNameComparison;
    return left.profileId.localeCompare(right.profileId);
  });
}

function csvField(value: string | number): string {
  const text = String(value);
  const safe = dangerousFormulaPrefix.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function performanceState(row: MusicFolderCsvRow): string {
  if (row.isArchived && row.isCanceled) return "Canceled; Archived";
  if (row.isArchived) return "Archived";
  if (row.isCanceled) return "Canceled";
  return "Active";
}

function statusLabel(status: Exclude<MusicFolderReportStatus, "not_applicable">): string {
  switch (status) {
    case "not_assigned":
      return "Not Assigned";
    case "outstanding":
      return "Outstanding";
    case "returned":
      return "Returned";
  }
}

export function musicFolderReportFilename(): string {
  return "music_folder_report.csv";
}

export function renderMusicFolderReportCsv(rows: readonly MusicFolderCsvRow[]): string {
  const lines = [
    [
      "Profile",
      "Performance",
      "Performance Start",
      "Performance State",
      "Folder Number",
      "Folder Return Status",
      "Returned At",
    ]
      .map(csvField)
      .join(","),
  ];
  const sorted = [...rows].sort((left, right) => {
    const eventComparison = right.startsAt.localeCompare(left.startsAt);
    if (eventComparison !== 0) return eventComparison;
    const profileComparison = lastNameSortKey(left.profileName).localeCompare(
      lastNameSortKey(right.profileName),
    );
    if (profileComparison !== 0) return profileComparison;
    return left.profileName.localeCompare(right.profileName);
  });
  for (const row of sorted) {
    lines.push(
      [
        row.profileName,
        row.eventTitle,
        row.startsAt,
        performanceState(row),
        row.folderNumber,
        statusLabel(row.status),
        row.returnedAt ?? "",
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
