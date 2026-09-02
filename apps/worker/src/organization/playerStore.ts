import type { DurableObjectStorage, SqlStorageValue } from "@cloudflare/workers-types";

import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";
import { defaultRosterConfiguration } from "@choir/domain";
import { z } from "zod";

const setListItemSchema = z.object({
  composer: z.string().optional(),
  duration: z.string().optional(),
  id: z.string().optional(),
  isFeaturedNumber: z.boolean().optional(),
  notes: z.string().optional(),
  performerCredits: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ displayName: z.string(), kind: z.literal("guest") }),
        z.object({ displayName: z.string(), kind: z.literal("profile"), profileId: z.string() }),
      ]),
    )
    .optional(),
  pieceId: z.string().optional(),
  soloSmallGroup: z.boolean().optional(),
  title: z.string(),
  type: z.enum(["intermission", "song"]).optional(),
});

type SetListItem = z.infer<typeof setListItemSchema>;

interface PieceRow {
  readonly [column: string]: SqlStorageValue;
  readonly arranger: string;
  readonly composer: string;
  readonly durationSeconds: number;
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly trackFileIds: string;
}

function parseSetListJson(value: string): SetListItem[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const items: SetListItem[] = [];
    for (const item of parsed) {
      const result = setListItemSchema.safeParse(item);
      if (result.success) {
        items.push(result.data);
      }
    }
    return items;
  } catch {
    return [];
  }
}

function parseTrackFileIds(value: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === "string") {
        result[key] = val;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function readPerformerLabel(storage: DurableObjectStorage): string {
  try {
    const raw = storage.sql
      .exec<{ readonly configuration: string }>(
        "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
      )
      .one().configuration;
    const parsed = organizationRosterConfigurationRequestSchema.safeParse(
      JSON.parse(raw) as unknown,
    );
    if (parsed.success) return parsed.data.performerLabel;
  } catch {
    // Fall back for links issued against Organizations without stored roster settings.
  }
  return defaultRosterConfiguration.performerLabel;
}

/**
 * Set lists normally reference a top-level work, while learning tracks can be
 * attached to that work's movements. Resolve both levels so a parent item is
 * playable without requiring the set list editor to duplicate every movement.
 */
function readPieceForSetListItem(
  storage: DurableObjectStorage,
  pieceId: string,
): PieceRow | undefined {
  const rows = storage.sql
    .exec<PieceRow>(
      `SELECT arranger, composer, duration_seconds AS durationSeconds, id,
         parent_id AS parentId, title, track_file_ids_json AS trackFileIds
       FROM music_pieces
       WHERE id = ? OR parent_id = ?
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at ASC, id ASC`,
      pieceId,
      pieceId,
      pieceId,
    )
    .toArray();
  const primary = rows.find((row) => row.id === pieceId) ?? rows[0];
  if (!primary) return undefined;
  const trackFileIds: Record<string, string> = {};
  for (const row of rows) {
    Object.assign(trackFileIds, parseTrackFileIds(row.trackFileIds));
  }
  return { ...primary, trackFileIds: JSON.stringify(trackFileIds) };
}

function toPlaylistItem(
  item: SetListItem,
  pieceMap: Map<string, PieceRow>,
): {
  readonly arranger?: string | undefined;
  readonly composer?: string | undefined;
  readonly durationSeconds?: number | undefined;
  readonly isFeaturedNumber?: boolean | undefined;
  readonly notes?: string | undefined;
  readonly pieceId?: string | undefined;
  readonly title: string;
  readonly trackFileIds: Record<string, string>;
} {
  const piece = item.pieceId ? pieceMap.get(item.pieceId) : undefined;
  const rawComposer = typeof piece?.composer === "string" ? piece.composer : item.composer;
  return {
    arranger: typeof piece?.arranger === "string" ? piece.arranger : undefined,
    composer: typeof rawComposer === "string" ? rawComposer : undefined,
    durationSeconds: typeof piece?.durationSeconds === "number" ? piece.durationSeconds : undefined,
    isFeaturedNumber:
      typeof item.isFeaturedNumber === "boolean" ? item.isFeaturedNumber : undefined,
    notes: typeof item.notes === "string" ? item.notes : undefined,
    pieceId: typeof item.pieceId === "string" ? item.pieceId : undefined,
    title: piece?.title ?? item.title,
    trackFileIds: piece ? parseTrackFileIds(piece.trackFileIds) : {},
  };
}

export function readPlayerDetailsFromStore(
  storage: DurableObjectStorage,
  _organizationId: string | null,
  eventId: string | null,
  profileId: string | null,
): Response {
  if (!eventId || !profileId) {
    return Response.json({ code: "missing_parameters" }, { status: 400 });
  }
  const eventRow = storage.sql
    .exec<{
      id: string;
      publicGraphicFileId: string | null;
      setListJson: string;
      startsAt: string;
      title: string;
    }>(
      `SELECT id, set_list_json AS setListJson, starts_at AS startsAt, title,
         public_graphic_file_id AS publicGraphicFileId
       FROM events WHERE id = ? AND is_archived = 0 AND is_canceled = 0
         AND set_list_approved = 1 LIMIT 1`,
      eventId,
    )
    .toArray()
    .at(0);
  if (!eventRow) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const profileRow = storage.sql
    .exec<{ displayName: string }>(
      "SELECT display_name AS displayName FROM profiles WHERE id = ? LIMIT 1",
      profileId,
    )
    .toArray()
    .at(0);
  if (!profileRow) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const setList = parseSetListJson(eventRow.setListJson);
  const pieceIds = setList
    .map((item) => item.pieceId)
    .filter((id): id is string => id !== undefined);
  const pieceMap = new Map<string, PieceRow>();
  if (pieceIds.length > 0) {
    for (const pieceId of pieceIds) {
      const piece = readPieceForSetListItem(storage, pieceId);
      if (piece) {
        pieceMap.set(pieceId, piece);
      }
    }
  }
  const items = setList.map((item) => toPlaylistItem(item, pieceMap));
  return Response.json({
    eventArtworkFileId: eventRow.publicGraphicFileId ?? null,
    eventId: eventRow.id,
    eventTitle: eventRow.title,
    eventStartsAt: eventRow.startsAt,
    items,
    performerLabel: readPerformerLabel(storage),
    profileId,
    profileName: profileRow.displayName,
  });
}

export function readPlayerPlaylistFromStore(
  storage: DurableObjectStorage,
  _organizationId: string | null,
  eventId: string | null,
): Response {
  if (!eventId) return Response.json({ code: "missing_parameters" }, { status: 400 });
  const eventRow = storage.sql
    .exec<{
      id: string;
      publicGraphicFileId: string | null;
      setListJson: string;
      startsAt: string;
      title: string;
    }>(
      `SELECT id, set_list_json AS setListJson, starts_at AS startsAt, title,
         public_graphic_file_id AS publicGraphicFileId
       FROM events WHERE id = ? AND is_archived = 0 AND is_canceled = 0
         AND set_list_approved = 1 LIMIT 1`,
      eventId,
    )
    .toArray()
    .at(0);
  if (!eventRow) return Response.json({ code: "event_not_found" }, { status: 404 });

  const setList = parseSetListJson(eventRow.setListJson);
  const pieceIds = setList
    .map((item) => item.pieceId)
    .filter((id): id is string => id !== undefined);
  const pieceMap = new Map<string, PieceRow>();
  for (const pieceId of pieceIds) {
    const piece = readPieceForSetListItem(storage, pieceId);
    if (piece) pieceMap.set(pieceId, piece);
  }
  const items = setList.map((item) => toPlaylistItem(item, pieceMap));
  return Response.json({
    eventArtworkFileId: eventRow.publicGraphicFileId ?? null,
    eventId: eventRow.id,
    eventStartsAt: eventRow.startsAt,
    eventTitle: eventRow.title,
    items,
    performerLabel: readPerformerLabel(storage),
  });
}
