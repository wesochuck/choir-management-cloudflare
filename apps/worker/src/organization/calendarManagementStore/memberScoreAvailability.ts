import { resolveMemberScoreFile } from "@choir/domain";
import { z } from "zod";

const scoreFilesSchema = z.record(z.string(), z.string());

/** Resolve only listed pieces and ready files, within this Organization's storage. */
export function withMemberScoreAvailability<
  T extends { readonly setList: readonly { readonly pieceId?: string | undefined }[] },
>(storage: DurableObjectStorage, events: readonly T[], voicePart: string) {
  const pieceIds = [
    ...new Set(
      events.flatMap((event) =>
        event.setList.flatMap((item) => (item.pieceId ? [item.pieceId] : [])),
      ),
    ),
  ];
  const resolvedFiles = new Map<string, string>();
  for (let offset = 0; offset < pieceIds.length; offset += 100) {
    const batch = pieceIds.slice(offset, offset + 100);
    const rows = storage.sql.exec<{
      id: string;
      scoreFiles: string;
      parentScoreFiles: string | null;
    }>(
      `SELECT piece.id, piece.score_file_ids_json AS scoreFiles,
          parent.score_file_ids_json AS parentScoreFiles
        FROM music_pieces piece LEFT JOIN music_pieces parent ON parent.id = piece.parent_id
        WHERE piece.id IN (${batch.map(() => "?").join(",")})`,
      ...batch,
    );
    for (const row of rows) {
      const score = resolveMemberScoreFile(
        { scoreFileIds: scoreFilesSchema.parse(JSON.parse(row.scoreFiles)) },
        voicePart,
        { scoreFileIds: scoreFilesSchema.parse(JSON.parse(row.parentScoreFiles ?? "{}")) },
      );
      if (score) resolvedFiles.set(row.id, score.fileId);
    }
  }
  const fileIds = [...new Set(resolvedFiles.values())];
  const readyFiles = new Set<string>();
  for (let offset = 0; offset < fileIds.length; offset += 100) {
    const batch = fileIds.slice(offset, offset + 100);
    for (const row of storage.sql.exec<{ id: string }>(
      `SELECT id FROM private_files WHERE status = 'ready' AND content_type = 'application/pdf'
       AND id IN (${batch.map(() => "?").join(",")})`,
      ...batch,
    ))
      readyFiles.add(row.id);
  }
  return events.map((event) => ({
    ...event,
    setList: event.setList.map((item) => ({
      ...item,
      scoreAvailable: Boolean(
        item.pieceId && readyFiles.has(resolvedFiles.get(item.pieceId) ?? ""),
      ),
    })),
  }));
}
