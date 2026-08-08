import type {
  MusicFolderNumberEdit,
  MusicFolderReportDetailRow,
  MusicFolderReportStatus,
  MusicFolderReportSummary,
} from "@choir/contracts";

export type MusicFolderSummaryFilter = "all" | "not-assigned" | "outstanding" | "returned";

export function parseMusicFolderSummaryFilter(value: string): MusicFolderSummaryFilter {
  return value === "not-assigned" || value === "outstanding" || value === "returned"
    ? value
    : "all";
}

export function folderRowKey(profileId: string, eventId: string): string {
  return `${profileId}:${eventId}`;
}

export function formatMusicFolderDate(value: string | null, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(date);
}

export function musicFolderStatusLabel(status: MusicFolderReportStatus): string {
  switch (status) {
    case "not_applicable":
      return "Not Applicable";
    case "not_assigned":
      return "Not Assigned";
    case "outstanding":
      return "Outstanding";
    case "returned":
      return "Returned";
  }
}

export function musicFolderStatusClass(status: MusicFolderReportStatus): string {
  return `music-folder-report__status--${status.replaceAll("_", "-")}`;
}

export function summaryMatchesFilter(
  summary: MusicFolderReportSummary,
  filter: MusicFolderSummaryFilter,
): boolean {
  switch (filter) {
    case "not-assigned":
      return summary.notAssigned > 0;
    case "outstanding":
      return summary.outstanding > 0;
    case "returned":
      return summary.returned > 0;
    case "all":
      return true;
  }
}

export function filterMusicFolderSummaries(
  summaries: readonly MusicFolderReportSummary[],
  query: string,
  filter: MusicFolderSummaryFilter,
): readonly MusicFolderReportSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return summaries.filter(
    (summary) =>
      (normalizedQuery.length === 0 ||
        summary.displayName.toLocaleLowerCase().includes(normalizedQuery)) &&
      summaryMatchesFilter(summary, filter),
  );
}

export function rowHasFolderDraft(
  row: MusicFolderReportDetailRow,
  drafts: Readonly<Record<string, string>>,
): boolean {
  const key = folderRowKey(row.profileId, row.eventId);
  return Object.prototype.hasOwnProperty.call(drafts, key);
}

export function changedFolderEdits(
  rows: readonly MusicFolderReportDetailRow[],
  drafts: Readonly<Record<string, string>>,
): readonly MusicFolderNumberEdit[] {
  return rows
    .filter((row) => row.status !== "not_applicable" && rowHasFolderDraft(row, drafts))
    .filter((row) => drafts[folderRowKey(row.profileId, row.eventId)] !== row.folderNumber)
    .map((row) => ({
      eventId: row.eventId,
      expectedUpdatedAt: row.updatedAt,
      folderNumber: drafts[folderRowKey(row.profileId, row.eventId)] ?? "",
      profileId: row.profileId,
    }));
}

export function hasUnsavedFolderDrafts(
  rows: readonly MusicFolderReportDetailRow[],
  drafts: Readonly<Record<string, string>>,
): boolean {
  return changedFolderEdits(rows, drafts).length > 0;
}
