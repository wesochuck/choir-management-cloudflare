import {
  organizationRosterConfigurationRequestSchema,
  type OrganizationMusicPieceRequest,
} from "@choir/contracts";

export function configuredSections(storage: DurableObjectStorage): ReadonlySet<string> | null {
  try {
    const raw = storage.sql
      .exec<{ readonly configuration: string }>(
        "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
      )
      .one().configuration;
    const parsed = organizationRosterConfigurationRequestSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? new Set(parsed.data.sections.filter(({ trackOnly }) => !trackOnly).map(({ code }) => code))
      : null;
  } catch {
    return null;
  }
}

export function validateSectionBuckets(
  storage: DurableObjectStorage,
  piece: OrganizationMusicPieceRequest,
): Response | null {
  const sections = configuredSections(storage);
  return sections && piece.sectionBuckets.every((section) => sections.has(section))
    ? null
    : Response.json({ code: "music_section_not_configured" }, { status: 400 });
}

export function validateTrackFiles(
  storage: DurableObjectStorage,
  piece: OrganizationMusicPieceRequest,
): Response | null {
  const ids = Object.values(piece.trackFileIds);
  if (ids.length === 0) return null;
  const rows = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      `SELECT id FROM private_files
       WHERE id IN (${ids.map(() => "?").join(",")})
         AND status = 'ready' AND content_type LIKE 'audio/%'`,
      ...ids,
    )
    .toArray();
  return rows.length === ids.length
    ? null
    : Response.json({ code: "music_track_file_invalid" }, { status: 409 });
}

export function validateParent(
  storage: DurableObjectStorage,
  pieceId: string,
  parentId: string | null,
): Response | null {
  if (!parentId) return null;
  if (parentId === pieceId) {
    return Response.json({ code: "music_parent_cycle" }, { status: 409 });
  }
  // Inline parent lookup to avoid circular dependency on crud.ts readPiece.
  const parentRow = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly parentId: string | null;
    }>("SELECT parent_id AS parentId FROM music_pieces WHERE id = ? LIMIT 1", parentId)
    .toArray()
    .at(0);
  if (!parentRow) return Response.json({ code: "music_parent_not_found" }, { status: 409 });
  if (parentRow.parentId) {
    return Response.json({ code: "music_parent_must_be_top_level" }, { status: 409 });
  }
  const childCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM music_pieces WHERE parent_id = ?",
      pieceId,
    )
    .one().count;
  return childCount === 0
    ? null
    : Response.json({ code: "music_piece_with_movements_cannot_be_movement" }, { status: 409 });
}

export function validatePiece(
  storage: DurableObjectStorage,
  pieceId: string,
  piece: OrganizationMusicPieceRequest,
): Response | null {
  return (
    validateSectionBuckets(storage, piece) ??
    validateParent(storage, pieceId, piece.parentId) ??
    validateTrackFiles(storage, piece)
  );
}
