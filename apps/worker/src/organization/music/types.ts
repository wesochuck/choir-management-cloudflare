import {
  organizationMusicBulkDeleteRequestSchema,
  organizationMusicBulkUpdateRequestSchema,
  organizationMusicCreditRenameRequestSchema,
  organizationMusicGenreDeleteRequestSchema,
  organizationMusicGenreRenameRequestSchema,
  organizationMusicLibrarySettingsRequestSchema,
  organizationMusicPieceRequestSchema,
  organizationMusicPieceSchema,
  type OrganizationMusicLibrarySettings,
  type OrganizationMusicPiece,
} from "@choir/contracts";
import { z } from "zod";

export const operationContextSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

// Durable Object SQLite limits each statement to 100 bound parameters; each piece uses 15.
// Keep each statement below that limit while still reducing a large import to a small number of writes.
export const MUSIC_IMPORT_BATCH_SIZE = 6;

export const musicOperationSchema = z.discriminatedUnion("action", [
  operationContextSchema.extend({
    action: z.literal("create"),
    piece: organizationMusicPieceRequestSchema,
    pieceId: z.uuid(),
  }),
  operationContextSchema.extend({
    action: z.literal("update"),
    piece: organizationMusicPieceRequestSchema,
    pieceId: z.uuid(),
  }),
  operationContextSchema.extend({
    action: z.literal("bulk_update"),
    changes: organizationMusicBulkUpdateRequestSchema.shape.changes,
    pieceIds: organizationMusicBulkUpdateRequestSchema.shape.pieceIds,
  }),
  operationContextSchema.extend({
    action: z.literal("bulk_delete"),
    pieceIds: organizationMusicBulkDeleteRequestSchema.shape.pieceIds,
    unlinkChildren: organizationMusicBulkDeleteRequestSchema.shape.unlinkChildren,
  }),
  operationContextSchema.extend({
    action: z.literal("rename_credit"),
    credit: organizationMusicCreditRenameRequestSchema,
  }),
  operationContextSchema.extend({
    action: z.literal("rename_genre"),
    genre: organizationMusicGenreRenameRequestSchema,
  }),
  operationContextSchema.extend({
    action: z.literal("delete_genre"),
    genre: organizationMusicGenreDeleteRequestSchema,
  }),
  operationContextSchema.extend({
    action: z.literal("delete"),
    pieceId: z.uuid(),
    unlinkChildren: z.boolean().default(false),
  }),
  operationContextSchema.extend({
    action: z.literal("import"),
    pieces: z
      .array(
        z.object({
          piece: organizationMusicPieceRequestSchema,
          pieceId: z.uuid(),
          row: z.number().int().min(2),
        }),
      )
      .min(1)
      .max(500),
  }),
  operationContextSchema.extend({
    action: z.literal("update_settings"),
    settings: organizationMusicLibrarySettingsRequestSchema,
  }),
]);

export type MusicOperation = z.infer<typeof musicOperationSchema>;

export interface MusicPieceRow {
  readonly [column: string]: SqlStorageValue;
  readonly arranger: string;
  readonly catalogId: string;
  readonly composer: string;
  readonly copies: number | null;
  readonly createdAt: string;
  readonly durationSeconds: number | null;
  readonly genresJson: string;
  readonly id: string;
  readonly notes: string;
  readonly parentId: string | null;
  readonly purchaseDate: string | null;
  readonly sectionBucketsJson: string;
  readonly title: string;
  readonly trackFileIdsJson: string;
  readonly updatedAt: string;
}

export interface OrganizationIdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export interface PerformanceHistoryRow {
  readonly [column: string]: SqlStorageValue;
  readonly setListJson: string;
  readonly startsAt: string;
}

export const musicColumns = `id, title, composer, arranger, purchase_date AS purchaseDate, copies,
  catalog_id AS catalogId, duration_seconds AS durationSeconds, notes,
  section_buckets_json AS sectionBucketsJson, genres_json AS genresJson,
  parent_id AS parentId, track_file_ids_json AS trackFileIdsJson,
  created_at AS createdAt, updated_at AS updatedAt`;

export function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function identityMatches(storage: DurableObjectStorage, organizationId: string): boolean {
  return (
    storage.sql
      .exec<OrganizationIdentityRow>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId === organizationId
  );
}

export const defaultMusicLibrarySettings: OrganizationMusicLibrarySettings = {
  genres: [],
  practicePlayerLinkLifetimeDays: 180,
  publisherSearchTemplate: "",
};

export function addPerformanceHistory(
  storage: DurableObjectStorage,
  pieces: readonly OrganizationMusicPiece[],
): OrganizationMusicPiece[] {
  const history = new Map<string, { count: number; lastPerformedAt: string | null }>();
  const events = storage.sql
    .exec<PerformanceHistoryRow>(
      `SELECT starts_at AS startsAt, set_list_json AS setListJson
       FROM events WHERE type = 'Performance' AND is_archived = 0 AND is_canceled = 0
       ORDER BY starts_at ASC LIMIT 500`,
    )
    .toArray();
  for (const event of events) {
    let setList: unknown;
    try {
      setList = JSON.parse(event.setListJson) as unknown;
    } catch {
      continue;
    }
    if (!Array.isArray(setList)) continue;
    for (const item of setList) {
      if (!isUnknownRecord(item)) continue;
      const pieceId = item.pieceId;
      if (typeof pieceId !== "string") continue;
      const current = history.get(pieceId) ?? { count: 0, lastPerformedAt: null };
      current.count += 1;
      if (current.lastPerformedAt === null || event.startsAt > current.lastPerformedAt) {
        current.lastPerformedAt = event.startsAt;
      }
      history.set(pieceId, current);
    }
  }
  return pieces.map((piece) => {
    const own = history.get(piece.id);
    const parent = piece.parentId ? history.get(piece.parentId) : undefined;
    return organizationMusicPieceSchema.parse({
      ...piece,
      lastPerformedAt: own?.lastPerformedAt ?? parent?.lastPerformedAt ?? null,
      performanceCount: own?.count ?? parent?.count ?? 0,
    });
  });
}
