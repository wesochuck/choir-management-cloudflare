import {
  organizationMusicBulkUpdateRequestSchema,
  organizationMusicPieceRequestSchema,
  organizationMusicPieceSchema,
  organizationRosterConfigurationRequestSchema,
  type OrganizationMusicPiece,
  type OrganizationMusicPieceRequest,
} from "@choir/contracts";
import { z } from "zod";

const operationContextSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

// Keep each statement below SQLite's bound-parameter limit while still reducing
// a large import to a small number of writes.
const MUSIC_IMPORT_BATCH_SIZE = 50;

const musicOperationSchema = z.discriminatedUnion("action", [
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
        }),
      )
      .min(1)
      .max(500),
  }),
]);

interface MusicPieceRow {
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

interface OrganizationIdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface PerformanceHistoryRow {
  readonly [column: string]: SqlStorageValue;
  readonly setListJson: string;
  readonly startsAt: string;
}

const musicColumns = `id, title, composer, arranger, purchase_date AS purchaseDate, copies,
  catalog_id AS catalogId, duration_seconds AS durationSeconds, notes,
  section_buckets_json AS sectionBucketsJson, genres_json AS genresJson,
  parent_id AS parentId, track_file_ids_json AS trackFileIdsJson,
  created_at AS createdAt, updated_at AS updatedAt`;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identityMatches(storage: DurableObjectStorage, organizationId: string): boolean {
  return (
    storage.sql
      .exec<OrganizationIdentityRow>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId === organizationId
  );
}

function parseStoredPiece(row: MusicPieceRow): OrganizationMusicPiece {
  const genres = JSON.parse(row.genresJson) as unknown;
  const sectionBuckets = JSON.parse(row.sectionBucketsJson) as unknown;
  const trackFileIds = JSON.parse(row.trackFileIdsJson) as unknown;
  return organizationMusicPieceSchema.parse({
    ...row,
    genres,
    sectionBuckets,
    trackFileIds,
  });
}

function addPerformanceHistory(
  storage: DurableObjectStorage,
  pieces: readonly OrganizationMusicPiece[],
): OrganizationMusicPiece[] {
  const history = new Map<string, { count: number; lastPerformedAt: string | null }>();
  const events = storage.sql
    .exec<PerformanceHistoryRow>(
      `SELECT starts_at AS startsAt, set_list_json AS setListJson
       FROM events WHERE type = 'Performance' AND is_archived = 0
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

function readPiece(storage: DurableObjectStorage, pieceId: string): OrganizationMusicPiece | null {
  const row = storage.sql
    .exec<MusicPieceRow>(`SELECT ${musicColumns} FROM music_pieces WHERE id = ? LIMIT 1`, pieceId)
    .toArray()
    .at(0);
  return row ? parseStoredPiece(row) : null;
}

function configuredSections(storage: DurableObjectStorage): ReadonlySet<string> | null {
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

function validateSectionBuckets(
  storage: DurableObjectStorage,
  piece: OrganizationMusicPieceRequest,
): Response | null {
  const sections = configuredSections(storage);
  return sections && piece.sectionBuckets.every((section) => sections.has(section))
    ? null
    : Response.json({ code: "music_section_not_configured" }, { status: 400 });
}

function validateTrackFiles(
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

function validateParent(
  storage: DurableObjectStorage,
  pieceId: string,
  parentId: string | null,
): Response | null {
  if (!parentId) return null;
  if (parentId === pieceId) {
    return Response.json({ code: "music_parent_cycle" }, { status: 409 });
  }
  const parent = readPiece(storage, parentId);
  if (!parent) return Response.json({ code: "music_parent_not_found" }, { status: 409 });
  if (parent.parentId) {
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

function validatePiece(
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

function requestFromPiece(piece: OrganizationMusicPiece): OrganizationMusicPieceRequest {
  return organizationMusicPieceRequestSchema.parse(piece);
}

function insertAudit(
  storage: DurableObjectStorage,
  operation: {
    readonly actorUserId: string;
    readonly pieceId: string;
    readonly requestId: string;
  },
  action: string,
  summary: Record<string, unknown>,
  occurredAt: string,
  auditKey = operation.requestId,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, 'music_piece', ?, ?, ?, ?)`,
    `music:${action}:${auditKey}`,
    operation.actorUserId,
    action,
    operation.pieceId,
    operation.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

function writePiece(
  storage: DurableObjectStorage,
  operation: Extract<
    z.infer<typeof musicOperationSchema>,
    { readonly action: "create" | "update" }
  >,
): Response {
  if (operation.action === "update" && !readPiece(storage, operation.pieceId)) {
    return Response.json({ code: "music_piece_not_found" }, { status: 404 });
  }
  const validation = validatePiece(storage, operation.pieceId, operation.piece);
  if (validation) return validation;
  const occurredAt = new Date().toISOString();
  const piece = operation.piece;
  storage.transactionSync(() => {
    if (operation.action === "create") {
      storage.sql.exec(
        `INSERT INTO music_pieces
          (id, title, composer, arranger, purchase_date, copies, catalog_id, duration_seconds,
           notes, section_buckets_json, genres_json, parent_id, track_file_ids_json,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        operation.pieceId,
        piece.title,
        piece.composer,
        piece.arranger,
        piece.purchaseDate,
        piece.copies,
        piece.catalogId,
        piece.durationSeconds,
        piece.notes,
        JSON.stringify(piece.sectionBuckets),
        JSON.stringify(piece.genres),
        piece.parentId,
        JSON.stringify(piece.trackFileIds),
        occurredAt,
        occurredAt,
      );
    } else {
      storage.sql.exec(
        `UPDATE music_pieces
         SET title = ?, composer = ?, arranger = ?, purchase_date = ?, copies = ?, catalog_id = ?,
           duration_seconds = ?, notes = ?, section_buckets_json = ?, genres_json = ?, parent_id = ?,
           track_file_ids_json = ?, updated_at = ?
         WHERE id = ?`,
        piece.title,
        piece.composer,
        piece.arranger,
        piece.purchaseDate,
        piece.copies,
        piece.catalogId,
        piece.durationSeconds,
        piece.notes,
        JSON.stringify(piece.sectionBuckets),
        JSON.stringify(piece.genres),
        piece.parentId,
        JSON.stringify(piece.trackFileIds),
        occurredAt,
        operation.pieceId,
      );
    }
    insertAudit(
      storage,
      operation,
      operation.action === "create" ? "music.piece.created" : "music.piece.updated",
      {
        parentId: piece.parentId,
        title: piece.title,
        trackCount: Object.keys(piece.trackFileIds).length,
      },
      occurredAt,
    );
  });
  return Response.json(readPiece(storage, operation.pieceId), {
    status: operation.action === "create" ? 201 : 200,
  });
}

function bulkUpdatePieces(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "bulk_update" }>,
): Response {
  const pieces = operation.pieceIds.map((pieceId) => readPiece(storage, pieceId));
  if (pieces.some((piece) => piece === null)) {
    return Response.json({ code: "music_piece_not_found" }, { status: 404 });
  }
  const storedPieces = pieces.filter((piece): piece is OrganizationMusicPiece => piece !== null);
  const requests: { piece: OrganizationMusicPieceRequest; pieceId: string }[] = storedPieces.map(
    (stored) => ({
      piece: organizationMusicPieceRequestSchema.parse({
        ...requestFromPiece(stored),
        ...operation.changes,
      }),
      pieceId: stored.id,
    }),
  );
  for (const { piece, pieceId } of requests) {
    const validation = validatePiece(storage, pieceId, piece);
    if (validation) return validation;
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    for (const { piece, pieceId } of requests) {
      storage.sql.exec(
        `UPDATE music_pieces
         SET title = ?, composer = ?, arranger = ?, purchase_date = ?, copies = ?, catalog_id = ?,
           duration_seconds = ?, notes = ?, section_buckets_json = ?, genres_json = ?, parent_id = ?,
           track_file_ids_json = ?, updated_at = ?
         WHERE id = ?`,
        piece.title,
        piece.composer,
        piece.arranger,
        piece.purchaseDate,
        piece.copies,
        piece.catalogId,
        piece.durationSeconds,
        piece.notes,
        JSON.stringify(piece.sectionBuckets),
        JSON.stringify(piece.genres),
        piece.parentId,
        JSON.stringify(piece.trackFileIds),
        occurredAt,
        pieceId,
      );
      insertAudit(
        storage,
        {
          actorUserId: operation.actorUserId,
          requestId: operation.requestId,
          pieceId,
        },
        "music.piece.updated",
        { bulk: true, fields: Object.keys(operation.changes) },
        occurredAt,
        `${operation.requestId}:${pieceId}`,
      );
    }
  });
  const updated = requests
    .map(({ pieceId }) => readPiece(storage, pieceId))
    .filter((piece): piece is OrganizationMusicPiece => piece !== null);
  return Response.json({ pieces: addPerformanceHistory(storage, updated) });
}

function importPieces(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "import" }>,
): Response {
  for (const imported of operation.pieces) {
    const validation = validatePiece(storage, imported.pieceId, imported.piece);
    if (validation) return validation;
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    for (let offset = 0; offset < operation.pieces.length; offset += MUSIC_IMPORT_BATCH_SIZE) {
      const importedBatch = operation.pieces.slice(offset, offset + MUSIC_IMPORT_BATCH_SIZE);
      const values = importedBatch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const parameters = importedBatch.flatMap((imported) => {
        const piece = imported.piece;
        return [
          imported.pieceId,
          piece.title,
          piece.composer,
          piece.arranger,
          piece.purchaseDate,
          piece.copies,
          piece.catalogId,
          piece.durationSeconds,
          piece.notes,
          JSON.stringify(piece.sectionBuckets),
          JSON.stringify(piece.genres),
          piece.parentId,
          JSON.stringify(piece.trackFileIds),
          occurredAt,
          occurredAt,
        ];
      });
      storage.sql.exec(
        `INSERT INTO music_pieces
          (id, title, composer, arranger, purchase_date, copies, catalog_id, duration_seconds,
           notes, section_buckets_json, genres_json, parent_id, track_file_ids_json,
           created_at, updated_at)
         VALUES ${values.join(", ")}`,
        ...parameters,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'music.catalog.imported', 'music_catalog',
         'catalog', ?, ?, ?)`,
      `music:import:${operation.requestId}`,
      operation.actorUserId,
      operation.requestId,
      JSON.stringify({ imported: operation.pieces.length }),
      occurredAt,
    );
  });
  return Response.json({ imported: operation.pieces.length });
}

function eventReferencesPiece(storage: DurableObjectStorage, pieceId: string): boolean {
  const rows = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly setListJson: string }>(
      "SELECT set_list_json AS setListJson FROM events",
    )
    .toArray();
  return rows.some(({ setListJson }) => {
    try {
      const value = JSON.parse(setListJson) as unknown;
      return (
        Array.isArray(value) &&
        value.some((item: unknown) => {
          return isUnknownRecord(item) && item.pieceId === pieceId;
        })
      );
    } catch {
      return false;
    }
  });
}

function deletePiece(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "delete" }>,
): Response {
  const piece = readPiece(storage, operation.pieceId);
  if (!piece) return Response.json({ code: "music_piece_not_found" }, { status: 404 });
  if (eventReferencesPiece(storage, operation.pieceId)) {
    return Response.json({ code: "music_piece_in_set_list" }, { status: 409 });
  }
  const childCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM music_pieces WHERE parent_id = ?",
      operation.pieceId,
    )
    .one().count;
  if (childCount > 0 && !operation.unlinkChildren) {
    return Response.json({ code: "music_piece_has_movements" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    if (childCount > 0) {
      storage.sql.exec(
        "UPDATE music_pieces SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
        occurredAt,
        operation.pieceId,
      );
    }
    storage.sql.exec("DELETE FROM music_pieces WHERE id = ?", operation.pieceId);
    insertAudit(
      storage,
      operation,
      "music.piece.deleted",
      { title: piece.title, unlinkedMovements: childCount },
      occurredAt,
    );
  });
  return Response.json({ pieceId: operation.pieceId, status: "deleted" });
}

export function listMusicPiecesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  try {
    const pieces = storage.sql
      .exec<MusicPieceRow>(
        `SELECT ${musicColumns} FROM music_pieces
         ORDER BY title COLLATE NOCASE ASC, created_at ASC, id ASC LIMIT 2000`,
      )
      .toArray()
      .map(parseStoredPiece);
    return Response.json({ pieces: addPerformanceHistory(storage, pieces) });
  } catch {
    return Response.json({ code: "music_catalog_corrupt" }, { status: 500 });
  }
}

export async function manageMusicInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const operation = musicOperationSchema.safeParse(await request.json());
  if (!operation.success) {
    return Response.json({ code: "invalid_music_operation" }, { status: 400 });
  }
  if (!identityMatches(storage, operation.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  if (operation.data.action === "delete") return deletePiece(storage, operation.data);
  if (operation.data.action === "import") return importPieces(storage, operation.data);
  if (operation.data.action === "bulk_update") return bulkUpdatePieces(storage, operation.data);
  return writePiece(storage, operation.data);
}
