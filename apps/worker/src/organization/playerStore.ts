import type { DurableObjectStorage, SqlStorageValue } from "@cloudflare/workers-types";

import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";
import { defaultRosterConfiguration, sortMusicMovements } from "@choir/domain";
import { z } from "zod";

const setListItemSchema = z.object({
  composer: z.string().optional(),
  cueInstruction: z.string().optional(),
  cueKind: z.enum(["timed", "quick"]).optional(),
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

export type SetListItem = z.infer<typeof setListItemSchema>;

export interface PieceRow {
  readonly [column: string]: SqlStorageValue | undefined;
  readonly arranger: string | null;
  readonly composer: string | null;
  readonly durationSeconds: number | null;
  readonly id: string;
  readonly movementOrderJson?: string | null | undefined;
  readonly parentId: string | null;
  readonly title: string;
  readonly trackFileIds: string | null;
}

export function parseMovementOrderJson(value: string | null | undefined): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
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

export function parseTrackFileIds(value: string | null | undefined): Record<string, string> {
  if (typeof value !== "string" || !value.trim()) return {};
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

function readRosterConfiguration(storage: DurableObjectStorage): {
  readonly performerLabel: string;
  readonly sections: readonly { readonly code: string; readonly name: string }[];
  readonly voiceParts: readonly { readonly fullName: string; readonly label: string }[];
} {
  try {
    const raw = storage.sql
      .exec<{ readonly configuration: string }>(
        "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
      )
      .one().configuration;
    const parsed = organizationRosterConfigurationRequestSchema.safeParse(
      JSON.parse(raw) as unknown,
    );
    if (parsed.success) return parsed.data;
  } catch {
    // Fall back for links issued against Organizations without stored roster settings.
  }
  return defaultRosterConfiguration;
}

export function readTrackLabels(
  storageOrConfig:
    | DurableObjectStorage
    | {
        readonly sections: readonly { readonly code: string; readonly name: string }[];
        readonly voiceParts: readonly { readonly fullName: string; readonly label: string }[];
      },
): Record<string, string> {
  const config =
    "sql" in storageOrConfig ? readRosterConfiguration(storageOrConfig) : storageOrConfig;

  const trackLabels: Record<string, string> = {};

  for (const section of config.sections) {
    const code = section.code.trim();
    const name = section.name.trim();
    if (code && name) {
      trackLabels[code] = name;
    }
  }

  for (const part of config.voiceParts) {
    const label = part.label.trim();
    const fullName = part.fullName.trim();
    if (label && fullName) {
      trackLabels[label] = fullName;
    }
  }

  trackLabels.tutti = "Choir Mix";
  trackLabels.choirmix = "Choir Mix";

  return trackLabels;
}

function cleanOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolvePieceCredits(
  piece: PieceRow | undefined,
  parentPiece: PieceRow | undefined,
  itemComposer: string | undefined,
): { readonly arranger?: string | undefined; readonly composer?: string | undefined } {
  return {
    arranger: cleanOptionalString(piece?.arranger) ?? cleanOptionalString(parentPiece?.arranger),
    composer:
      cleanOptionalString(piece?.composer) ??
      cleanOptionalString(parentPiece?.composer) ??
      cleanOptionalString(itemComposer),
  };
}

export function toPlaylistItem(
  item: SetListItem,
  pieceMap: ReadonlyMap<string, PieceRow>,
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
  const parentPiece = piece?.parentId ? pieceMap.get(piece.parentId) : undefined;
  const { arranger, composer } = resolvePieceCredits(piece, parentPiece, item.composer);
  return {
    arranger,
    composer,
    durationSeconds: typeof piece?.durationSeconds === "number" ? piece.durationSeconds : undefined,
    isFeaturedNumber:
      typeof item.isFeaturedNumber === "boolean" ? item.isFeaturedNumber : undefined,
    notes: cleanOptionalString(item.notes),
    pieceId: cleanOptionalString(item.pieceId),
    title: piece?.title ?? item.title,
    trackFileIds: piece ? parseTrackFileIds(piece.trackFileIds) : {},
  };
}

export function resolveSetListPlaylistItems(
  setList: readonly SetListItem[],
  pieceMap: ReadonlyMap<string, PieceRow>,
  childrenMap?: ReadonlyMap<string, readonly PieceRow[]>,
): {
  readonly arranger?: string | undefined;
  readonly composer?: string | undefined;
  readonly durationSeconds?: number | undefined;
  readonly isFeaturedNumber?: boolean | undefined;
  readonly notes?: string | undefined;
  readonly pieceId?: string | undefined;
  readonly title: string;
  readonly trackFileIds: Record<string, string>;
}[] {
  const setListPieceIds = new Set(
    setList.map((i) => i.pieceId).filter((id): id is string => id !== undefined),
  );
  return setList.flatMap((item) => {
    if (!item.pieceId) {
      return [toPlaylistItem(item, pieceMap)];
    }
    const directPiece = pieceMap.get(item.pieceId);
    const children = childrenMap?.get(item.pieceId) ?? [];
    const hasDirectTracks =
      directPiece !== undefined &&
      Object.keys(parseTrackFileIds(directPiece.trackFileIds)).length > 0;

    if (children.length > 0 && !hasDirectTracks) {
      if (children.some((child) => setListPieceIds.has(child.id))) {
        return [];
      }
      const sortedChildren = sortMusicMovements(
        children,
        parseMovementOrderJson(directPiece?.movementOrderJson),
      );
      return sortedChildren.map((child) => {
        const { arranger, composer } = resolvePieceCredits(child, directPiece, item.composer);
        return {
          arranger,
          composer,
          durationSeconds:
            typeof child.durationSeconds === "number" ? child.durationSeconds : undefined,
          isFeaturedNumber:
            typeof item.isFeaturedNumber === "boolean" ? item.isFeaturedNumber : undefined,
          notes: cleanOptionalString(item.notes),
          pieceId: child.id,
          title: child.title,
          trackFileIds: parseTrackFileIds(child.trackFileIds),
        };
      });
    }

    return [toPlaylistItem(item, pieceMap)];
  });
}

interface StoredPieceRow {
  readonly [column: string]: SqlStorageValue;
  readonly arranger: string | null;
  readonly composer: string | null;
  readonly durationSeconds: number | null;
  readonly id: string;
  readonly movementOrderJson: string | null;
  readonly parentId: string | null;
  readonly title: string;
  readonly trackFileIds: string | null;
}

function readPiecesForSetList(
  storage: DurableObjectStorage,
  pieceIds: readonly string[],
): {
  readonly childrenMap: Map<string, PieceRow[]>;
  readonly pieceMap: Map<string, PieceRow>;
} {
  const pieceMap = new Map<string, PieceRow>();
  const childrenMap = new Map<string, PieceRow[]>();
  const uniquePieceIds = new Set(pieceIds);

  for (const pieceId of uniquePieceIds) {
    const rows = storage.sql
      .exec<StoredPieceRow>(
        `SELECT arranger, composer, duration_seconds AS durationSeconds, id,
           movement_order_json AS movementOrderJson,
           parent_id AS parentId, title, track_file_ids_json AS trackFileIds
         FROM music_pieces
         WHERE id = ? OR parent_id = ?
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at ASC, id ASC`,
        pieceId,
        pieceId,
        pieceId,
      )
      .toArray();

    const directRow = rows.find((row) => row.id === pieceId);
    if (directRow) {
      pieceMap.set(pieceId, directRow);
    }
    const childRows = rows.filter((row) => row.parentId === pieceId);
    if (childRows.length > 0) {
      childrenMap.set(
        pieceId,
        sortMusicMovements(childRows, parseMovementOrderJson(directRow?.movementOrderJson)),
      );
    }
  }

  return { childrenMap, pieceMap };
}

function readOrganizationName(storage: DurableObjectStorage): string | undefined {
  try {
    const row = storage.sql
      .exec<{ name: string }>("SELECT name FROM organization_metadata LIMIT 1")
      .toArray()
      .at(0);
    return row?.name ? row.name.trim() : undefined;
  } catch {
    return undefined;
  }
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
  const { childrenMap, pieceMap } = readPiecesForSetList(storage, pieceIds);
  const items = resolveSetListPlaylistItems(setList, pieceMap, childrenMap);
  const rosterConfig = readRosterConfiguration(storage);
  return Response.json({
    eventArtworkFileId: eventRow.publicGraphicFileId ?? null,
    eventId: eventRow.id,
    eventTitle: eventRow.title,
    eventStartsAt: eventRow.startsAt,
    items,
    organizationName: readOrganizationName(storage),
    performerLabel: rosterConfig.performerLabel,
    profileId,
    profileName: profileRow.displayName,
    trackLabels: readTrackLabels(rosterConfig),
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
  const { childrenMap, pieceMap } = readPiecesForSetList(storage, pieceIds);
  const items = resolveSetListPlaylistItems(setList, pieceMap, childrenMap);
  const rosterConfig = readRosterConfiguration(storage);
  return Response.json({
    eventArtworkFileId: eventRow.publicGraphicFileId ?? null,
    eventId: eventRow.id,
    eventStartsAt: eventRow.startsAt,
    eventTitle: eventRow.title,
    items,
    organizationName: readOrganizationName(storage),
    performerLabel: rosterConfig.performerLabel,
    trackLabels: readTrackLabels(rosterConfig),
  });
}
