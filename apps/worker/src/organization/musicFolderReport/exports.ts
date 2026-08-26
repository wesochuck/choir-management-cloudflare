import {
  MUSIC_FOLDER_REPORT_MAX_EXPORT_BYTES,
  MUSIC_FOLDER_REPORT_MAX_EXPORT_ROWS,
} from "@choir/contracts";
import {
  deriveMusicFolderStatus,
  normalizeFolderNumber,
  renderMusicFolderReportCsv,
} from "@choir/domain";
import type { MusicFolderReportStatus } from "@choir/contracts";

import { identityMatches, queryRequestSchema } from "./types.js";
import { folderRowsForEvents, parseRequestBody, validateSelectedPerformances } from "./queries.js";

export async function exportMusicFolderReportFromStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = queryRequestSchema.safeParse(await parseRequestBody(request));
  if (!parsed.success) {
    return Response.json({ code: "invalid_music_folder_report_export" }, { status: 400 });
  }
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const invalid = validateSelectedPerformances(storage, parsed.data.eventIds);
  if (invalid) return invalid;
  const rows = folderRowsForEvents(storage, parsed.data.eventIds);
  const assignedProfiles = new Set(
    rows
      .filter((row) => normalizeFolderNumber(row.folderNumber).length > 0)
      .map((row) => row.profileId),
  );
  const exportRows = rows
    .filter((row) => assignedProfiles.has(row.profileId))
    .map((row) => ({
      eventTitle: row.eventTitle,
      folderNumber: normalizeFolderNumber(row.folderNumber),
      isArchived: row.isArchived === 1,
      isCanceled: row.isCanceled === 1,
      profileName: row.displayName,
      returnedAt: row.returnedAt,
      startsAt: row.startsAt,
      status: deriveMusicFolderStatus(row.folderNumber, row.folderReturned === 1),
    }))
    .filter(
      (
        row,
      ): row is typeof row & {
        status: Exclude<MusicFolderReportStatus, "not_applicable">;
      } => row.status !== "not_applicable",
    );
  if (exportRows.length > MUSIC_FOLDER_REPORT_MAX_EXPORT_ROWS) {
    return Response.json({ code: "music_folder_report_export_too_large" }, { status: 413 });
  }
  const csv = renderMusicFolderReportCsv(exportRows);
  if (new TextEncoder().encode(csv).byteLength > MUSIC_FOLDER_REPORT_MAX_EXPORT_BYTES) {
    return Response.json({ code: "music_folder_report_export_too_large" }, { status: 413 });
  }
  return new Response(csv, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="music_folder_report.csv"',
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
